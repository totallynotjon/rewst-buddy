import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import type { TemplateLink } from '@models';
import vscode from 'vscode';
import type { GraphqlToolDeps } from './graphqlTool';
import { buildWorkspaceOverview, resolveWorkspaceUri, runToolRequests, type WorkspaceToolDeps } from './workspaceTools';

const { suite, test, setup } = Mocha;

const folder: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 };

function deps(over: Partial<WorkspaceToolDeps> = {}): WorkspaceToolDeps {
	return {
		findFiles: async () => [],
		readFile: async () => '',
		readDirectory: async () => [],
		workspaceFolders: () => [folder],
		asRelativePath: uri => uri.path.replace(/^\/ws\//, ''),
		openTabUris: () => [],
		activeUri: () => undefined,
		getDiagnostics: () => [],
		templateLinks: () => [],
		workspaceSymbols: async () => [],
		documentSymbols: async () => [],
		editToolsEnabled: () => true,
		getDocument: async () => fakeDocument(''),
		applyEdit: async () => true,
		openInEditor: async () => undefined,
		createFile: async () => undefined,
		fileExists: async () => false,
		...over,
	};
}

/** Minimal TextDocument double: just what the edit tools touch. */
function fakeDocument(text: string): vscode.TextDocument {
	return {
		getText: () => text,
		positionAt: (offset: number) => {
			const before = text.slice(0, Math.max(0, Math.min(offset, text.length))).split('\n');
			return new vscode.Position(before.length - 1, before[before.length - 1].length);
		},
	} as unknown as vscode.TextDocument;
}

function templateLink(path: string, name: string): TemplateLink {
	return {
		uriString: vscode.Uri.file(path).toString(),
		org: { id: 'org-1', name: 'Test Org' },
		type: 'Template',
		template: { id: 'tpl-1', name } as TemplateLink['template'],
		bodyHash: 'hash',
	};
}

suite('Unit: workspaceTools', () => {
	setup(() => {
		initTestEnvironment();
	});

	suite('resolveWorkspaceUri()', () => {
		test('resolves relative paths inside the workspace', () => {
			const uri = resolveWorkspaceUri('src/a.jinja', [folder]);
			assert.strictEqual(uri?.path, '/ws/src/a.jinja');
		});

		test('rejects absolute, drive-letter, escaping, and empty paths', () => {
			assert.strictEqual(resolveWorkspaceUri('/etc/passwd', [folder]), undefined);
			assert.strictEqual(resolveWorkspaceUri('C:\\windows\\system32', [folder]), undefined);
			assert.strictEqual(resolveWorkspaceUri('../outside.txt', [folder]), undefined);
			assert.strictEqual(resolveWorkspaceUri('src/../../outside.txt', [folder]), undefined);
			assert.strictEqual(resolveWorkspaceUri('', [folder]), undefined);
		});
	});

	suite('runToolRequests()', () => {
		test('list_files returns sorted relative paths', async () => {
			const d = deps({
				findFiles: async () => [vscode.Uri.file('/ws/b.jinja'), vscode.Uri.file('/ws/a.jinja')],
			});
			const [result] = await runToolRequests([{ tool: 'list_files', args: {} }], d);
			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.output, 'a.jinja\nb.jinja');
		});

		test('read_file slices a 1-based inclusive line range', async () => {
			const d = deps({ readFile: async () => 'one\ntwo\nthree\nfour' });
			const [result] = await runToolRequests(
				[{ tool: 'read_file', args: { path: 'a.txt', startLine: 2, endLine: 3 } }],
				d,
			);
			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.output, 'two\nthree');
			assert.deepStrictEqual(result.fileUriStrings, [vscode.Uri.file('/ws/a.txt').toString()]);
		});

		test('read_file caps long files with an explicit continue hint', async () => {
			const content = Array.from({ length: 300 }, (_, i) => `line${i + 1}`).join('\n');
			const d = deps({ readFile: async () => content });
			const [first] = await runToolRequests([{ tool: 'read_file', args: { path: 'big.txt' } }], d);
			assert.match(first.output, /^line1\n/);
			assert.match(first.output, /showing lines 1-250 of 300/);
			assert.match(first.output, /"startLine": 251/);

			const [rest] = await runToolRequests([{ tool: 'read_file', args: { path: 'big.txt', startLine: 251 } }], d);
			assert.match(rest.output, /^line251\n/);
			assert.ok(!rest.output.includes('showing lines'), 'final chunk should have no continue hint');
		});

		test('read_file fails outside the workspace and without a path', async () => {
			const results = await runToolRequests(
				[
					{ tool: 'read_file', args: { path: '../secret' } },
					{ tool: 'read_file', args: {} },
				],
				deps(),
			);
			assert.deepStrictEqual(
				results.map(r => r.ok),
				[false, false],
			);
			assert.match(results[0].output, /not inside the workspace/);
		});

		test('search_files reports path:line matches case-insensitively', async () => {
			const d = deps({
				findFiles: async () => [vscode.Uri.file('/ws/a.jinja')],
				readFile: async () => 'hello\nFOO bar\nbaz foo',
			});
			const [result] = await runToolRequests([{ tool: 'search_files', args: { query: 'foo' } }], d);
			assert.strictEqual(result.output, 'a.jinja:2: FOO bar\na.jinja:3: baz foo');
		});

		test('list_open_files marks the active editor', async () => {
			const active = vscode.Uri.file('/ws/a.jinja');
			const d = deps({
				openTabUris: () => [active, vscode.Uri.file('/ws/b.jinja')],
				activeUri: () => active,
			});
			const [result] = await runToolRequests([{ tool: 'list_open_files', args: {} }], d);
			assert.strictEqual(result.output, 'a.jinja (active)\nb.jinja');
		});

		test('get_diagnostics formats severity and filters by path', async () => {
			const diagnostic = new vscode.Diagnostic(new vscode.Range(4, 0, 4, 5), 'bad jinja', 0);
			const d = deps({
				getDiagnostics: () => [
					[vscode.Uri.file('/ws/a.jinja'), [diagnostic]],
					[vscode.Uri.file('/ws/b.jinja'), [diagnostic]],
				],
			});
			const [all] = await runToolRequests([{ tool: 'get_diagnostics', args: {} }], d);
			assert.strictEqual(all.output, 'a.jinja:5 [error] bad jinja\nb.jinja:5 [error] bad jinja');

			const [filtered] = await runToolRequests([{ tool: 'get_diagnostics', args: { path: 'b.jinja' } }], d);
			assert.strictEqual(filtered.output, 'b.jinja:5 [error] bad jinja');
		});

		test('list_template_links describes each link', async () => {
			const d = deps({ templateLinks: () => [templateLink('/ws/a.jinja', 'My Template')] });
			const [result] = await runToolRequests([{ tool: 'list_template_links', args: {} }], d);
			assert.strictEqual(result.output, 'a.jinja ← "My Template" (template tpl-1, org Test Org)');
		});

		test('open_file opens existing files and rejects missing ones', async () => {
			const opened: string[] = [];
			const d = deps({
				fileExists: async () => true,
				openInEditor: async uri => void opened.push(uri.path),
			});
			const [ok] = await runToolRequests([{ tool: 'open_file', args: { path: 'a.jinja' } }], d);
			assert.strictEqual(ok.output, 'Opened a.jinja in the editor.');
			assert.deepStrictEqual(opened, ['/ws/a.jinja']);

			const [missing] = await runToolRequests([{ tool: 'open_file', args: { path: 'a.jinja' } }], deps());
			assert.strictEqual(missing.ok, false);
			assert.match(missing.output, /does not exist/);
		});

		test('find_symbols formats name, kind, and location', async () => {
			const location = new vscode.Location(vscode.Uri.file('/ws/a.ps1'), new vscode.Range(9, 0, 9, 5));
			const d = deps({
				workspaceSymbols: async () => [
					new vscode.SymbolInformation('Get-Thing', vscode.SymbolKind.Function, '', location),
				],
			});
			const [result] = await runToolRequests([{ tool: 'find_symbols', args: { query: 'thing' } }], d);
			assert.strictEqual(result.output, 'Get-Thing [Function] — a.ps1:10');
		});

		test('get_file_outline indents nested document symbols', async () => {
			const range = new vscode.Range(2, 0, 8, 0);
			const parent = new vscode.DocumentSymbol('MyClass', '', vscode.SymbolKind.Class, range, range);
			const childRange = new vscode.Range(4, 0, 5, 0);
			parent.children.push(
				new vscode.DocumentSymbol('myMethod', '', vscode.SymbolKind.Method, childRange, childRange),
			);
			const d = deps({ documentSymbols: async () => [parent] });
			const [result] = await runToolRequests([{ tool: 'get_file_outline', args: { path: 'a.ts' } }], d);
			assert.strictEqual(result.output, 'MyClass [Class] (line 3)\n  myMethod [Method] (line 5)');
		});

		test('edit_file replaces a unique match and leaves the file unsaved', async () => {
			let applied: vscode.WorkspaceEdit | undefined;
			const d = deps({
				getDocument: async () => fakeDocument('hello world\ngoodbye'),
				applyEdit: async edit => {
					applied = edit;
					return true;
				},
			});
			const [result] = await runToolRequests(
				[{ tool: 'edit_file', args: { path: 'a.jinja', find: 'world', replace: 'there' } }],
				d,
			);
			assert.strictEqual(result.ok, true);
			assert.match(result.output, /Edited a\.jinja at line 1/);
			assert.match(result.output, /unsaved/);
			assert.strictEqual(result.change?.before, 'hello world\ngoodbye');
			assert.strictEqual(result.change?.after, 'hello there\ngoodbye');
			assert.ok(applied);
			const [[, edits]] = applied.entries();
			assert.strictEqual(edits[0].newText, 'there');
			assert.strictEqual(edits[0].range.start.character, 6);
			assert.strictEqual(edits[0].range.end.character, 11);
		});

		test('edit_file rejects missing and ambiguous matches', async () => {
			const d = deps({ getDocument: async () => fakeDocument('aa bb aa') });
			const results = await runToolRequests(
				[
					{ tool: 'edit_file', args: { path: 'a.jinja', find: 'zz', replace: 'x' } },
					{ tool: 'edit_file', args: { path: 'a.jinja', find: 'aa', replace: 'x' } },
				],
				d,
			);
			assert.match(results[0].output, /not found/);
			assert.match(results[1].output, /more than once/);
		});

		test('edit tools respect the enableEditTools setting', async () => {
			const d = deps({ editToolsEnabled: () => false });
			const results = await runToolRequests(
				[
					{ tool: 'edit_file', args: { path: 'a.jinja', find: 'a', replace: 'b' } },
					{ tool: 'write_file', args: { path: 'a.jinja', content: 'x' } },
				],
				d,
			);
			assert.ok(results.every(r => !r.ok));
			assert.ok(results.every(r => r.output.includes('enableEditTools')));
		});

		test('write_file creates new files and replaces existing ones unsaved', async () => {
			const created: [string, string][] = [];
			const dNew = deps({ createFile: async (uri, content) => void created.push([uri.path, content]) });
			const [createdResult] = await runToolRequests(
				[{ tool: 'write_file', args: { path: 'new.jinja', content: 'body' } }],
				dNew,
			);
			assert.strictEqual(createdResult.output, 'Created new.jinja.');
			assert.deepStrictEqual(created, [['/ws/new.jinja', 'body']]);

			let applied: vscode.WorkspaceEdit | undefined;
			const dExisting = deps({
				fileExists: async () => true,
				getDocument: async () => fakeDocument('old'),
				applyEdit: async edit => {
					applied = edit;
					return true;
				},
			});
			const [replaced] = await runToolRequests(
				[{ tool: 'write_file', args: { path: 'a.jinja', content: 'new' } }],
				dExisting,
			);
			assert.match(replaced.output, /Replaced the contents of a\.jinja/);
			assert.ok(applied);
		});

		test('unknown tools fail with the available tool list', async () => {
			const [result] = await runToolRequests([{ tool: 'delete_everything', args: {} }], deps());
			assert.strictEqual(result.ok, false);
			assert.match(result.output, /Unknown tool "delete_everything"/);
			assert.match(result.output, /read_file/);
		});

		test('routes rewst_graphql through GraphQL deps', async () => {
			const calls: { query: string; variables?: Record<string, unknown> }[] = [];
			const graphqlDeps: GraphqlToolDeps = {
				isEnabled: () => true,
				confirmMutation: async () => true,
				execute: async (query, variables) => {
					calls.push({ query, variables });
					return { data: { user: { id: 'u-1' } } };
				},
			};
			const [result] = await runToolRequests(
				[
					{
						tool: 'rewst_graphql',
						args: { query: 'query U($id: ID!) { user(id: $id) { id } }', variables: { id: 'u-1' } },
					},
				],
				deps(),
				undefined,
				graphqlDeps,
			);
			assert.strictEqual(result.ok, true);
			assert.match(result.output, /"u-1"/);
			assert.deepStrictEqual(calls, [
				{ query: 'query U($id: ID!) { user(id: $id) { id } }', variables: { id: 'u-1' } },
			]);
		});

		test('reports progress per request', async () => {
			const labels: string[] = [];
			await runToolRequests([{ tool: 'list_files', args: {} }], deps(), label => labels.push(label));
			assert.deepStrictEqual(labels, ['Running list_files…']);
		});
	});

	suite('buildWorkspaceOverview()', () => {
		test('returns undefined with no workspace folders', async () => {
			assert.strictEqual(await buildWorkspaceOverview(deps({ workspaceFolders: () => [] })), undefined);
		});

		test('summarizes top-level entries and linked template count', async () => {
			const d = deps({
				readDirectory: async () => [
					['src', vscode.FileType.Directory],
					['package.json', vscode.FileType.File],
					['.git', vscode.FileType.Directory],
					['node_modules', vscode.FileType.Directory],
				],
				templateLinks: () => [templateLink('/ws/a.jinja', 'T')],
			});
			const overview = await buildWorkspaceOverview(d);
			assert.ok(overview);
			assert.ok(overview.includes('Workspace folder "ws": package.json, src/'));
			assert.ok(overview.includes('1 file(s) are linked to Rewst templates'));
			assert.ok(!overview.includes('.git'));
		});
	});
});
