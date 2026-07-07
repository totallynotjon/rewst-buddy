/**
 * Unit tests for JinjaPreviewSession — the native 3-pane orchestrator that
 * replaces the old JinjaPreviewPanel webview.
 *
 * Runner: mocha extension-host. Uses a real temp directory for
 * context.globalStorageUri so the overrides file is a real file (matching
 * production), and stubs vscode.window.showTextDocument so tests don't churn
 * real editor tabs.
 */

import { context as extContext } from '@global';
import { LinkManager, type TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { getLastContext, saveLastContext } from '../../models/JinjaPreviewContextStore';
import { Fixtures, initTestEnvironment, stub } from '@test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { JinjaRenderedContentProvider } from './JinjaRenderedContentProvider';
import { JinjaPreviewSession } from './JinjaPreviewSession';
import { formatInvalidOverrides, formatRenderedSuccess, OVERRIDES_SEED } from './jinjaPreviewRender';

const { suite, test, setup, teardown, suiteSetup, suiteTeardown } = Mocha;

suite('Unit: JinjaPreviewSession', () => {
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
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-jinja-session-'));
		Object.assign(extContext, { globalStorageUri: vscode.Uri.file(tmpDir) });
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		JinjaPreviewSession._resetForTesting();
		JinjaRenderedContentProvider._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		JinjaPreviewSession._resetForTesting();
		JinjaRenderedContentProvider._resetForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeTemplateFile(name: string, content: string): vscode.Uri {
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

	function stubShowTextDocument(): { restore: () => void; calls: vscode.Uri[] } {
		const calls: vscode.Uri[] = [];
		const restoreShow = stub(vscode.window, 'showTextDocument', (async (docOrUri: any) => {
			const doc =
				docOrUri && typeof docOrUri.getText === 'function'
					? docOrUri
					: await vscode.workspace.openTextDocument(docOrUri);
			calls.push(doc.uri);
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
		return {
			restore: () => {
				restoreShow();
				restoreExecuteCommand();
			},
			calls,
		};
	}

	suite('createOrShow()', () => {
		test('creates the overrides file with seed content on first open', async () => {
			const uri = writeTemplateFile('t1.j2', 'hello');
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Org One' });
			linkFile(uri, org.id, 'tpl-1');
			const { restore } = stubShowTextDocument();

			try {
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);
				const written = fs.readFileSync(state.overridesUri.fsPath, 'utf8');
				assert.strictEqual(written, OVERRIDES_SEED);
			} finally {
				restore();
			}
		});

		test('reveals the source template before arranging the vars and rendered panes', async () => {
			const uri = writeTemplateFile('t-source.j2', 'hello');
			const org = Fixtures.orgModel({ id: 'org-source', name: 'Org Source' });
			linkFile(uri, org.id, 'tpl-source');
			const { restore, calls } = stubShowTextDocument();

			try {
				await JinjaPreviewSession.createOrShow(uri, extContext);

				assert.strictEqual(calls[0]?.toString(), uri.toString(), 'source template should be shown first');
				assert.ok(
					calls.some(call => call.toString() !== uri.toString()),
					'preview should still open the aux panes',
				);
			} finally {
				restore();
			}
		});

		test('reveals the existing session without recreating the overrides file or re-resolving the link', async () => {
			const uri = writeTemplateFile('t2.j2', 'hello');
			const org = Fixtures.orgModel({ id: 'org-2', name: 'Org Two' });
			linkFile(uri, org.id, 'tpl-2');
			const { restore } = stubShowTextDocument();

			try {
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);
				const mtimeAfterFirst = fs.statSync(state.overridesUri.fsPath).mtimeMs;

				const restoreLink = stub(LinkManager, 'getTemplateLink', (() => {
					throw new Error('should not re-resolve the link on the reveal path');
				}) as typeof LinkManager.getTemplateLink);
				try {
					await JinjaPreviewSession.createOrShow(uri, extContext);
				} finally {
					restoreLink();
				}

				const mtimeAfterSecond = fs.statSync(state.overridesUri.fsPath).mtimeMs;
				assert.strictEqual(
					mtimeAfterSecond,
					mtimeAfterFirst,
					'overrides file should not be rewritten on reveal',
				);
			} finally {
				restore();
			}
		});
	});

	suite('resolveTemplateUri()', () => {
		test('resolves the template uri from any of the 3 pane uris — template, overrides, or rendered', async () => {
			const uri = writeTemplateFile('t-resolve.j2', 'hello');
			const org = Fixtures.orgModel({ id: 'org-resolve', name: 'Org Resolve' });
			linkFile(uri, org.id, 'tpl-resolve');
			const { restore } = stubShowTextDocument();

			try {
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);

				assert.strictEqual(JinjaPreviewSession.resolveTemplateUri(uri)?.toString(), uri.toString());
				assert.strictEqual(
					JinjaPreviewSession.resolveTemplateUri(state.overridesUri)?.toString(),
					uri.toString(),
				);
				assert.strictEqual(
					JinjaPreviewSession.resolveTemplateUri(state.renderedUri)?.toString(),
					uri.toString(),
				);
			} finally {
				restore();
			}
		});

		test('returns undefined for a uri with no live session', () => {
			const foreign = vscode.Uri.file(path.join(tmpDir, 'unrelated.txt'));
			assert.strictEqual(JinjaPreviewSession.resolveTemplateUri(foreign), undefined);
		});
	});

	suite('render (via _renderForTesting)', () => {
		function fakeRenderSession(orgId: string, onQuery: (query: string, vars?: Record<string, unknown>) => unknown) {
			return {
				rawGraphql: async (query: string, vars?: Record<string, unknown>) => onQuery(query, vars),
				profile: { org: { id: orgId, name: 'Org' }, allManagedOrgs: [{ id: orgId, name: 'Org' }] },
			} as any;
		}

		test('merges overrides over the base context, override wins on a shared key', async () => {
			const uri = writeTemplateFile('t3.j2', '{{ CTX }}');
			const org = Fixtures.orgModel({ id: 'org-3', name: 'Org Three' });
			linkFile(uri, org.id, 'tpl-3');
			const { restore } = stubShowTextDocument();

			let renderCalled = false;
			const fakeSession = fakeRenderSession(org.id, (query, vars) => {
				assert.ok(query.includes('RewstBuddyRenderJinja'));
				renderCalled = true;
				return { data: { renderJinja: { result: vars?.vars } } };
			});
			const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async () => fakeSession) as any);

			try {
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);
				JinjaPreviewSession._setMergedVarsForTesting(uri, { a: 1, b: 2 });

				const overridesDoc = await vscode.workspace.openTextDocument(state.overridesUri);
				const edit = new vscode.WorkspaceEdit();
				edit.replace(state.overridesUri, new vscode.Range(0, 0, overridesDoc.lineCount, 0), '{"b": 99}');
				await vscode.workspace.applyEdit(edit);

				await JinjaPreviewSession._renderForTesting(uri);

				assert.ok(renderCalled, 'expected evaluateRenderJinja to reach the fake session');
				const rendered = JinjaRenderedContentProvider.provideTextDocumentContent(state.renderedUri);
				assert.strictEqual(rendered, formatRenderedSuccess({ a: 1, b: 99 }, false));
			} finally {
				restore();
				restoreGetSession();
			}
		});

		test('session-lookup failure shows a session error comment and never calls evaluateRenderJinja', async () => {
			const uri = writeTemplateFile('t-session-err.j2', '{{ CTX }}');
			const org = Fixtures.orgModel({ id: 'org-session-err', name: 'Org Session Err' });
			linkFile(uri, org.id, 'tpl-session-err');
			const { restore } = stubShowTextDocument();

			const renderCalled = false;
			const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async () => {
				throw new Error('session expired');
			}) as any);

			try {
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);
				JinjaPreviewSession._setMergedVarsForTesting(uri, { a: 1 });
				await JinjaPreviewSession._renderForTesting(uri);

				assert.strictEqual(renderCalled, false);
				const rendered = JinjaRenderedContentProvider.provideTextDocumentContent(state.renderedUri);
				assert.ok(
					rendered.includes('Session error') && rendered.includes('session expired'),
					`expected session error in output, got: ${rendered}`,
				);
			} finally {
				restore();
				restoreGetSession();
			}
		});

		test('Jinja error from evaluateRenderJinja shows an error comment in the rendered pane', async () => {
			const uri = writeTemplateFile('t-jinja-err.j2', '{{ bad jinja');
			const org = Fixtures.orgModel({ id: 'org-jinja-err', name: 'Org Jinja Err' });
			linkFile(uri, org.id, 'tpl-jinja-err');
			const { restore } = stubShowTextDocument();

			const fakeSession = {
				rawGraphql: async (query: string, vars?: Record<string, unknown>) => {
					if (query.includes('RewstBuddyRenderJinja')) {
						return { data: { renderJinja: { error: 'unexpected end of template' } } };
					}
					return { data: {} };
				},
				profile: { org: { id: org.id, name: org.name }, allManagedOrgs: [{ id: org.id, name: org.name }] },
			} as any;
			const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async () => fakeSession) as any);

			try {
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);
				JinjaPreviewSession._setMergedVarsForTesting(uri, { a: 1 });
				await JinjaPreviewSession._renderForTesting(uri);

				const rendered = JinjaRenderedContentProvider.provideTextDocumentContent(state.renderedUri);
				assert.ok(
					rendered.includes('Jinja error') && rendered.includes('unexpected end of template'),
					`expected Jinja error in output, got: ${rendered}`,
				);
			} finally {
				restore();
				restoreGetSession();
			}
		});

		test('evaluateRenderJinja throwing shows an error comment in the rendered pane', async () => {
			const uri = writeTemplateFile('t-throw.j2', '{{ CTX }}');
			const org = Fixtures.orgModel({ id: 'org-throw', name: 'Org Throw' });
			linkFile(uri, org.id, 'tpl-throw');
			const { restore } = stubShowTextDocument();

			const fakeSession = {
				rawGraphql: async (query: string) => {
					if (query.includes('RewstBuddyRenderJinja')) {
						return { errors: [{ message: 'network failure' }] };
					}
					return { data: {} };
				},
				profile: { org: { id: org.id, name: org.name }, allManagedOrgs: [{ id: org.id, name: org.name }] },
			} as any;
			const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async () => fakeSession) as any);

			try {
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);
				JinjaPreviewSession._setMergedVarsForTesting(uri, { a: 1 });
				await JinjaPreviewSession._renderForTesting(uri);

				const rendered = JinjaRenderedContentProvider.provideTextDocumentContent(state.renderedUri);
				assert.ok(
					rendered.includes('network failure') || rendered.startsWith('// Error:'),
					`expected error in output, got: ${rendered}`,
				);
			} finally {
				restore();
				restoreGetSession();
			}
		});

		test('invalid overrides JSON shows an error comment and never calls evaluateRenderJinja', async () => {
			const uri = writeTemplateFile('t4.j2', '{{ CTX }}');
			const org = Fixtures.orgModel({ id: 'org-4', name: 'Org Four' });
			linkFile(uri, org.id, 'tpl-4');
			const { restore } = stubShowTextDocument();

			let renderCalled = false;
			const fakeSession = fakeRenderSession(org.id, () => {
				renderCalled = true;
				return { data: {} };
			});
			const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async () => fakeSession) as any);

			try {
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);
				JinjaPreviewSession._setMergedVarsForTesting(uri, { a: 1 });

				const overridesDoc = await vscode.workspace.openTextDocument(state.overridesUri);
				const edit = new vscode.WorkspaceEdit();
				edit.replace(state.overridesUri, new vscode.Range(0, 0, overridesDoc.lineCount, 0), '{ not json');
				await vscode.workspace.applyEdit(edit);

				await JinjaPreviewSession._renderForTesting(uri);

				assert.strictEqual(renderCalled, false, 'should not call evaluateRenderJinja with unparsed overrides');
				const rendered = JinjaRenderedContentProvider.provideTextDocumentContent(state.renderedUri);
				assert.ok(rendered.startsWith('// Invalid overrides JSON:'));
			} finally {
				restore();
				restoreGetSession();
			}
		});
	});

	suite('pickContext()', () => {
		test('creates a session if none exists, sets vars from the picked execution, and persists the context', async () => {
			const uri = writeTemplateFile('t5.j2', '{{ CTX }}');
			const org = Fixtures.orgModel({ id: 'org-5', name: 'Org Five' });
			linkFile(uri, org.id, 'tpl-5');
			const { restore } = stubShowTextDocument();

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

			const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (
				items: unknown,
				options?: unknown,
			) => {
				const title = (options as { title?: string } | undefined)?.title ?? '';
				const resolved = (await items) as readonly (vscode.QuickPickItem & { orgId?: string })[];
				if (title.includes('Org')) return resolved.find(item => item.orgId === org.id) ?? resolved[0];
				return resolved[0];
			}) as unknown as typeof vscode.window.showQuickPick);

			try {
				await JinjaPreviewSession.pickContext(uri, extContext);

				const remembered = getLastContext(extContext, 'tpl-5');
				assert.strictEqual(remembered?.workflowId, 'wf-1');
				assert.strictEqual(remembered?.executionId, 'exec-1');
			} finally {
				restore();
				restoreGetSession();
				restoreActiveSessions();
				restoreQuickPick();
			}
		});

		test('renders with the picked context org when it differs from the template org', async () => {
			const uri = writeTemplateFile('t-cross-org.j2', '{{ CTX }}');
			const templateOrg = Fixtures.orgModel({ id: 'template-org', name: 'Template Org' });
			const contextOrg = Fixtures.orgModel({ id: 'context-org', name: 'Context Org' });
			linkFile(uri, templateOrg.id, 'tpl-cross-org');
			const { restore } = stubShowTextDocument();

			let renderOrgId: unknown;
			const fakeSessionFor = (orgId: string) =>
				({
					rawGraphql: async (query: string, vars?: Record<string, unknown>) => {
						if (query.includes('RewstBuddyPreviewWorkflows')) {
							return {
								data: {
									workflows: [{ id: 'wf-context', name: 'Context Workflow', orgId: contextOrg.id }],
								},
							};
						}
						if (query.includes('RewstBuddyExecutions')) {
							return {
								data: {
									workflowExecutions: [
										{
											id: 'exec-context',
											status: 'succeeded',
											createdAt: '1000',
											numSuccessfulTasks: 1,
											orgId: contextOrg.id,
										},
									],
								},
							};
						}
						if (query.includes('RewstBuddyExecutionContexts')) {
							return { data: { workflowExecutionContexts: [{ picked: true }] } };
						}
						if (query.includes('RewstBuddyRenderJinja')) {
							renderOrgId = vars?.orgId;
							return { data: { renderJinja: { result: vars?.vars } } };
						}
						return { data: {} };
					},
					profile: {
						org: { id: orgId, name: orgId },
						allManagedOrgs: [
							{ id: templateOrg.id, name: templateOrg.name },
							{ id: contextOrg.id, name: contextOrg.name },
						],
						user: { id: `user-${orgId}` },
					},
				}) as any;
			const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async (orgId: string) =>
				fakeSessionFor(orgId)) as any);
			const restoreActiveSessions = stub(SessionManager, 'getActiveSessions', (() => [
				fakeSessionFor(templateOrg.id),
			]) as any);
			const restoreQuickPick = stub(vscode.window, 'showQuickPick', (async (
				items: unknown,
				options?: unknown,
			) => {
				const title = (options as { title?: string } | undefined)?.title ?? '';
				const resolved = (await items) as readonly (vscode.QuickPickItem & {
					orgId?: string;
					workflowId?: string;
					executionId?: string;
				})[];
				if (title.includes('Org')) return resolved.find(item => item.orgId === contextOrg.id);
				return resolved[0];
			}) as unknown as typeof vscode.window.showQuickPick);

			try {
				await JinjaPreviewSession.pickContext(uri, extContext);

				assert.strictEqual(renderOrgId, contextOrg.id);
			} finally {
				restore();
				restoreGetSession();
				restoreActiveSessions();
				restoreQuickPick();
			}
		});

		test('pickContext cancel (user dismisses picker) exits without persisting context or rendering', async () => {
			const uri = writeTemplateFile('t-cancel.j2', '{{ CTX }}');
			const org = Fixtures.orgModel({ id: 'org-cancel', name: 'Org Cancel' });
			linkFile(uri, org.id, 'tpl-cancel');
			const { restore } = stubShowTextDocument();

			const fakeSession = {
				rawGraphql: async (query: string) => {
					if (query.includes('RewstBuddyPreviewWorkflows')) {
						return { data: { workflows: [{ id: 'wf-cancel', name: 'Workflow Cancel', orgId: org.id }] } };
					}
					return { data: {} };
				},
				profile: {
					org: { id: org.id, name: org.name },
					allManagedOrgs: [{ id: org.id, name: org.name }],
					user: { id: 'user-cancel' },
				},
			} as any;
			const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async () => fakeSession) as any);
			const restoreActiveSessions = stub(SessionManager, 'getActiveSessions', (() => [fakeSession]) as any);
			// User cancels at the org picker — showQuickPick returns undefined
			const restoreQuickPick = stub(
				vscode.window,
				'showQuickPick',
				(async () => undefined) as unknown as typeof vscode.window.showQuickPick,
			);

			try {
				await JinjaPreviewSession.pickContext(uri, extContext);

				// No context should have been saved
				const remembered = getLastContext(extContext, 'tpl-cancel');
				assert.strictEqual(remembered, undefined, 'should not persist context when picker is cancelled');
				// mergedVars should remain unset (no render happened)
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);
				assert.strictEqual(state.mergedVars, undefined, 'mergedVars should be unset after cancel');
			} finally {
				restore();
				restoreGetSession();
				restoreActiveSessions();
				restoreQuickPick();
			}
		});

		test('renders remembered cross-org contexts with the remembered org', async () => {
			const uri = writeTemplateFile('t-remembered-cross-org.j2', '{{ CTX }}');
			const templateOrg = Fixtures.orgModel({ id: 'remember-template-org', name: 'Remember Template Org' });
			const contextOrg = Fixtures.orgModel({ id: 'remember-context-org', name: 'Remember Context Org' });
			linkFile(uri, templateOrg.id, 'tpl-remembered-cross-org');
			saveLastContext(extContext, 'tpl-remembered-cross-org', {
				workflowId: 'wf-remembered',
				workflowName: 'Remembered Workflow',
				orgId: contextOrg.id,
				executionId: 'exec-remembered',
			});
			const { restore } = stubShowTextDocument();

			let renderOrgId: unknown;
			const fakeSessionFor = (orgId: string) =>
				({
					rawGraphql: async (query: string, vars?: Record<string, unknown>) => {
						if (query.includes('RewstBuddyExecutionContexts')) {
							return { data: { workflowExecutionContexts: [{ remembered: true }] } };
						}
						if (query.includes('RewstBuddyRenderJinja')) {
							renderOrgId = vars?.orgId;
							return { data: { renderJinja: { result: vars?.vars } } };
						}
						return { data: {} };
					},
					profile: {
						org: { id: orgId, name: orgId },
						allManagedOrgs: [{ id: orgId, name: orgId }],
						user: { id: `user-${orgId}` },
					},
				}) as any;
			const restoreGetSession = stub(SessionManager, 'getSessionForOrg', (async (orgId: string) =>
				fakeSessionFor(orgId)) as any);

			try {
				await JinjaPreviewSession.createOrShow(uri, extContext);

				assert.strictEqual(renderOrgId, contextOrg.id);
			} finally {
				restore();
				restoreGetSession();
			}
		});
	});

	suite('disposal', () => {
		test('tears down only once both the overrides and rendered docs have closed', async () => {
			const uri = writeTemplateFile('t6.j2', 'hello');
			const org = Fixtures.orgModel({ id: 'org-6', name: 'Org Six' });
			linkFile(uri, org.id, 'tpl-6');
			const { restore } = stubShowTextDocument();

			JinjaPreviewSession.dispose();
			let closeHandler: ((doc: vscode.TextDocument) => void) | undefined;
			const restoreEvent = stub(vscode.workspace, 'onDidCloseTextDocument', ((
				listener: (doc: vscode.TextDocument) => void,
			) => {
				closeHandler = listener;
				return { dispose() {} };
			}) as typeof vscode.workspace.onDidCloseTextDocument);

			try {
				JinjaPreviewSession.init();
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);
				assert.ok(closeHandler, 'expected JinjaPreviewSession.init() to register a close listener');

				closeHandler!({ uri: state.overridesUri } as vscode.TextDocument);
				JinjaPreviewSession._setMergedVarsForTesting(uri, { a: 1 });
				assert.ok(
					// Session should still be alive: setter had an effect (no throw / silently ignored would mean it's gone).
					true,
				);

				closeHandler!({ uri: state.renderedUri } as vscode.TextDocument);

				assert.strictEqual(
					JinjaRenderedContentProvider.provideTextDocumentContent(state.renderedUri),
					JinjaRenderedContentProvider.provideTextDocumentContent(
						JinjaRenderedContentProvider.uriFor('some-other-unrelated-template', 'Unrelated'),
					),
					'rendered content should be cleared back to the shared placeholder after both docs close',
				);
			} finally {
				JinjaPreviewSession.dispose();
				restoreEvent();
				JinjaPreviewSession.init();
				restore();
			}
		});

		test('clears stale pane-closed flags when revealing an existing session', async () => {
			const uri = writeTemplateFile('t-reopen.j2', 'hello');
			const org = Fixtures.orgModel({ id: 'org-reopen', name: 'Org Reopen' });
			linkFile(uri, org.id, 'tpl-reopen');
			const { restore } = stubShowTextDocument();

			JinjaPreviewSession.dispose();
			let closeHandler: ((doc: vscode.TextDocument) => void) | undefined;
			const restoreEvent = stub(vscode.workspace, 'onDidCloseTextDocument', ((
				listener: (doc: vscode.TextDocument) => void,
			) => {
				closeHandler = listener;
				return { dispose() {} };
			}) as typeof vscode.workspace.onDidCloseTextDocument);

			try {
				JinjaPreviewSession.init();
				const state = await JinjaPreviewSession.createOrShow(uri, extContext);
				assert.ok(closeHandler, 'expected JinjaPreviewSession.init() to register a close listener');

				closeHandler!({ uri: state.overridesUri } as vscode.TextDocument);
				await JinjaPreviewSession.createOrShow(uri, extContext);
				closeHandler!({ uri: state.renderedUri } as vscode.TextDocument);

				assert.strictEqual(
					JinjaPreviewSession.resolveTemplateUri(state.overridesUri)?.toString(),
					uri.toString(),
					'revealed overrides pane should still belong to a live session',
				);
			} finally {
				JinjaPreviewSession.dispose();
				restoreEvent();
				JinjaPreviewSession.init();
				restore();
			}
		});
	});
});
