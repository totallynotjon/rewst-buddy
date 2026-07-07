/**
 * Unit tests for PickJinjaPreviewContext command.
 *
 * Runner: mocha extension-host.
 */

import { context as extContext } from '@global';
import { LinkManager, type TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { Fixtures, initTestEnvironment, stub } from '@test';
import { log } from '@utils';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { JinjaPreviewSession } from '../../ui/jinja/JinjaPreviewSession';
import { JinjaRenderedContentProvider } from '../../ui/jinja/JinjaRenderedContentProvider';
import { PickJinjaPreviewContext } from './PickJinjaPreviewContext';

const { suite, test, setup, teardown, suiteSetup, suiteTeardown } = Mocha;

suite('Unit: PickJinjaPreviewContext', () => {
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
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-pickcontext-'));
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

	test('notifies and does not attempt a pick for an unlinked file', async () => {
		const uri = writeFile('unlinked.j2', 'hello');

		let notifyCalls = 0;
		const restoreNotify = stub(log, 'notifyError', ((message: string) => {
			notifyCalls++;
			return new Error(message);
		}) as typeof log.notifyError);
		const restoreShow = stubShowTextDocument();

		try {
			await new PickJinjaPreviewContext().execute([uri]);
		} finally {
			restoreNotify();
			restoreShow();
		}

		assert.strictEqual(notifyCalls, 1, 'should notify error for unlinked file');
	});

	test('creates the preview session and picks context for a linked file', async () => {
		const uri = writeFile('linked.j2', 'hello {{ CTX.x }}');
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Org One' });
		linkFile(uri, org.id, 'tpl-1');

		const fakeSession = {
			rawGraphql: async (query: string, vars?: Record<string, unknown>) => {
				if (query.includes('RewstBuddyPreviewWorkflows')) {
					return { data: { workflows: [{ id: 'wf-1', name: 'Workflow One', orgId: org.id }] } };
				}
				if (query.includes('RewstBuddyExecutions')) {
					assert.deepStrictEqual(vars?.where, { workflowId: 'wf-1', orgId: org.id });
					return {
						data: {
							workflowExecutions: [
								{ id: 'exec-1', status: 'succeeded', createdAt: '1000', numSuccessfulTasks: 1 },
							],
						},
					};
				}
				if (query.includes('RewstBuddyExecutionContexts')) {
					return { data: { workflowExecutionContexts: [{ picked: true }] } };
				}
				if (query.includes('RewstBuddyRenderJinja')) {
					return { data: { renderJinja: { result: vars?.vars } } };
				}
				return { data: {} };
			},
			profile: {
				org: { id: org.id, name: org.name },
				allManagedOrgs: [{ id: org.id, name: org.name }],
				user: { id: 'user-1' },
			},
		} as any;
		const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async () => fakeSession) as any);
		const restoreActiveSessions = stub(SessionManager, 'getActiveSessions', (() => [fakeSession]) as any);
		const restoreShow = stubShowTextDocument();
		const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (items: unknown, options?: unknown) => {
			const title = (options as { title?: string } | undefined)?.title ?? '';
			const resolved = (await items) as readonly (vscode.QuickPickItem & { orgId?: string })[];
			if (title.includes('Org')) return resolved.find(item => item.orgId === org.id) ?? resolved[0];
			return resolved[0];
		}) as unknown as typeof vscode.window.showQuickPick);

		try {
			await new PickJinjaPreviewContext().execute([uri]);
		} finally {
			restoreGetSession();
			restoreActiveSessions();
			restoreShow();
			restoreQuickPick();
		}

		const rendered = JinjaRenderedContentProvider.provideTextDocumentContent(
			JinjaRenderedContentProvider.uriFor('tpl-1', 'Linked Template'),
		);
		assert.ok(rendered.includes('picked'), 'expected the picked execution context to have been rendered');
	});

	test('resolves the owning template when invoked from the vars/overrides pane, not just the template tab', async () => {
		const uri = writeFile('linked2.j2', 'hello {{ CTX.x }}');
		const org = Fixtures.orgModel({ id: 'org-2', name: 'Org Two' });
		linkFile(uri, org.id, 'tpl-2');

		const fakeSession = {
			rawGraphql: async (query: string, vars?: Record<string, unknown>) => {
				if (query.includes('RewstBuddyPreviewWorkflows')) {
					return { data: { workflows: [{ id: 'wf-2', name: 'Workflow Two', orgId: org.id }] } };
				}
				if (query.includes('RewstBuddyExecutions')) {
					return {
						data: {
							workflowExecutions: [
								{ id: 'exec-2', status: 'succeeded', createdAt: '1000', numSuccessfulTasks: 1 },
							],
						},
					};
				}
				if (query.includes('RewstBuddyExecutionContexts')) {
					return { data: { workflowExecutionContexts: [{ pickedFromVarsPane: true }] } };
				}
				if (query.includes('RewstBuddyRenderJinja')) {
					return { data: { renderJinja: { result: vars?.vars } } };
				}
				return { data: {} };
			},
			profile: {
				org: { id: org.id, name: org.name },
				allManagedOrgs: [{ id: org.id, name: org.name }],
				user: { id: 'user-2' },
			},
		} as any;
		const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async () => fakeSession) as any);
		const restoreActiveSessions = stub(SessionManager, 'getActiveSessions', (() => [fakeSession]) as any);
		const restoreShow = stubShowTextDocument();
		const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (items: unknown, options?: unknown) => {
			const title = (options as { title?: string } | undefined)?.title ?? '';
			const resolved = (await items) as readonly (vscode.QuickPickItem & { orgId?: string })[];
			if (title.includes('Org')) return resolved.find(item => item.orgId === org.id) ?? resolved[0];
			return resolved[0];
		}) as unknown as typeof vscode.window.showQuickPick);

		try {
			// First open the layout normally (creates the session + vars/rendered panes).
			const state = await JinjaPreviewSession.createOrShow(uri, extContext);

			// Now invoke the command as if the button were clicked from the vars/overrides
			// pane itself, not the template's own tab.
			await new PickJinjaPreviewContext().execute([state.overridesUri]);
		} finally {
			restoreGetSession();
			restoreActiveSessions();
			restoreShow();
			restoreQuickPick();
		}

		const rendered = JinjaRenderedContentProvider.provideTextDocumentContent(
			JinjaRenderedContentProvider.uriFor('tpl-2', 'Linked Template'),
		);
		assert.ok(
			rendered.includes('pickedFromVarsPane'),
			'expected the context picked from the vars pane to render against the owning template',
		);
	});
});
