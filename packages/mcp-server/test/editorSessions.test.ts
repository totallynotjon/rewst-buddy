import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureRuntimeHost, type RuntimeHost } from '../src/host';
import { editorSessionOperations, editorSessionSdkMethods } from '../src/editorSessions';
import { SessionManager } from '../src/sessions/SessionManager';
import Session from '../src/sessions/Session';
import type SessionProfile from '../src/sessions/SessionProfile';
import type { RegionConfig } from '../src/sessions/RegionConfig';

const region: RegionConfig = {
	name: 'Test',
	cookieName: 'appSession',
	graphqlUrl: 'https://api.example.test/graphql',
	loginUrl: 'https://app.example.test',
};

function configureHost(): void {
	const state = new Map<string, unknown>();
	const secrets = new Map<string, string>();
	const host: RuntimeHost = {
		state: {
			get: ((key: string, fallback?: unknown) =>
				state.has(key) ? state.get(key) : fallback) as RuntimeHost['state']['get'],
			update: async (key, value) => {
				state.set(key, value);
			},
		},
		secrets: {
			get: async key => secrets.get(key),
			store: async (key, value) => {
				secrets.set(key, value);
			},
			delete: async key => {
				secrets.delete(key);
			},
		},
		getSetting: (_key, fallback) => fallback,
		log: () => {},
	};
	configureRuntimeHost(host);
}

function profile(userId = 'user-1'): SessionProfile {
	const user = {
		id: userId,
		username: 'alice',
		roleIds: [],
		organization: { id: 'org-root', name: 'Root', managedAndSubOrgs: [{ id: 'org-sub', name: 'Sub' }] },
		allManagedOrgs: [{ id: 'org-other', name: 'Other' }],
	};
	return {
		region,
		org: { id: 'org-root', name: 'Root' },
		allManagedOrgs: [
			{ id: 'org-root', name: 'Root' },
			{ id: 'org-sub', name: 'Sub' },
			{ id: 'org-other', name: 'Other' },
		],
		label: 'alice (Root)',
		user: user as never,
	};
}

describe('editor session operations', () => {
	beforeEach(() => {
		configureHost();
		SessionManager._resetForTesting();
	});

	it('returns profiles and expired state without exposing cookies', async () => {
		const session = new Session({ User: vi.fn().mockResolvedValue({ user: profile().user }) } as never, profile());
		SessionManager._setSessionsForTesting([session]);

		const result = await editorSessionOperations['sessions.snapshot'](
			{},
			{ signal: new AbortController().signal, emit: async () => {} },
		);
		expect(result).toMatchObject({
			sessions: [{ sessionId: 'user-1', expired: false }],
			knownProfiles: [profile()],
		});
		expect(result).not.toHaveProperty('cookies');
	});

	it('seeds a role-aware conversation and returns its id', async () => {
		const session = new Session({ User: vi.fn().mockResolvedValue({ user: profile().user }) } as never, profile());
		const rawGraphql = vi
			.spyOn(session, 'rawGraphql')
			.mockResolvedValueOnce({ data: { createConversation: { id: 'conv-1' } } })
			.mockResolvedValueOnce({ data: { createConversationMessage: { id: 'msg-1' } } })
			.mockResolvedValueOnce({ data: { createConversationMessage: { id: 'msg-2' } } });
		SessionManager._setSessionsForTesting([session]);

		const result = await editorSessionOperations['conversation.seed'](
			{
				sessionId: 'user-1',
				orgId: 'org-root',
				conversationType: 'HELP_DOCS',
				chunks: [
					{ role: 'USER', content: 'what is a trigger?' },
					{ role: 'ASSISTANT', content: 'An event that starts a workflow.' },
				],
			},
			{ signal: new AbortController().signal, emit: async () => {} },
		);

		expect(result).toBe('conv-1');
		expect(rawGraphql).toHaveBeenCalledTimes(3);
		expect(rawGraphql.mock.calls[0]?.[1]).toEqual({
			conversation: { orgId: 'org-root', title: 'rewst-buddy', type: 'HELP_DOCS' },
		});
		expect(rawGraphql.mock.calls[1]?.[1]).toEqual({
			message: { conversationId: 'conv-1', role: 'USER', content: 'what is a trigger?' },
		});
		expect(rawGraphql.mock.calls[2]?.[1]).toEqual({
			message: { conversationId: 'conv-1', role: 'ASSISTANT', content: 'An event that starts a workflow.' },
		});
	});

	it('rejects malformed seed content instead of silently dropping it', async () => {
		const session = new Session({ User: vi.fn().mockResolvedValue({ user: profile().user }) } as never, profile());
		const rawGraphql = vi
			.spyOn(session, 'rawGraphql')
			.mockResolvedValueOnce({ data: { createConversation: { id: 'conv-malformed' } } })
			.mockResolvedValueOnce({ data: { deleteConversation: 'conv-malformed' } });
		SessionManager._setSessionsForTesting([session]);

		await expect(
			editorSessionOperations['conversation.seed'](
				{
					sessionId: 'user-1',
					orgId: 'org-root',
					conversationType: 'HELP_DOCS',
					chunks: [{ role: 'USER', content: 42 } as never],
				},
				{ signal: new AbortController().signal, emit: async () => {} },
			),
		).rejects.toThrow(/non-string message content/);
		expect(rawGraphql).toHaveBeenCalledTimes(2);
		expect(rawGraphql.mock.calls[1]?.[1]).toEqual({ id: 'conv-malformed' });
	});

	it('enforces managed organization scope for SDK calls', async () => {
		const method = vi.fn().mockResolvedValue({ ok: true });
		const session = new Session(
			{ User: vi.fn().mockResolvedValue({ user: profile().user }), getTemplate: method } as never,
			profile(),
		);
		SessionManager._setSessionsForTesting([session]);
		await expect(
			editorSessionOperations['session.sdk.getTemplate'](
				{ sessionId: 'user-1', args: { orgId: 'outside' } },
				{
					signal: new AbortController().signal,
					emit: async () => {},
				},
			),
		).rejects.toThrow('does not manage organization');
		expect(method).not.toHaveBeenCalled();
	});

	it('keeps SDK operation names finite and rejects raw cookie access', () => {
		expect(editorSessionSdkMethods).toContain('getTemplate');
		expect(editorSessionSdkMethods).not.toContain('rawGraphql');
		expect(editorSessionSdkMethods).not.toContain('getCookies');
		expect(editorSessionOperations['session.sdk.rawGraphql']).toBeUndefined();
	});
});
