import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import vscode from 'vscode';
import { ResumeRewstAiConversation } from './ResumeRewstAiConversation';

const { suite, test, setup, teardown } = Mocha;

interface ConversationPickItem {
	label: string;
	description: string;
	detail: string;
	id: string;
}

function storedConversation(id: string, title: string, firstMessage: string) {
	return {
		id,
		title,
		type: 'HELP_DOCS',
		orgId: 'org-ai',
		userId: 'user-1',
		createdAt: '2026-06-01T00:00:00Z',
		updatedAt: '2026-06-02T00:00:00Z',
		firstUserMessage: { content: firstMessage, role: 'USER', createdAt: '2026-06-01T00:00:00Z' },
	};
}

suite('Unit: ResumeRewstAiConversation', () => {
	const restores: (() => void)[] = [];

	function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): void {
		const original = obj[key];
		Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
		restores.push(() => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true }));
	}

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
		SessionManager._resetForTesting();
	});

	test('lists recent conversations and opens the picked transcript as a markdown document', async () => {
		const org = Fixtures.orgModel({ id: 'org-ai', name: 'AI Org' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getConversations', {
			data: {
				conversations: [
					storedConversation('conv-new', 'Copy status sync', 'how do I sync?'),
					storedConversation('conv-old', 'Jinja loops', 'loop over a list'),
				],
			},
		});
		wrapper.when('getConversation', {
			data: {
				conversation: {
					id: 'conv-old',
					title: 'Jinja loops',
					messages: [
						{ role: 'USER', content: 'loop over a list' },
						{ role: 'ASSISTANT', content: 'Use {% for %}.' },
					],
				},
			},
		});
		SessionManager._setSessionsForTesting([session]);

		let offered: readonly ConversationPickItem[] = [];
		stub(vscode.window, 'showQuickPick', (async (items: readonly ConversationPickItem[]) => {
			offered = items;
			return items.find(item => item.id === 'conv-old');
		}) as unknown as typeof vscode.window.showQuickPick);

		const shown: vscode.TextDocument[] = [];
		stub(vscode.window, 'showTextDocument', (async (document: vscode.TextDocument) => {
			shown.push(document);
			return undefined as unknown as vscode.TextEditor;
		}) as unknown as typeof vscode.window.showTextDocument);

		await new ResumeRewstAiConversation().execute();

		assert.strictEqual(wrapper.getCallsFor('getConversations')[0].variables.where.orgId, 'org-ai');
		assert.deepStrictEqual(
			offered.map(item => item.label),
			['Copy status sync', 'Jinja loops'],
			'recent conversations are listed',
		);
		assert.deepStrictEqual(
			wrapper.getCallsFor('getConversation').map(call => call.variables),
			[{ id: 'conv-old' }],
			'only the picked conversation is fetched',
		);
		assert.strictEqual(shown.length, 1, 'the transcript document is opened');
		assert.strictEqual(shown[0].languageId, 'markdown');
		const transcript = shown[0].getText();
		assert.ok(transcript.includes('**Resumed conversation: Jinja loops**'));
		assert.ok(transcript.includes('**You:** loop over a list'));
		assert.ok(transcript.includes('Use {% for %}.'));
	});

	test('cancelling the picker fetches no transcript and opens nothing', async () => {
		const org = Fixtures.orgModel({ id: 'org-ai', name: 'AI Org' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getConversations', {
			data: { conversations: [storedConversation('conv-1', 'Copy status sync', 'how do I sync?')] },
		});
		SessionManager._setSessionsForTesting([session]);

		stub(vscode.window, 'showQuickPick', (async () => undefined) as unknown as typeof vscode.window.showQuickPick);
		const shown: vscode.TextDocument[] = [];
		stub(vscode.window, 'showTextDocument', (async (document: vscode.TextDocument) => {
			shown.push(document);
			return undefined as unknown as vscode.TextEditor;
		}) as unknown as typeof vscode.window.showTextDocument);

		await new ResumeRewstAiConversation().execute();

		assert.strictEqual(wrapper.getCallsFor('getConversation').length, 0);
		assert.strictEqual(shown.length, 0);
	});
});
