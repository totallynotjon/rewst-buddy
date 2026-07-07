/**
 * Unit tests for PreviewJinjaRender command.
 *
 * Runner: mocha extension-host.
 */

import { context as extContext } from '@global';
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
import { JinjaPreviewSession } from '../../ui/jinja/JinjaPreviewSession';
import { JinjaRenderedContentProvider } from '../../ui/jinja/JinjaRenderedContentProvider';
import { PreviewJinjaRender } from './PreviewJinjaRender';

const { suite, test, setup, teardown, suiteSetup, suiteTeardown } = Mocha;

suite('Unit: PreviewJinjaRender', () => {
	let tmpDir: string;

	suiteSetup(() => {
		JinjaRenderedContentProvider.init();
		JinjaPreviewSession.init();
	});

	suiteTeardown(() => {
		JinjaPreviewSession.dispose();
		JinjaRenderedContentProvider.dispose();
	});

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		JinjaPreviewSession._resetForTesting();
		JinjaRenderedContentProvider._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-preview-'));
		Object.assign(extContext, { globalStorageUri: vscode.Uri.file(tmpDir) });
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		JinjaPreviewSession._resetForTesting();
		JinjaRenderedContentProvider._resetForTesting();
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

	function stubShowTextDocument(): () => void {
		const restoreShow = stub(vscode.window, 'showTextDocument', (async (docOrUri: any) => {
			const doc =
				docOrUri && typeof docOrUri.getText === 'function'
					? docOrUri
					: await vscode.workspace.openTextDocument(docOrUri);
			return { document: doc } as vscode.TextEditor;
		}) as unknown as typeof vscode.window.showTextDocument);
		// createOrShow's "no existing tab" path calls this to stack the rendered
		// pane under the vars pane — no real editor layout exists in the test
		// host, so stub it out rather than let it act on whatever's really open.
		const realExecuteCommand = vscode.commands.executeCommand.bind(vscode.commands);
		const restoreExecuteCommand = stub(vscode.commands, 'executeCommand', (async (
			command: string,
			...rest: unknown[]
		) => {
			if (command === 'workbench.action.splitEditorDown') return undefined;
			return realExecuteCommand(command, ...rest);
		}) as unknown as typeof vscode.commands.executeCommand);
		return () => {
			restoreShow();
			restoreExecuteCommand();
		};
	}

	test('notifies and does not open a session for an unlinked file', async () => {
		const uri = writeFile('unlinked.j2', 'hello');

		let notifyCalls = 0;
		const restoreNotify = stub(log, 'notifyError', ((message: string) => {
			notifyCalls++;
			return new Error(message);
		}) as typeof log.notifyError);
		const restoreShow = stubShowTextDocument();

		try {
			await new PreviewJinjaRender().execute([uri]);
		} finally {
			restoreNotify();
			restoreShow();
		}

		assert.strictEqual(notifyCalls, 1, 'should notify error for unlinked file');
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

		const restoreShow = stubShowTextDocument();

		try {
			await new PreviewJinjaRender().execute([uri]);
		} finally {
			restoreGetLink();
			restoreGetSession();
			restoreShow();
		}

		assert.strictEqual(
			resolvedOrgId,
			'org-real',
			'should resolve org from template.orgId via orgForTemplateLink, not from link.org',
		);
	});

	test('reveals the existing session instead of recreating it for the same uri', async () => {
		const uri = writeFile('linked.j2', 'hello');
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org One' });
		linkFile(uri, org.id, 'tpl-1');

		const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		SessionManager._setSessionsForTesting([session]);

		const showCalls: string[] = [];
		const restoreShow = stub(vscode.window, 'showTextDocument', (async (docOrUri: any) => {
			const doc =
				docOrUri && typeof docOrUri.getText === 'function'
					? docOrUri
					: await vscode.workspace.openTextDocument(docOrUri);
			showCalls.push(doc.uri.toString());
			return { document: doc } as vscode.TextEditor;
		}) as unknown as typeof vscode.window.showTextDocument);
		const realExecuteCommand = vscode.commands.executeCommand.bind(vscode.commands);
		const restoreExecuteCommand = stub(vscode.commands, 'executeCommand', (async (
			command: string,
			...rest: unknown[]
		) => {
			if (command === 'workbench.action.splitEditorDown') return undefined;
			return realExecuteCommand(command, ...rest);
		}) as unknown as typeof vscode.commands.executeCommand);

		try {
			await new PreviewJinjaRender().execute([uri]);
			const callsAfterFirst = showCalls.length;
			assert.ok(callsAfterFirst > 0, 'first call should open the overrides and rendered panes');

			await new PreviewJinjaRender().execute([uri]);
			assert.ok(showCalls.length > callsAfterFirst, 'second call should reveal (re-show) the existing panes');
		} finally {
			restoreExecuteCommand();
			restoreShow();
		}
	});
});
