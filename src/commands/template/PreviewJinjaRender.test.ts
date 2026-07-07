/**
 * Unit tests for PreviewJinjaRender command.
 *
 * Runner: mocha extension-host.
 */

import { LinkManager, type TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment, stub } from '@test';
import { log } from '@utils';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { PreviewJinjaRender } from './PreviewJinjaRender';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: PreviewJinjaRender', () => {
	let tmpDir: string;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-preview-'));
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeFile(name: string, content: string): vscode.Uri {
		const filePath = path.join(tmpDir, name);
		fs.writeFileSync(filePath, content);
		return vscode.Uri.file(filePath);
	}

	function linkFile(uri: vscode.Uri, orgId: string, templateId: string): TemplateLink {
		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: { id: orgId, name: 'Org One' },
			template: { id: templateId, name: 'Linked Template', updatedAt: '', orgId } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(link);
		return link;
	}

	test('notifies and does not open a panel for an unlinked file', async () => {
		const uri = writeFile('unlinked.j2', 'hello');

		let notifyCalls = 0;
		const restoreNotify = stub(log, 'notifyError', ((message: string) => {
			notifyCalls++;
			return new Error(message);
		}) as typeof log.notifyError);

		// Track whether JinjaPreviewPanel.createOrShow was called by checking
		// if createWebviewPanel was invoked (the panel is the only caller).
		let panelCreated = false;
		const restorePanel = stub(vscode.window, 'createWebviewPanel', ((...args: unknown[]) => {
			panelCreated = true;
			// Return a minimal stub so the code doesn't crash if it does call it
			return {
				dispose: () => {},
				onDidDispose: () => ({ dispose: () => {} }),
				webview: {
					html: '',
					onDidReceiveMessage: () => ({ dispose: () => {} }),
					asWebviewUri: (u: unknown) => u,
					cspSource: '',
				},
				reveal: () => {},
			} as any;
		}) as typeof vscode.window.createWebviewPanel);

		try {
			await new PreviewJinjaRender().execute([uri]);
		} finally {
			restoreNotify();
			restorePanel();
		}

		assert.strictEqual(notifyCalls, 1, 'should notify error for unlinked file');
		assert.strictEqual(panelCreated, false, 'should not open a panel for an unlinked file');
	});

	test('resolves org via orgForTemplateLink, not link.org, when template.orgId differs', async () => {
		const uri = writeFile('linked.j2', 'hello {{ CTX.x }}');

		// Build a divergent link where link.org.id differs from template.orgId.
		// We inject it BELOW the normalization seam by stubbing getTemplateLink
		// directly, so the divergence is not pre-normalized by addLink.
		const divergentLink: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: { id: 'org-stale', name: 'Stale Org' },
			template: {
				id: 'tpl-1',
				name: 'Template',
				updatedAt: '',
				orgId: 'org-real',
				organization: { id: 'org-real', name: 'Real Org' },
			} as any,
			bodyHash: 'hash',
		};

		// Stub getTemplateLink to return the divergent link directly (bypasses normalization)
		const restoreGetLink = stub(LinkManager, 'getTemplateLink', ((_uri: vscode.Uri) => {
			return divergentLink;
		}) as typeof LinkManager.getTemplateLink);

		const org = Fixtures.orgModel({ id: 'org-real', name: 'Real Org' });
		const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		SessionManager._setSessionsForTesting([session]);

		let resolvedOrgId: string | undefined;
		const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async (orgId: string) => {
			resolvedOrgId = orgId;
			return session;
		}) as typeof SessionManager.getSessionForOrg);

		// Stub createWebviewPanel to avoid actually creating a panel
		const restorePanel = stub(vscode.window, 'createWebviewPanel', ((..._args: unknown[]) => {
			return {
				dispose: () => {},
				onDidDispose: (_cb: () => void) => ({ dispose: () => {} }),
				webview: {
					html: '',
					onDidReceiveMessage: () => ({ dispose: () => {} }),
					asWebviewUri: (u: unknown) => u,
					cspSource: 'vscode-webview:',
				},
				reveal: () => {},
			} as any;
		}) as typeof vscode.window.createWebviewPanel);

		try {
			await new PreviewJinjaRender().execute([uri]);
		} finally {
			restoreGetLink();
			restoreGetSession();
			restorePanel();
		}

		assert.strictEqual(
			resolvedOrgId,
			'org-real',
			'should resolve org from template.orgId via orgForTemplateLink, not from link.org',
		);
	});

	test('reveals an existing panel instead of creating a second one for the same uri', async () => {
		const uri = writeFile('linked.j2', 'hello');
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org One' });
		linkFile(uri, org.id, 'tpl-1');

		const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		SessionManager._setSessionsForTesting([session]);

		let createCount = 0;
		let revealCount = 0;

		const fakePanel = {
			dispose: () => {},
			onDidDispose: (_cb: () => void) => ({ dispose: () => {} }),
			webview: {
				html: '',
				onDidReceiveMessage: () => ({ dispose: () => {} }),
				asWebviewUri: (u: unknown) => u,
				cspSource: 'vscode-webview:',
				postMessage: async () => true,
			},
			reveal: () => {
				revealCount++;
			},
		} as any;

		const restorePanel = stub(vscode.window, 'createWebviewPanel', ((..._args: unknown[]) => {
			createCount++;
			return fakePanel;
		}) as typeof vscode.window.createWebviewPanel);

		try {
			await new PreviewJinjaRender().execute([uri]);
			await new PreviewJinjaRender().execute([uri]);
		} finally {
			restorePanel();
		}

		assert.strictEqual(createCount, 1, 'panel should only be created once');
		assert.strictEqual(revealCount, 1, 'existing panel should be revealed on second call');
	});
});
