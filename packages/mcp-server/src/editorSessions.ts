/**
 * Trusted session operations used by the editor bridge.  This module is an
 * internal capability surface: the public MCP server never exposes these
 * operation names to model callers.
 */

import { SessionManager } from './sessions/SessionManager';
import type Session from './sessions/Session';
import { askRewstAi, seedConversation, type ConversationEvent, type SeedChunk } from './sessions/conversation';
import type { Sdk } from './sessions/graphql/sdk';
import type SessionProfile from './sessions/SessionProfile';

export interface EditorSessionOperationContext {
	signal: AbortSignal;
	emit(event: unknown): Promise<void>;
}

export interface SessionSnapshot {
	sessionId: string;
	profile: SessionProfile;
	expired: boolean;
}

const SDK_METHODS = [
	'getConversations',
	'getConversation',
	'deleteConversation',
	'createConversationMessageVote',
	'myRoboRewstyPreferences',
	'addAllowedTool',
	'removeAllowedTool',
	'listTemplates',
	'createTemplateMinimal',
	'updateTemplate',
	'updateTemplateBody',
	'updateTemplateName',
	'getTemplate',
	'deleteTemplate',
	'User',
] as const satisfies readonly (keyof Sdk & string)[];

export type EditorSessionSdkMethod = (typeof SDK_METHODS)[number];

function stringInput(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing required string argument "${key}".`);
	return value.trim();
}

function sessionIdInput(input: Record<string, unknown>): string {
	return stringInput(input, 'sessionId');
}

function orgIdInput(input: Record<string, unknown>): string {
	return stringInput(input, 'orgId');
}

function userId(session: Session): string {
	const id = session.profile.user.id;
	if (typeof id !== 'string' || id.length === 0) throw new Error('Session profile has no user id.');
	return id;
}

function ownsOrg(session: Session, orgId: string): boolean {
	return session.profile.org.id === orgId || session.profile.allManagedOrgs.some(org => org.id === orgId);
}

function snapshot(session: Session): SessionSnapshot {
	return { sessionId: userId(session), profile: session.profile, expired: session.isExpired() };
}

function snapshotForProfile(profile: SessionProfile): SessionSnapshot {
	return { sessionId: userIdFromProfile(profile), profile, expired: true };
}

function userIdFromProfile(profile: SessionProfile): string {
	const id = profile.user.id;
	if (typeof id !== 'string' || id.length === 0) throw new Error('Session profile has no user id.');
	return id;
}

interface SessionSnapshotResult {
	sessions: SessionSnapshot[];
	knownProfiles: SessionProfile[];
}

export function sessionSnapshots(): SessionSnapshotResult {
	const activeSessions = SessionManager.getActiveSessions();
	const active = new Map(activeSessions.map(session => [userId(session), snapshot(session)]));
	const profileById = new Map(
		SessionManager.getAllKnownProfiles().map(profile => [userIdFromProfile(profile), profile]),
	);
	for (const session of activeSessions) profileById.set(userId(session), session.profile);
	const knownProfiles = [...profileById.values()];
	return {
		sessions: knownProfiles.map(profile => active.get(userIdFromProfile(profile)) ?? snapshotForProfile(profile)),
		knownProfiles,
	};
}

const allSnapshots = sessionSnapshots;

async function requireSession(input: Record<string, unknown>, requireOrg = false): Promise<Session> {
	const session = findSession(input);
	if (!(await session.ensureValid())) throw new Error(`Session "${userId(session)}" is expired or unavailable.`);
	if (requireOrg) {
		const orgId = orgIdInput(input);
		if (!ownsOrg(session, orgId))
			throw new Error(`Session "${userId(session)}" does not manage organization "${orgId}".`);
	}
	return session;
}

function findSession(input: Record<string, unknown>): Session {
	const id = sessionIdInput(input);
	const session = SessionManager.sessionMap.get(id);
	if (!session) throw new Error(`No active session found for sessionId "${id}".`);
	return session;
}

function nestedOrgIds(value: unknown): string[] {
	if (!value || typeof value !== 'object') return [];
	const record = value as Record<string, unknown>;
	const found: string[] = [];
	for (const key of ['orgId', 'organizationId'])
		if (typeof record[key] === 'string') found.push(record[key] as string);
	for (const key of ['where', 'template', 'input', 'variables']) found.push(...nestedOrgIds(record[key]));
	return found;
}

function assertSdkArgsOrgScope(session: Session, args: unknown): void {
	for (const orgId of nestedOrgIds(args)) {
		if (!ownsOrg(session, orgId))
			throw new Error(`Session "${userId(session)}" does not manage organization "${orgId}".`);
	}
}

async function sdkOperation(method: EditorSessionSdkMethod, input: Record<string, unknown>): Promise<unknown> {
	const session = await requireSession(input);
	const args = input.args;
	assertSdkArgsOrgScope(session, args);
	const fn = session.sdk?.[method] as ((args?: unknown) => Promise<unknown>) | undefined;
	if (!fn) throw new Error(`SDK operation "${method}" is unavailable for this session.`);
	return method === 'User' || args === undefined ? fn() : fn(args);
}

async function create(input: Record<string, unknown>): Promise<SessionSnapshot> {
	const cookies =
		typeof input.cookies === 'string' ? input.cookies : typeof input.token === 'string' ? input.token : undefined;
	const options = input.persist === false ? { persist: false } : {};
	return snapshot(await SessionManager.createSession(cookies, options));
}

async function forOrg(input: Record<string, unknown>): Promise<SessionSnapshot> {
	const region = typeof input.region === 'string' ? input.region : undefined;
	const session = region
		? await SessionManager.getOrgSession(orgIdInput(input), new URL(region))
		: await SessionManager.getSessionForOrg(orgIdInput(input));
	return snapshot(session);
}

async function forRegion(input: Record<string, unknown>): Promise<SessionSnapshot[]> {
	const requested = stringInput(input, 'region');
	const host = (() => {
		try {
			return new URL(requested).host;
		} catch {
			return requested;
		}
	})();
	return (await SessionManager.loadSessions())
		.filter(
			session =>
				new URL(session.profile.region.loginUrl).host === host || session.profile.region.name === requested,
		)
		.map(snapshot);
}

async function getTemplate(input: Record<string, unknown>): Promise<unknown> {
	const session = await requireSession(input);
	const expectedOrg = typeof input.orgId === 'string' ? input.orgId : undefined;
	if (expectedOrg && !ownsOrg(session, expectedOrg))
		throw new Error(`Session does not manage organization "${expectedOrg}".`);
	const template = await session.getTemplate(stringInput(input, 'templateId'));
	const templateOrg = (template as { orgId?: unknown } | undefined)?.orgId;
	if (typeof templateOrg === 'string' && !ownsOrg(session, templateOrg)) {
		throw new Error(`Template is outside the session's managed organizations.`);
	}
	if (expectedOrg && templateOrg !== expectedOrg)
		throw new Error(`Template does not belong to organization "${expectedOrg}".`);
	return template;
}

