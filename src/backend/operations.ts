import { McpDefinitionProvider } from '../mcp/McpDefinitionProvider';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { discoverSharedServer, type SharedServerDescriptor } from '../../packages/mcp-server/src/sharedDiscovery';
import { startSharedHttpServer } from '../../packages/mcp-server/src/sharedHttp';
import {
	createSharedEditorServer,
	handleSharedBrowserAction,
	broadcastEditorEvent,
	hasRequestingEditor,
	requestAttachedEditor,
} from '../../packages/mcp-server/src/editorBridge';
import { setBackendServerDelegate } from '../server/backendDelegate';
import { setSharedConnection } from './sharedConnection';
import { getServerConfig, isLoopbackHost } from '../server/config';
import { getMcpToken } from '../mcp/runtime';
import { readMcpSettings } from '../mcp/settings';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import vscode from 'vscode';
import { context, extPrefix } from '@global';
import { log } from '@utils';
import type { RuntimeHost } from '../../packages/mcp-server/src/host';
import { createMcpServer } from '../../packages/mcp-server/src/mcpServer';
import { createEditorTool, scopeSnapshot } from '../../packages/mcp-server/src/editorOperations';
import { SessionManager as BackendSessions } from '../../packages/mcp-server/src/sessions/SessionManager';
import { WorkingScopeManager as BackendScope } from '../../packages/mcp-server/src/models/WorkingScopeManager';
import { startRuntime, stopRuntime } from '../../packages/mcp-server/src/runtime';
import type { McpResourceDescriptor, McpToolDescriptor } from '../mcp/protocol';

const events = new vscode.EventEmitter<unknown>();
export const subscribe = events.event;
let connection: Promise<Client> | undefined;
let closed = false;
let generation = 0;
let pendingShutdown: Promise<void> | undefined;
interface BackendConnection {
	client: Client;
	server?: ReturnType<typeof createMcpServer>;
	remote?: boolean;
	clientTransport: { close(): Promise<void> };
	serverTransport: { close(): Promise<void> };
}
let activeConnection: BackendConnection | undefined;
let tools: McpToolDescriptor[] = [];
let resources: McpResourceDescriptor[] = [];
export function cachedTools(): McpToolDescriptor[] {
	return tools;
}
export function cachedResources(): McpResourceDescriptor[] {
	return resources;
}

/** Configure persistence/UI ports. The server owns their contents and all Rewst traffic. */
function initializeEmbeddedBackend(): vscode.Disposable {
	const thisGeneration = ++generation;
	closed = false;
	const host: RuntimeHost = {
		state: context.globalState,
		secrets: context.secrets,
		getSetting: (key, fallback) => vscode.workspace.getConfiguration(extPrefix).get(key, fallback),
		log: (level, message, ...details) => {
			log[level](message, ...details);
		},
		notify: (level, message) => {
			if (level === 'error') void vscode.window.showErrorMessage(message);
			else if (level === 'warn') void vscode.window.showWarningMessage(message);
			else void vscode.window.showInformationMessage(message);
		},
		requestToken: async () => {
			if (hasRequestingEditor()) {
				const token = await requestAttachedEditor('token.request', {});
				if (typeof token !== 'string' || !token) throw new Error('Session creation cancelled');
				return token;
			}
			const token = await vscode.window.showInputBox({
				prompt: 'Paste your Rewst session token or cookie',
				password: true,
				ignoreFocusOut: true,
			});
			if (!token) throw new Error('Session creation cancelled');
			return token;
		},
		sessionExpired: label => {
			void vscode.window
				.showErrorMessage(
					`Rewst Buddy session "${label}" has expired. Re-authenticate to continue syncing.`,
					'Re-authenticate',
				)
				.then(choice => {
					if (choice === 'Re-authenticate') void vscode.commands.executeCommand('rewst-buddy.FocusSidebar');
				});
		},
		templateChanged: template => {
			events.fire({ type: 'templateChanged', template });
			broadcastEditorEvent({ type: 'templateChanged', template });
		},
	};
	const registrations = [
		BackendSessions.onSessionChange(event => {
			void publishSnapshots(event, thisGeneration).catch(error =>
				log.error('Backend session notification failed', error),
			);
		}),
		BackendScope.onDidChangeScope(() => {
			void publishScope(thisGeneration).catch(error => log.error('Backend scope notification failed', error));
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(extPrefix))
				void refreshCatalog(thisGeneration).catch(error => log.error('Backend catalog refresh failed', error));
		}),
	];
	const previousShutdown = pendingShutdown;
	const runtimeReady = previousShutdown
		? previousShutdown.then(() => {
				if (thisGeneration !== generation) throw new Error('Backend disposed');
				return startRuntime(host);
			})
		: startRuntime(host);
	const connectionReady = previousShutdown
		? previousShutdown.then(() => {
				if (thisGeneration !== generation) throw new Error('Backend disposed');
				return connect();
			})
		: connect();
	// A queued restart can become stale before either branch is awaited. Keep
	// both startup promises observed so disposal never leaves a rejected branch.
	void runtimeReady.catch(() => undefined);
	void connectionReady.catch(() => undefined);
	const ready = (async (): Promise<BackendConnection> => {
		let next: BackendConnection | undefined;
		try {
			// Establish the transport while sessions are restoring. Once the
			// connection is installed, startup notifications can reach the UI.
			next = await connectionReady;
			if (thisGeneration !== generation) throw new Error('Backend disposed');
			activeConnection = next;
			await runtimeReady;
			return next;
		} catch (error) {
			if (next && activeConnection === next) activeConnection = undefined;
			if (next) await closeConnection(next);
			throw error;
		}
	})();
	connection = ready.then(next => next.client);
	// `invoke` normally observes this promise, but disposal can reject it
	// before a caller gets a chance to invoke anything.
	void connection
		.then(() => publishCurrentSessions(thisGeneration))
		.then(() => refreshCatalog(thisGeneration))
		.catch(error => {
			if (thisGeneration === generation) log.error('Backend connection failed', error);
		});
	return {
		dispose() {
			if (thisGeneration !== generation) return;
			closed = true;
			generation++;
			for (const registration of registrations) registration.dispose();
			const closing = ready
				.then(next => closeConnection(next))
				.catch(() => undefined)
				.then(() => stopRuntime(host));
			pendingShutdown = closing;
			activeConnection = undefined;
			connection = undefined;
			tools = [];
			resources = [];
		},
	};
}

