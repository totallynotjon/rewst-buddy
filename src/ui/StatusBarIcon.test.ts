import * as assert from 'assert';
import * as Mocha from 'mocha';
import { LinkManager, SyncOnSaveManager, type TemplateLink } from '@models';
import { Session, SessionManager } from '@sessions';
import { Fixtures, initTestEnvironment, stub } from '@test';
import vscode from 'vscode';
import { StatusBar } from './StatusBarIcon';

const { suite, test, setup, teardown } = Mocha;

function itemOf(bar: StatusBar): vscode.StatusBarItem {
	return (bar as unknown as { item: vscode.StatusBarItem }).item;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => (resolve = r));
	return { promise, resolve };
}

suite('Unit: StatusBar', () => {
	const restores: (() => void)[] = [];

	function stubActiveEditor(uri: vscode.Uri | undefined): void {
		restores.push(
			stub(
				vscode.window,
				'activeTextEditor',
				(uri ? { document: { uri } } : undefined) as unknown as vscode.TextEditor,
			),
		);
	}

	setup(() => {
		initTestEnvironment();
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
		SessionManager._resetForTesting();
	});

	test('a slow session lookup for a previous file does not overwrite the status bar set for the current file', async () => {
		const uriA = vscode.Uri.file('/test/docA.jinja');
		const uriB = vscode.Uri.file('/test/docB.jinja');

		const linkA: TemplateLink = {
			type: 'Template',
			uriString: uriA.toString(),
			org: { id: 'org-A', name: 'Org A' },
			bodyHash: 'hash-a',
			template: Fixtures.fullTemplate({ name: 'Template A' }),
		};
		const linkB: TemplateLink = {
			type: 'Template',
			uriString: uriB.toString(),
			org: { id: 'org-B', name: 'Org B' },
			bodyHash: 'hash-b',
			template: Fixtures.fullTemplate({ name: 'Template B' }),
		};

		restores.push(
			stub(LinkManager, 'getTemplateLink', ((uri: vscode.Uri) =>
				uri.toString() === uriA.toString() ? linkA : linkB) as typeof LinkManager.getTemplateLink),
		);
		restores.push(
			stub(SessionManager, 'hasActiveSessions', (() => true) as typeof SessionManager.hasActiveSessions),
		);

		const orgAGate = deferred<Session>();
		restores.push(
			stub(SessionManager, 'getSessionForOrg', ((orgId: string) =>
				orgId === 'org-A'
					? orgAGate.promise
					: Promise.resolve({} as Session)) as typeof SessionManager.getSessionForOrg),
		);
		restores.push(
			stub(
				SyncOnSaveManager,
				'isUriSynced',
				((uri: vscode.Uri) => uri.toString() === uriB.toString()) as typeof SyncOnSaveManager.isUriSynced,
			),
		);

		// Prevent the constructor's own fire-and-forget update() from racing the
		// manual calls below.
		stubActiveEditor(undefined);
		const bar = new StatusBar();
		try {
			stubActiveEditor(uriA);
			const callA = bar.update();

			stubActiveEditor(uriB);
			await bar.update();

			assert.strictEqual(
				itemOf(bar).text,
				'Rewst Sync-On-Save: ON $(check)',
				'the current file (B) should show its own synced state',
			);

			orgAGate.resolve({} as Session);
			await callA;

			assert.strictEqual(
				itemOf(bar).text,
				'Rewst Sync-On-Save: ON $(check)',
				"the stale update for file A must not overwrite file B's status once A's slow lookup resolves",
			);
		} finally {
			bar.dispose();
		}
	});
});
