import { isMcpToolCall } from './capabilities/approvalOrigin';
import { z } from 'zod';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpServer } from './mcpServer';
import { createEditorTool, scopeSnapshot } from './editorOperations';
import { SessionManager } from './sessions/SessionManager';
import { sessionSnapshots } from './editorSessions';
import { WorkingScopeManager } from './models/WorkingScopeManager';
import {
	getCapability,
	isHostCapability,
	registerHostCapabilities,
	runWithHostCapabilityRunner,
} from './capabilities/registry';
import type { Capability } from './capabilities/Capability';

const connections = new Set<Server>();
const editors = new Map<Server, Set<string>>();
const registrations = new Map<string, () => void>();
const requestingEditor = new AsyncLocalStorage<Server>();
const replySchema = z.object({ result: z.unknown() });
type EditorCapability = Omit<Capability, 'run'>;

async function requestEditor(server: Server, operation: string, input: Record<string, unknown>): Promise<unknown> {
	const reply = await server.request({ method: 'rewst/editor', params: { operation, input } }, replySchema, {
		timeout: 30 * 60_000,
	});
	return reply.result;
}
/** Only clients authenticated on the separate editor endpoint may register UI callbacks. */
export async function requestAttachedEditor(operation: string, input: Record<string, unknown>): Promise<unknown> {
	const current = requestingEditor.getStore();
	const editor = (current && editors.has(current) ? current : editors.keys().next().value) as Server | undefined;
	if (!editor) throw new Error('No VS Code editor is attached to the Rewst Buddy server.');
	return requestEditor(editor, operation, input);
}
/** True while a private operation is executing for an attached editor client. */
export function hasRequestingEditor(): boolean {
	const current = requestingEditor.getStore();
	return !!current && editors.has(current);
}
export function broadcastEditorEvent(event: unknown): void {
	for (const server of connections)
		void server.notification({ method: 'notifications/rewst/event', params: { event } }).catch(() => undefined);
}
function cleanupRegistrations(): void {
	for (const [name, dispose] of registrations) {
		if ([...editors.values()].some(names => names.has(name))) continue;
		dispose();
		registrations.delete(name);
	}
}
function metadata(capability: EditorCapability): string {
	return JSON.stringify({
		spec: capability.spec,
		access: capability.access,
		dangerous: capability.dangerous,
		requiresOrg: capability.requiresOrg,
		scopedSessions: capability.scopedSessions,
	});
}
function attach(server: Server, input: Record<string, unknown>): void {
	if (!Array.isArray(input.capabilities) || input.capabilities.length > 100)
		throw new Error('Invalid editor capability catalog');
	const capabilities = input.capabilities as EditorCapability[];
	const names = new Set<string>();
	for (const capability of capabilities) {
		const name = capability?.spec?.name;
		if (
			typeof name !== 'string' ||
			!/^buddy_[a-z_]+$/.test(name) ||
			names.has(name) ||
			!['read', 'write'].includes(capability.access) ||
			typeof capability.spec.description !== 'string'
		)
			throw new Error('Invalid editor capability');
		names.add(name);
		const existing = getCapability(name);
		if (existing && metadata(existing) !== metadata(capability))
			throw new Error(`Cannot replace existing capability: ${name}`);
	}
	for (const capability of capabilities) {
		const name = capability.spec.name;
		if (getCapability(name)) continue;
		registrations.set(
			name,
			registerHostCapabilities([
				{
					...capability,
					async run(args, context) {
						const peer = [...editors].find(([, registered]) => registered.has(name))?.[0];
						if (!peer) throw new Error('No editor is attached for this capability');
						return String(
							await requestEditor(peer, 'capability.run', {
								// Only the trusted envelope carries approval origin; never tool arguments.
								origin: isMcpToolCall() && !hasRequestingEditor() ? 'mcp' : 'chat',
								name,
								args,
								context: {
									orgId: context.orgId,
									profile: context.session?.profile,
									profiles: context.sessions.map(s => s.profile),
								},
							}),
						);
					},
				},
			]),
		);
	}
	editors.set(server, names);
	cleanupRegistrations();
}
/** Construct only behind the owner-only discovery credential; public MCP never exposes this surface. */
export function createSharedEditorServer(): Server {
	const original = createEditorTool();
	const tool = {
		...original,
		async run(request: Record<string, unknown>, ctx: Parameters<typeof original.run>[1]) {
			return requestingEditor.run(server, () =>
				runWithHostCapabilityRunner(
					async (capability, args, context) => {
						if (!isHostCapability(capability) || !editors.get(server)?.has(capability.spec.name))
							return capability.run(args, context);
						return String(
							await requestEditor(server, 'capability.run', {
								origin: 'chat',
								name: capability.spec.name,
								args,
								context: {
									orgId: context.orgId,
									profile: context.session?.profile,
									profiles: context.sessions.map(session => session.profile),
								},
							}),
						);
					},
					async () => {
						if (request.operation === 'editor.attach') {
							const input = request.input;
							if (!input || typeof input !== 'object' || Array.isArray(input))
								throw new Error('Invalid editor attachment');
							attach(server, input as Record<string, unknown>);
							// Return the owner snapshot in the attach response. Notifications
							// can race the editor's first subscription, while this response is
							// consumed synchronously by the attaching VS Code window.
							return { attached: true, scope: scopeSnapshot(), sessions: sessionSnapshots() };
						}
						return original.run(request, ctx);
					},
				),
			);
		},
	};
	const server = createMcpServer({ extraTools: [tool] });
	connections.add(server);
	const sessions = SessionManager.onSessionChange(change => {
		const snapshot = {
			sessions: change.activeProfiles.map(profile => ({ sessionId: profile.user.id, profile, expired: false })),
			knownProfiles: change.allProfiles,
		};
		void server
			.notification({
				method: 'notifications/rewst/event',
				params: { event: { type: 'sessions', snapshot, changeType: change.type } },
			})
			.catch(() => undefined);
	});
	const scope = WorkingScopeManager.onDidChangeScope(() => {
		void server
			.notification({
				method: 'notifications/rewst/event',
				params: { event: { type: 'scope', snapshot: scopeSnapshot() } },
			})
			.catch(() => undefined);
	});
	const onclose = server.onclose;
	server.onclose = () => {
		onclose?.();
		sessions.dispose();
		scope.dispose();
		connections.delete(server);
		editors.delete(server);
		cleanupRegistrations();
	};
	return server;
}
/** Legacy browser handoff stays outside the public model tool catalog. */
export async function handleSharedBrowserAction(body: Record<string, unknown>): Promise<unknown> {
	if (body.action === 'addSession') {
		if (typeof body.cookies !== 'string' || !body.cookies.trim()) throw new Error('Missing session cookie');
		// Never include remote errors in this credential intake response.
		try {
			const session = await SessionManager.createSession(body.cookies);
			return { success: true, message: 'Session created successfully', sessionLabel: session.profile.label };
		} catch {
			throw new Error('Could not validate the supplied Rewst session.');
		}
	}
	if (body.action === 'openTemplate') {
		if (typeof body.orgId !== 'string' || typeof body.templateId !== 'string' || !body.orgId || !body.templateId)
			throw new Error('Missing organization or template id');
		return requestAttachedEditor('browser.openTemplate', { orgId: body.orgId, templateId: body.templateId });
	}
	throw new Error('Unknown browser action');
}