async function closeConnection(next: BackendConnection): Promise<void> {
	if (next.remote) await next.serverTransport.close();
	await Promise.allSettled([
		next.client.close(),
		next.server?.close(),
		next.clientTransport.close(),
		...(next.remote ? [] : [next.serverTransport.close()]),
	]);
}

async function connect(): Promise<BackendConnection> {
	const server = createMcpServer({ extraTools: [createEditorTool()] });
	const nextClient = new Client({ name: 'rewst-buddy-vscode', version: '1.0.0' });
	nextClient.setNotificationHandler(
		z.object({ method: z.literal('notifications/rewst/event'), params: z.object({ event: z.unknown() }) }),
		notification => {
			events.fire(notification.params.event);
		},
	);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(serverTransport);
		await nextClient.connect(clientTransport);
	} catch (error) {
		await Promise.allSettled([
			nextClient.close(),
			server.close(),
			clientTransport.close(),
			serverTransport.close(),
		]);
		throw error;
	}
	// Do not await catalog through invoke here: it waits on this connection promise.
	return { client: nextClient, server, clientTransport, serverTransport };
}

async function emit(event: unknown, thisGeneration = generation): Promise<void> {
	const current = activeConnection;
	if (current && thisGeneration === generation && !closed)
		await current.server?.notification({ method: 'notifications/rewst/event', params: { event } });
}
async function publishCurrentSessions(thisGeneration: number): Promise<void> {
	if (!activeConnection || activeConnection.remote || thisGeneration !== generation || closed) return;
	const activeProfiles = BackendSessions.getActiveSessions().map(session => session.profile);
	await emit(
		{
			type: 'sessions',
			snapshot: {
				sessions: activeProfiles.map(profile => ({ sessionId: profile.user.id, profile, expired: false })),
				knownProfiles: BackendSessions.getAllKnownProfiles(),
			},
			changeType: 'saved',
		},
		thisGeneration,
	);
}
async function publishSnapshots(
	change: {
		type: string;
		allProfiles: import('../../packages/mcp-server/src/sessions/SessionProfile').default[];
		activeProfiles: import('../../packages/mcp-server/src/sessions/SessionProfile').default[];
	},
	thisGeneration: number,
): Promise<void> {
	if (!activeConnection || activeConnection.remote || thisGeneration !== generation || closed) return;
	// Capture the event's state before yielding; a later session change must not
	// turn this removal/clear notification into a snapshot of another operation.
	const snapshot = {
		sessions: change.activeProfiles.map(profile => ({ sessionId: profile.user.id, profile, expired: false })),
		knownProfiles: change.allProfiles,
	};
	await emit({ type: 'sessions', snapshot, changeType: change.type }, thisGeneration);
	await refreshCatalog(thisGeneration);
}
async function publishScope(thisGeneration: number): Promise<void> {
	if (!activeConnection || activeConnection.remote || thisGeneration !== generation || closed) return;
	await emit({ type: 'scope', snapshot: scopeSnapshot() }, thisGeneration);
	await refreshCatalog(thisGeneration);
}
export async function refreshCatalog(thisGeneration = generation): Promise<void> {
	if (!connection || closed || thisGeneration !== generation) return;
	const [nextTools, nextResources] = await Promise.all([
		invoke<McpToolDescriptor[]>('tools.list', {}),
		invoke<McpResourceDescriptor[]>('resources.list', {}),
	]);
	if (thisGeneration === generation && !closed) {
		tools = nextTools;
		resources = nextResources;
	}
}