async function ask(
	input: Record<string, unknown>,
	context: EditorSessionOperationContext,
): Promise<{ streamId: string }> {
	const session = await requireSession({ ...input, orgId: input.orgId }, true);
	const streamId = stringInput(input, 'streamId');
	const message = stringInput(input, 'message');
	for await (const event of askRewstAi({
		session,
		orgId: orgIdInput(input),
		message,
		conversationId: typeof input.conversationId === 'string' ? input.conversationId : undefined,
		conversationType: typeof input.conversationType === 'string' ? input.conversationType : undefined,
		resumeRequestId: typeof input.resumeRequestId === 'string' ? input.resumeRequestId : undefined,
		cancellation: context.signal,
	})) {
		await context.emit({ streamId, event: event as ConversationEvent });
	}
	return { streamId };
}

type Operation = (input: Record<string, unknown>, context: EditorSessionOperationContext) => Promise<unknown>;

const operations: Record<string, Operation> = {
	'sessions.snapshot': async () => {
		return allSnapshots();
	},
	'sessions.load': async () => {
		await SessionManager.loadSessions();
		return allSnapshots();
	},
	'sessions.create': async input => create(input),
	'sessions.remove': async input => {
		await SessionManager.removeSession(sessionIdInput(input));
		return allSnapshots();
	},
	'sessions.clear': async () => {
		await SessionManager.clearProfiles();
		return [];
	},
	'sessions.refresh': async () => {
		await SessionManager.refreshActiveSessions();
		return allSnapshots();
	},
	'sessions.forOrg': async input => forOrg(input),
	'sessions.forRegion': async input => forRegion(input),
	'session.validate': async input => (await findSession(input)).validate(),
	'session.ensureValid': async input => (await findSession(input)).ensureValid(),
	'session.refresh': async input => {
		const session = findSession(input);
		await session.refreshToken();
		return snapshot(session);
	},
	'session.getTemplate': async input => getTemplate(input),
	'conversation.ask': ask,
	'conversation.seed': async input => {
		const session = await requireSession({ ...input, orgId: input.orgId }, true);
		const orgId = orgIdInput(input);
		const conversationType = stringInput(input, 'conversationType');
		if (!Array.isArray(input.chunks)) throw new Error('conversation.seed requires a chunks array.');
		return seedConversation(session, orgId, conversationType, input.chunks as SeedChunk[]);
	},
};

for (const method of SDK_METHODS) {
	operations[`session.sdk.${method}`] = input => sdkOperation(method, input);
}

export const editorSessionOperations: Record<string, Operation> = operations;

export const editorSessionSdkMethods = SDK_METHODS;