export async function invoke<T>(
	operation: string,
	input: Record<string, unknown>,
	options: { onEvent?: (event: unknown) => void; signal?: AbortSignal } = {},
): Promise<T> {
	if (!connection) throw new Error('Rewst Buddy backend has not been initialized');
	const active = await connection;
	const listener = options.onEvent ? subscribe(options.onEvent) : undefined;
	try {
		const result = await active.callTool(
			{ name: 'rewst_editor_operation', arguments: { operation, input } },
			undefined,
			{ signal: options.signal, timeout: 30 * 60_000 },
		);
		if (result.isError) {
			const text = (result.content as { type: string; text?: string }[])
				.filter(part => part.type === 'text')
				.map(part => part.text)
				.join('\n');
			const error = new Error(text || 'Backend operation failed');
			const code = (result.structuredContent as { code?: string } | undefined)?.code;
			if (code) Object.assign(error, { code });
			throw error;
		}
		const structured = result.structuredContent as { result?: T } | undefined;
		if (structured && Object.hasOwn(structured, 'result')) return structured.result as T;
		const text = (result.content as { type: string; text?: string }[]).find(part => part.type === 'text')?.text;
		return (text ? JSON.parse(text) : undefined) as T;
	} finally {
		listener?.dispose();
	}
}

/** Refresh after the extension's optional editor catalog has been loaded. */
export async function registerEditorCapabilities(): Promise<vscode.Disposable> {
	await import('../capabilities/registry');
	if (activeConnection?.remote) {
		const { getEditorCapabilities } = await import('./editorHost');
		await invoke('editor.attach', { capabilities: getEditorCapabilities() });
	}
	await refreshCatalog();
	return { dispose() {} };
}

export interface BackendOptions {
	/** Tests and explicit isolated hosts can keep an in-memory-only connection. */
	shared?: boolean;
	port?: number;
	discoveryDir?: string;
}
/** Reuse a verified localhost owner, or create this window's shared backend. */
export function initializeBackend(options: BackendOptions = {}): vscode.Disposable {
	if (options.shared === false) return initializeEmbeddedBackend();
	const previousShutdown = pendingShutdown;
	const config = getServerConfig();
	const currentPort = () => options.port ?? getServerConfig().port;
	let disposed = false;
	let local: vscode.Disposable | undefined;
	let hub: Awaited<ReturnType<typeof startSharedHttpServer>> | undefined;
	let remote: BackendConnection | undefined;
	let ownerDisconnected = false;
	let pendingListen: Promise<void> | undefined;
	let runtimeReadyResolve!: () => void;
	let runtimeReadyReject!: (reason: unknown) => void;
	const runtimeReady = new Promise<void>((resolve, reject) => {
		runtimeReadyResolve = resolve;
		runtimeReadyReject = reject;
	});
	void runtimeReady.catch(() => undefined);
	const bind = async () => {
		hub = await startSharedHttpServer({
			port: currentPort(),
			discoveryDir: options.discoveryDir,
			publicToken: getMcpToken(),
			publicEnabled: () => readMcpSettings().enable,
			ready: runtimeReady,
			createEditorServer: createSharedEditorServer,
			handleBrowserAction: async body => {
				if (body.action === 'openTemplate') {
					const { handleEditorRequest } = await import('./editorHost');
					return handleEditorRequest('browser.openTemplate', body);
				}
				return handleSharedBrowserAction(body);
			},
		});
		const ownedHub = hub;
		setSharedConnection({
			descriptor: hub.descriptor,
			owned: true,
			rotate: token => {
				void ownedHub
					.setPublicToken(token)
					.catch(error => log.error('Failed to persist shared MCP token', error));
			},
		});
	};
	const listen = async (): Promise<void> => {
		if (hub) return;
		if (pendingListen) return pendingListen;
		pendingListen = bind();
		try {
			await pendingListen;
		} finally {
			pendingListen = undefined;
		}
	};
	const attach = async (descriptor: SharedServerDescriptor): Promise<Client> => {
		const next = await connectRemote(descriptor, disconnectedClient => {
			if (remote?.client === disconnectedClient) {
				remote = undefined;
			}
			// This callback also runs while the initial editor attachment is still
			// pending, before `remote` can be promoted. Keep the owner-loss state
			// regardless of which phase the transport reached.
			ownerDisconnected = true;
		});
		if (disposed) {
			await closeConnection(next);
			throw new Error('Backend disposed');
		}
		remote = next;
		activeConnection = next;
		closed = false;
		generation++;
		setSharedConnection({ descriptor, owned: false });
		McpDefinitionProvider.refresh();
		log.info(`Using existing Rewst Buddy server on port ${descriptor.port}`);
		return next.client;
	};
	const restoreConnection = () => {
		connection = ready;
	};
	const ready: Promise<Client> = (async (): Promise<Client> => {
		await previousShutdown;
		if (disposed) throw new Error('Backend disposed');
		// Previous teardown may have cleared the global connection while this
		// replacement was queued. Install it again after shutdown finishes.
		restoreConnection();
		if (!isLoopbackHost(config.host)) throw new Error('Rewst Buddy shared servers must use a loopback address.');
		const port = currentPort();
		const existing = await discoverSharedServer(port, options.discoveryDir);
		if (disposed) throw new Error('Backend disposed');
		if (existing) return attach(existing);
		if (config.enabled || readMcpSettings().enable) {
			try {
				await listen();
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
				// Another client may have won the bind after our first probe.
				for (let attempt = 0; attempt < 10; attempt++) {
					await new Promise(resolve => setTimeout(resolve, 50));
					try {
						const winner = await discoverSharedServer(port, options.discoveryDir);
						if (winner) return attach(winner);
					} catch {
						/* owner may still be publishing its record */
					}
				}
				throw new Error(`Port ${port} is occupied and a compatible Rewst Buddy server could not be verified.`);
			}
		}
		if (disposed) throw new Error('Backend disposed');
		local = initializeEmbeddedBackend();
		const client = await connection!;
		runtimeReadyResolve();
		return client;
	})();
	connection = ready;
	setBackendServerDelegate({
		getStatus: () => !!hub || (!!remote && activeConnection?.client === remote.client),
		start: async () => {
			if (ownerDisconnected) {
				log.notifyError(
					'Rewst Buddy owner disconnected. Reload the VS Code window before starting a fresh local server.',
				);
				return false;
			}
			await ready;
			if (ownerDisconnected) {
				log.notifyError(
					'Rewst Buddy owner disconnected. Reload the VS Code window before starting a fresh local server.',
				);
				return false;
			}
			if (!remote && !hub) await listen();
			return true;
		},
		stop: async () => {
			await ready.catch(() => undefined);
			await pendingListen?.catch(() => undefined);
			if (hub) {
				const owned = hub;
				hub = undefined;
				await owned.close();
				setSharedConnection(undefined);
			} /* attached windows do not stop another owner */
		},
	});
	void ready
		.then(() => refreshCatalog())
		.catch(async error => {
			runtimeReadyReject(error);
			if (hub) {
				const failedHub = hub;
				hub = undefined;
				await failedHub.close();
			}
			local?.dispose();
			if (!disposed) log.notifyError('Could not connect to the Rewst Buddy server', error);
		})
		.catch(error => log.error('Backend startup cleanup failed', error));
	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			runtimeReadyReject(new Error('Backend disposed'));
			setBackendServerDelegate(undefined);
			const closing = ready
				.catch(() => undefined)
				.then(async () => {
					if (remote) {
						await closeConnection(remote);
						remote = undefined;
						activeConnection = undefined;
						closed = true;
						generation++;
						connection = undefined;
						tools = [];
						resources = [];
					}
					if (hub) {
						await hub.close();
						hub = undefined;
					}
					local?.dispose();
					const runtimeShutdown = pendingShutdown;
					pendingShutdown = closing;
					if (runtimeShutdown && runtimeShutdown !== closing) await runtimeShutdown;
					setSharedConnection(undefined);
				});
			pendingShutdown = closing;
			void closing.catch(error => log.error('Backend shutdown failed', error));
		},
	};
}
async function connectRemote(
	descriptor: SharedServerDescriptor,
	onUnexpectedDisconnect?: (client: Client) => void,
): Promise<BackendConnection> {
	const client = new Client({ name: 'rewst-buddy-vscode', version: '1.0.0' });
	client.setNotificationHandler(
		z.object({ method: z.literal('notifications/rewst/event'), params: z.object({ event: z.unknown() }) }),
		notification => {
			events.fire(notification.params.event);
			const event = notification.params.event as { type?: string } | undefined;
			if (event?.type === 'sessions' || event?.type === 'scope')
				void refreshCatalog().catch(error => log.error('Backend catalog refresh failed', error));
		},
	);
	const { installEditorHost, getEditorCapabilities } = await import('./editorHost');
	installEditorHost(client);
	const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${descriptor.port}/editor`), {
		requestInit: { headers: { Authorization: `Bearer ${descriptor.editorToken}` }, redirect: 'error' },
	});
	let intentionalClose = false;
	let disconnected = false;
	let disconnectCause: Error | undefined;
	let rejectDisconnect!: (reason: Error) => void;
	const disconnectPromise = new Promise<never>((_, reject) => {
		rejectDisconnect = reject;
	});
	void disconnectPromise.catch(() => undefined);
	const invalidateRemote = (cause?: Error): void => {
		// Owner shutdown or a broken private connection invalidates the attached
		// window's view. Do not leave stale active/expired sessions in the facade.
		if (intentionalClose || disconnected) return;
		disconnected = true;
		disconnectCause = cause ?? new Error('The shared Rewst Buddy server disconnected during editor attachment.');
		rejectDisconnect(disconnectCause);
		onUnexpectedDisconnect?.(client);
		// During the initial editor attachment there is no active connection yet;
		// the caller will observe `disconnected` below and reject promotion.
		if (activeConnection?.client !== client) return;
		if (cause) log.warn('Attached Rewst Buddy server connection lost', cause);
		activeConnection = undefined;
		connection = undefined;
		closed = true;
		generation++;
		tools = [];
		resources = [];
		setSharedConnection(undefined);
		events.fire({
			type: 'sessions',
			snapshot: { sessions: [], knownProfiles: [] },
			changeType: 'cleared',
		});
		events.fire({ type: 'scope', snapshot: { orgs: [], workflows: [] } });
	};
	transport.onclose = () => invalidateRemote();
	transport.onerror = error => {
		// The SDK reports a graceful SSE EOF by scheduling reconnects and only
		// calls onclose for an explicit close(). Treat retry exhaustion as the
		// equivalent unexpected disconnect so an attached editor cannot retain
		// stale owner state indefinitely.
		if (/Maximum reconnection attempts \(\d+\) exceeded\./.test(error.message)) invalidateRemote(error);
		else log.debug('Attached Rewst Buddy server transport error', error);
	};
	try {
		await client.connect(transport);
		const result = await Promise.race([
			client.callTool({
				name: 'rewst_editor_operation',
				arguments: { operation: 'editor.attach', input: { capabilities: getEditorCapabilities() } },
			}),
			disconnectPromise,
		]);
		if (result.isError) throw new Error('The shared server rejected the editor attachment.');
		if (disconnected)
			throw disconnectCause ?? new Error('The shared Rewst Buddy server disconnected during editor attachment.');
		const attached = (result.structuredContent as { result?: unknown } | undefined)?.result;
		if (attached && typeof attached === 'object' && !Array.isArray(attached)) {
			const snapshot = (attached as { sessions?: unknown }).sessions;
			if (
				snapshot &&
				typeof snapshot === 'object' &&
				!Array.isArray(snapshot) &&
				Array.isArray((snapshot as { sessions?: unknown }).sessions) &&
				Array.isArray((snapshot as { knownProfiles?: unknown }).knownProfiles)
			) {
				events.fire({ type: 'sessions', snapshot, changeType: 'saved' });
			}
		}
	} catch (error) {
		intentionalClose = true;
		await transport.terminateSession().catch(() => undefined);
		await client.close();
		throw error;
	}
	const closeRemote = async (): Promise<void> => {
		intentionalClose = true;
		await transport.terminateSession().catch(() => undefined);
	};
	const closeClientTransport = async (): Promise<void> => {
		intentionalClose = true;
		await transport.close().catch(() => undefined);
	};
	return {
		client,
		remote: true,
		clientTransport: { close: closeClientTransport },
		serverTransport: { close: closeRemote },
	};
}
