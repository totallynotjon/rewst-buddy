import { createMockSession, initTestEnvironment, installMockSessions, stub } from '@test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { editorDataClient } from '../../backend/editorDataClient';
import { WORKFLOW_EXPORT_BOOTSTRAP_PAYLOAD } from '../../../packages/mcp-server/src/capabilities/workflowExportCapability';
import {
	WorkflowExportViewProvider,
	workflowExportOrganizations,
	workflowExportTargetExists,
} from './WorkflowExportViewProvider';

const { suite, test, setup, teardown } = Mocha;

function fakeView(): {
	view: vscode.WebviewView;
	state: {
		html: string;
		options: vscode.WebviewOptions;
		listener?: (message: unknown) => Promise<void>;
		messages: unknown[];
	};
} {
	const state: {
		html: string;
		options: vscode.WebviewOptions;
		listener?: (message: unknown) => Promise<void>;
		messages: unknown[];
	} = {
		html: '',
		options: {},
		messages: [],
	};
	const webview = {
		get html() {
			return state.html;
		},
		set html(value: string) {
			state.html = value;
		},
		get options() {
			return state.options;
		},
		set options(value: vscode.WebviewOptions) {
			state.options = value;
		},
		cspSource: 'vscode-webview://workflow-export-test',
		asWebviewUri: (uri: vscode.Uri) => vscode.Uri.parse(`vscode-webview://test${uri.path}`),
		onDidReceiveMessage: (listener: (message: unknown) => Promise<void>) => {
			state.listener = listener;
			return new vscode.Disposable(() => {});
		},
		postMessage: async (message: unknown) => {
			state.messages.push(message);
			return true;
		},
	} as unknown as vscode.Webview;
	return { view: { webview } as unknown as vscode.WebviewView, state };
}

suite('Unit: WorkflowExportViewProvider', () => {
	const restores: (() => void)[] = [];

	setup(() => {
		initTestEnvironment();
		installMockSessions([]);
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
		installMockSessions([]);
	});

	function stubClient<K extends keyof typeof editorDataClient>(key: K, value: (typeof editorDataClient)[K]): void {
		const original = editorDataClient[key];
		Object.defineProperty(editorDataClient, key, { configurable: true, writable: true, value });
		restores.push(() =>
			Object.defineProperty(editorDataClient, key, { configurable: true, writable: true, value: original }),
		);
	}

	function setActiveOrganization(orgId = 'org-1', orgName = 'Org One'): void {
		const { session } = createMockSession({
			profile: {
				org: { id: orgId, name: orgName },
				allManagedOrgs: [{ id: orgId, name: orgName }],
			},
		});
		installMockSessions([session]);
	}

	function workflowRows(count: number): {
		id: string;
		name: string;
		orgId: string;
		createdAt: string;
		updatedAt: string;
		tags: never[];
	}[] {
		return Array.from({ length: count }, (_, index) => ({
			id: `wf-${index + 1}`,
			name: `Workflow ${index + 1}`,
			orgId: 'org-1',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-02-01T00:00:00.000Z',
			tags: [],
		}));
	}

	function exportResult(workflowIds: string[], outputPath: string | null = null) {
		return {
			status: 'saved' as const,
			orgId: 'org-1',
			workflowIds,
			recommendedFilename: 'export.json',
			outputPath,
			bytes: 10,
			version: 2,
			exportedAt: '2026-01-01T00:00:00.000Z',
			objectCount: workflowIds.length,
			signingPresent: true,
		};
	}

	async function loadProviderCatalog(rows: ReturnType<typeof workflowRows>): Promise<{
		provider: WorkflowExportViewProvider;
		fake: ReturnType<typeof fakeView>;
	}> {
		setActiveOrganization();
		stubClient(
			'getWorkflowExportDefaultDirectory',
			(async () => '/exports') as typeof editorDataClient.getWorkflowExportDefaultDirectory,
		);
		stubClient('listExportWorkflows', (async () => rows) as typeof editorDataClient.listExportWorkflows);
		const provider = new WorkflowExportViewProvider(vscode.Uri.file('/extension'));
		const fake = fakeView();
		provider.resolveWebviewView(fake.view);
		await fake.state.listener?.({ type: 'ready' });
		await fake.state.listener?.({ type: 'loadCatalog', orgId: 'org-1' });
		return { provider, fake };
	}

	function messagesOfType(fake: ReturnType<typeof fakeView>, type: string): Record<string, unknown>[] {
		return fake.state.messages.filter((message): message is Record<string, unknown> =>
			Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === type),
		);
	}

	test('builds a stable, deduplicated organization catalog from active sessions', () => {
		const { session } = createMockSession({
			profile: {
				org: { id: 'org-main', name: 'Main Org' },
				allManagedOrgs: [
					{ id: 'org-main', name: 'Main Org' },
					{ id: 'org-z', name: 'Zulu Org' },
					{ id: 'org-a', name: 'Alpha Org' },
				],
			},
		});

		assert.deepStrictEqual(
			workflowExportOrganizations([session]).map(org => ({ id: org.id, name: org.name })),
			[
				{ id: 'org-a', name: 'Alpha Org' },
				{ id: 'org-main', name: 'Main Org' },
				{ id: 'org-z', name: 'Zulu Org' },
			],
		);
	});

	test('skips organizations unless at least one active session has a usable id', () => {
		const { session: unusable } = createMockSession({
			profile: {
				org: { id: 'org-1', name: 'Org One' },
				allManagedOrgs: [{ id: 'org-1', name: 'Org One' }],
			},
		});
		const { session: usable } = createMockSession({
			profile: {
				org: { id: 'org-1', name: 'Org One' },
				allManagedOrgs: [{ id: 'org-1', name: 'Org One' }],
			},
		});
		unusable.profile.user.id = null;
		usable.profile.user.id = 'user-valid';

		assert.deepStrictEqual(workflowExportOrganizations([unusable]), []);
		assert.deepStrictEqual(workflowExportOrganizations([unusable, usable]), [{ id: 'org-1', name: 'Org One' }]);
	});

	test('resolves each operation through a later capable session when the first is invalid', async () => {
		const { session: first } = createMockSession({
			profile: {
				org: { id: 'org-1', name: 'Org One' },
				allManagedOrgs: [{ id: 'org-1', name: 'Org One' }],
			},
		});
		const { session: second } = createMockSession({
			profile: {
				org: { id: 'org-1', name: 'Org One' },
				allManagedOrgs: [{ id: 'org-1', name: 'Org One' }],
			},
		});
		first.profile.user.id = 'user-invalid';
		second.profile.user.id = 'user-valid';
		let firstChecks = 0;
		let secondChecks = 0;
		restores.push(
			stub(first, 'ensureValid', async () => {
				firstChecks++;
				return false;
			}),
		);
		restores.push(
			stub(second, 'ensureValid', async () => {
				secondChecks++;
				return true;
			}),
		);
		installMockSessions([first, second]);
		const catalogSessionIds: string[] = [];
		const exportSessionIds: string[] = [];
		stubClient(
			'getWorkflowExportDefaultDirectory',
			(async () => '/exports') as typeof editorDataClient.getWorkflowExportDefaultDirectory,
		);
		stubClient('listExportWorkflows', (async input => {
			catalogSessionIds.push(input.sessionId);
			return workflowRows(1);
		}) as typeof editorDataClient.listExportWorkflows);
		stubClient('exportWorkflows', (async input => {
			exportSessionIds.push(input.sessionId);
			return exportResult(input.workflowIds, input.outputPath ?? null);
		}) as typeof editorDataClient.exportWorkflows);
		const provider = new WorkflowExportViewProvider(vscode.Uri.file('/extension'));
		const fake = fakeView();
		provider.resolveWebviewView(fake.view);

		await fake.state.listener?.({ type: 'ready' });
		await fake.state.listener?.({ type: 'loadCatalog', orgId: 'org-1' });
		await fake.state.listener?.({
			type: 'startExport',
			orgId: 'org-1',
			workflowIds: ['wf-1'],
			mode: 'bundle',
		});

		assert.deepStrictEqual(catalogSessionIds, ['user-valid']);
		assert.deepStrictEqual(exportSessionIds, ['user-valid']);
		assert.strictEqual(firstChecks, 2);
		assert.strictEqual(secondChecks, 2);
		provider.dispose();
	});

	test('renders a script-enabled persistent workflow exporter without embedding credentials', () => {
		const provider = new WorkflowExportViewProvider(vscode.Uri.file('/extension'));
		const fake = fakeView();
		provider.resolveWebviewView(fake.view);

		assert.strictEqual(fake.state.options.enableScripts, true);
		assert.deepStrictEqual(
			fake.state.options.localResourceRoots?.map(uri => uri.fsPath),
			[vscode.Uri.joinPath(vscode.Uri.file('/extension'), 'media', 'workflow-exporter').fsPath],
		);
		assert.match(fake.state.html, /id="workflowSearch"/);
		assert.match(fake.state.html, /id="organizationList"/);
		assert.match(fake.state.html, /id="changeOrganization"/);
		assert.doesNotMatch(fake.state.html, /<select id="organization"/);
		assert.match(fake.state.html, /id="tagList"/);
		assert.doesNotMatch(fake.state.html, /<select id="tags" multiple/);
		assert.match(fake.state.html, /id="useWorkflowNames"/);
		assert.match(fake.state.html, /media\/workflow-exporter\/main\.js/);
		const nonce = fake.state.html.match(/script-src 'nonce-([A-Za-z0-9_-]{43})'/)?.[1];
		assert.ok(nonce);
		assert.match(fake.state.html, new RegExp(`<script nonce="${nonce}"`));
		assert.doesNotMatch(fake.state.html, /appSession|cookie=|test-token/i);
		provider.dispose();
	});

	test('ignores malformed and unknown webview messages', async () => {
		const provider = new WorkflowExportViewProvider(vscode.Uri.file('/extension'));
		const fake = fakeView();
		provider.resolveWebviewView(fake.view);

		await assert.doesNotReject(() => fake.state.listener?.(null) ?? Promise.resolve());
		await assert.doesNotReject(() => fake.state.listener?.({ type: 'unknown' }) ?? Promise.resolve());
		provider.dispose();
	});

	test('includes the authoritative workflow limit in its bootstrap message', async () => {
		stubClient(
			'getWorkflowExportDefaultDirectory',
			(async () => '/exports') as typeof editorDataClient.getWorkflowExportDefaultDirectory,
		);
		const provider = new WorkflowExportViewProvider(vscode.Uri.file('/extension'));
		const fake = fakeView();
		provider.resolveWebviewView(fake.view);

		await fake.state.listener?.({ type: 'ready' });

		assert.strictEqual(
			messagesOfType(fake, 'bootstrap').at(-1)?.maxWorkflowsPerExport,
			WORKFLOW_EXPORT_BOOTSTRAP_PAYLOAD.maxWorkflowsPerExport,
		);
		assert.strictEqual(messagesOfType(fake, 'bootstrap').at(-1)?.catalogOrgId, null);
		provider.dispose();
	});

	test('bootstraps the organization whose catalog is currently loaded', async () => {
		const { provider, fake } = await loadProviderCatalog(workflowRows(1));

		await fake.state.listener?.({ type: 'ready' });

		assert.strictEqual(messagesOfType(fake, 'bootstrap').at(-1)?.catalogOrgId, 'org-1');
		provider.dispose();
	});

	test('reports bootstrap failures without posting a partial bootstrap payload', async () => {
		stubClient('getWorkflowExportDefaultDirectory', (async () =>
			Promise.reject(
				new Error('directory unavailable'),
			)) as typeof editorDataClient.getWorkflowExportDefaultDirectory);
		const provider = new WorkflowExportViewProvider(vscode.Uri.file('/extension'));
		const fake = fakeView();
		provider.resolveWebviewView(fake.view);

		await fake.state.listener?.({ type: 'ready' });

		assert.deepStrictEqual(messagesOfType(fake, 'bootstrap'), []);
		assert.deepStrictEqual(
			messagesOfType(fake, 'error').map(message => message.message),
			['Unable to initialize workflow exports: directory unavailable'],
		);
		provider.dispose();
	});

	test('only treats ENOENT as an available workflow export target', async () => {
		const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
		const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });

		assert.strictEqual(
			await workflowExportTargetExists('/exports/new.json', async () => Promise.reject(missing)),
			false,
		);
		await assert.rejects(
			() => workflowExportTargetExists('/exports/blocked.json', async () => Promise.reject(denied)),
			/permission denied/,
		);
	});

	test('rehydrates persisted webview controls and clears stale export state on bootstrap', () => {
		class FakeElement {
			value = '';
			checked = false;
			disabled = false;
			hidden = false;
			textContent = '';
			className = '';
			innerHTML = '';
			onclick?: (event: { currentTarget: FakeElement; target: FakeElement }) => void;
			oninput?: (event: { target: FakeElement }) => void;
			onchange?: (event: { target: FakeElement }) => void;
			dataset: Record<string, string> = {};
			querySelectorAll(): FakeElement[] {
				return [];
			}
			focus(): void {}
		}

		const elements = new Map<string, FakeElement>();
		const element = (id: string): FakeElement => {
			let result = elements.get(id);
			if (!result) {
				result = new FakeElement();
				elements.set(id, result);
			}
			return result;
		};
		const modeRadios = ['separate', 'bundle'].map(value => Object.assign(new FakeElement(), { value }));
		const tagRadios = ['any', 'all'].map(value => Object.assign(new FakeElement(), { value }));
		let messageListener: ((event: { data: unknown }) => void) | undefined;
		let savedState: Record<string, unknown> | undefined;
		let saveCount = 0;
		const persistedState = {
			organizations: [],
			workflows: [],
			visibleIds: [],
			selectedIds: [],
			tags: [],
			filters: {
				search: 'daily',
				tagIds: [],
				tagMatch: 'all',
				createdFrom: '2026-01-01',
				createdTo: '2026-01-31',
				updatedFrom: '2026-02-01',
				updatedTo: '2026-02-28',
			},
			mode: 'bundle',
			useWorkflowNames: true,
			exporting: true,
		};
		const source = readFileSync(join(process.cwd(), 'media/workflow-exporter/main.js'), 'utf8');
		vm.runInNewContext(source, {
			acquireVsCodeApi: () => ({
				getState: () => persistedState,
				setState: (value: Record<string, unknown>) => {
					savedState = value;
					saveCount++;
				},
				postMessage: () => {},
			}),
			document: {
				getElementById: element,
				querySelectorAll: (selector: string) => (selector.includes('tagMatch') ? tagRadios : modeRadios),
			},
			window: {
				addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => {
					messageListener = listener;
				},
			},
			Set,
			Date,
			Number,
			String,
		});

		assert.strictEqual(element('workflowSearch').value, 'daily');
		assert.strictEqual(element('createdFrom').value, '2026-01-01');
		assert.strictEqual(element('createdTo').value, '2026-01-31');
		assert.strictEqual(element('updatedFrom').value, '2026-02-01');
		assert.strictEqual(element('updatedTo').value, '2026-02-28');
		assert.strictEqual(modeRadios.find(radio => radio.value === 'bundle')?.checked, true);
		assert.strictEqual(element('useWorkflowNames').checked, true);
		element('organizationSearch').oninput?.({ target: Object.assign(new FakeElement(), { value: 'org' }) });
		element('workflowSearch').oninput?.({ target: Object.assign(new FakeElement(), { value: 'work' }) });
		element('tagSearch').oninput?.({ target: Object.assign(new FakeElement(), { value: 'tag' }) });
		assert.strictEqual(saveCount, 0);

		messageListener?.({ data: { type: 'bootstrap', organizations: [], defaultDirectory: '/exports' } });
		assert.strictEqual(savedState?.exporting, false);
		element('refreshCatalog').disabled = true;
		messageListener?.({ data: { type: 'error', message: 'Unable to load workflows: failed' } });
		assert.strictEqual(element('refreshCatalog').disabled, false);
		assert.strictEqual((savedState?.filters as { search?: string } | undefined)?.search, '');
	});

	test('loads metadata, applies filters, and exports separate files through the shared name-based engine', async () => {
		const { session } = createMockSession({
			profile: {
				org: { id: 'org-1', name: 'Org One' },
				allManagedOrgs: [{ id: 'org-1', name: 'Org One' }],
			},
		});
		installMockSessions([session]);
		const exportCalls: { workflowIds: string[]; outputPath?: string }[] = [];
		stubClient(
			'getWorkflowExportDefaultDirectory',
			(async () => '/exports') as typeof editorDataClient.getWorkflowExportDefaultDirectory,
		);
		stubClient('listExportWorkflows', (async () => [
			{
				id: 'wf-1',
				name: 'Daily / Sync',
				orgId: 'org-1',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-02-01T00:00:00.000Z',
				tags: [{ id: 'ops', name: 'Operations' }],
			},
		]) as typeof editorDataClient.listExportWorkflows);
		stubClient('exportWorkflows', (async input => {
			exportCalls.push(input);
			return {
				status: 'saved',
				orgId: input.orgId,
				workflowIds: input.workflowIds,
				recommendedFilename: 'export.json',
				outputPath: input.outputPath ?? null,
				bytes: 10,
				version: 2,
				exportedAt: '2026-01-01T00:00:00.000Z',
				objectCount: 1,
				signingPresent: true,
			};
		}) as typeof editorDataClient.exportWorkflows);

		const provider = new WorkflowExportViewProvider(vscode.Uri.file('/extension'));
		const fake = fakeView();
		provider.resolveWebviewView(fake.view);
		await fake.state.listener?.({ type: 'ready' });
		await fake.state.listener?.({ type: 'loadCatalog', orgId: 'org-1' });
		await fake.state.listener?.({
			type: 'applyFilters',
			filters: { search: 'daily', tagIds: ['ops'], tagMatch: 'all', updatedFrom: '2026-02-01' },
		});
		(provider as unknown as { destination: { kind: 'file'; outputPath: string } }).destination = {
			kind: 'file',
			outputPath: '/exports/previous-bundle.json',
		};
		await fake.state.listener?.({
			type: 'startExport',
			orgId: 'org-1',
			workflowIds: ['wf-1'],
			mode: 'separate',
			useWorkflowNames: true,
		});

		assert.deepStrictEqual(
			exportCalls.map(({ workflowIds, outputPath }) => ({ workflowIds, outputPath })),
			[{ workflowIds: ['wf-1'], outputPath: '/exports/Daily - Sync--wf-1.json' }],
		);
		assert.ok(
			fake.state.messages.some(
				message =>
					(message as { type?: string; kind?: string; isDefault?: boolean }).type === 'destination' &&
					(message as { kind?: string }).kind === 'directory' &&
					(message as { isDefault?: boolean }).isDefault === true,
			),
		);
		assert.ok(
			fake.state.messages.some(
				message =>
					(message as { type?: string; workflowIds?: string[] }).type === 'filterResult' &&
					(message as { workflowIds?: string[] }).workflowIds?.[0] === 'wf-1',
			),
		);
		assert.ok(
			fake.state.messages.some(
				message =>
					(message as { type?: string; exportedWorkflowCount?: number }).type === 'exportComplete' &&
					(message as { exportedWorkflowCount?: number }).exportedWorkflowCount === 1,
			),
		);
		provider.dispose();
	});

	test('rejects invalid catalog organizations and stale organization exports without backend calls', async () => {
		setActiveOrganization();
		let listCalls = 0;
		let exportCalls = 0;
		stubClient(
			'getWorkflowExportDefaultDirectory',
			(async () => '/exports') as typeof editorDataClient.getWorkflowExportDefaultDirectory,
		);
		stubClient('listExportWorkflows', (async () => {
			listCalls++;
			return workflowRows(1);
		}) as typeof editorDataClient.listExportWorkflows);
		stubClient('exportWorkflows', (async input => {
			exportCalls++;
			return exportResult(input.workflowIds, input.outputPath ?? null);
		}) as typeof editorDataClient.exportWorkflows);
		const provider = new WorkflowExportViewProvider(vscode.Uri.file('/extension'));
		const fake = fakeView();
		provider.resolveWebviewView(fake.view);

		await fake.state.listener?.({ type: 'loadCatalog', orgId: 'org-missing' });
		await fake.state.listener?.({ type: 'loadCatalog', orgId: 'org-1' });
		await fake.state.listener?.({
			type: 'startExport',
			orgId: 'org-missing',
			workflowIds: ['wf-1'],
			mode: 'bundle',
		});

		assert.strictEqual(listCalls, 1);
		assert.strictEqual(exportCalls, 0);
		assert.deepStrictEqual(
			messagesOfType(fake, 'error').map(message => message.message),
			['Choose an active Rewst organization.', 'Reload the selected organization before exporting.'],
		);
		provider.dispose();
	});

	test('rejects unknown workflow ids from a loaded catalog', async () => {
		let exportCalls = 0;
		stubClient('exportWorkflows', (async input => {
			exportCalls++;
			return exportResult(input.workflowIds, input.outputPath ?? null);
		}) as typeof editorDataClient.exportWorkflows);
		const { provider, fake } = await loadProviderCatalog(workflowRows(1));

		await fake.state.listener?.({
			type: 'startExport',
			orgId: 'org-1',
			workflowIds: ['wf-1', 'wf-unknown'],
			mode: 'bundle',
		});

		assert.strictEqual(exportCalls, 0);
		assert.deepStrictEqual(
			messagesOfType(fake, 'error').map(message => message.message),
			['Select at least one workflow from the current catalog.'],
		);
		provider.dispose();
	});

	test('rejects a concurrent export while the first export is still running', async () => {
		let resolveExport!: (value: ReturnType<typeof exportResult>) => void;
		let notifyStarted!: () => void;
		const started = new Promise<void>(resolve => (notifyStarted = resolve));
		const pending = new Promise<ReturnType<typeof exportResult>>(resolve => (resolveExport = resolve));
		let exportCalls = 0;
		stubClient('exportWorkflows', (async input => {
			exportCalls++;
			notifyStarted();
			return pending.then(value => ({ ...value, outputPath: input.outputPath ?? null }));
		}) as typeof editorDataClient.exportWorkflows);
		const { provider, fake } = await loadProviderCatalog(workflowRows(1));
		const message = { type: 'startExport', orgId: 'org-1', workflowIds: ['wf-1'], mode: 'bundle' };

		const firstExport = fake.state.listener?.(message);
		await started;
		await fake.state.listener?.(message);

		assert.strictEqual(exportCalls, 1);
		assert.ok(
			messagesOfType(fake, 'error').some(message => message.message === 'A workflow export is already running.'),
		);
		resolveExport(exportResult(['wf-1']));
		await firstExport;
		assert.strictEqual(messagesOfType(fake, 'exportComplete').length, 1);
		provider.dispose();
	});

	test('claims the export slot before asynchronous destination initialization', async () => {
		setActiveOrganization();
		let resolveDirectory!: (value: string) => void;
		const pendingDirectory = new Promise<string>(resolve => (resolveDirectory = resolve));
		stubClient(
			'getWorkflowExportDefaultDirectory',
			(() => pendingDirectory) as typeof editorDataClient.getWorkflowExportDefaultDirectory,
		);
		stubClient('listExportWorkflows', (async () => workflowRows(1)) as typeof editorDataClient.listExportWorkflows);
		let exportCalls = 0;
		stubClient('exportWorkflows', (async input => {
			exportCalls++;
			return exportResult(input.workflowIds, input.outputPath ?? null);
		}) as typeof editorDataClient.exportWorkflows);
		const provider = new WorkflowExportViewProvider(vscode.Uri.file('/extension'));
		const fake = fakeView();
		provider.resolveWebviewView(fake.view);
		await fake.state.listener?.({ type: 'loadCatalog', orgId: 'org-1' });
		const message = { type: 'startExport', orgId: 'org-1', workflowIds: ['wf-1'], mode: 'bundle' };

		const firstExport = fake.state.listener?.(message);
		await fake.state.listener?.(message);

		assert.strictEqual(exportCalls, 0);
		assert.ok(messagesOfType(fake, 'error').some(item => item.message === 'A workflow export is already running.'));
		resolveDirectory('/exports');
		await firstExport;
		assert.strictEqual(exportCalls, 1);
		provider.dispose();
	});

	test('exports 26 bundled workflows as two backend calls and reports aggregate completion', async () => {
		const calls: { workflowIds: string[]; outputPath?: string }[] = [];
		stubClient('exportWorkflows', (async input => {
			calls.push({ workflowIds: input.workflowIds, outputPath: input.outputPath });
			return exportResult(input.workflowIds, input.outputPath ?? null);
		}) as typeof editorDataClient.exportWorkflows);
		const rows = workflowRows(26);
		const { provider, fake } = await loadProviderCatalog(rows);

		await fake.state.listener?.({
			type: 'startExport',
			orgId: 'org-1',
			workflowIds: rows.map(row => row.id),
			mode: 'bundle',
		});

		assert.deepStrictEqual(
			calls.map(call => call.workflowIds.length),
			[25, 1],
		);
		assert.deepStrictEqual(
			calls.map(call => call.outputPath),
			['/exports/rewst-workflows-batch-001-of-002.json', '/exports/rewst-workflows-batch-002-of-002.json'],
		);
		assert.deepStrictEqual(messagesOfType(fake, 'exportComplete').at(-1), {
			type: 'exportComplete',
			cancelled: false,
			exportedWorkflowCount: 26,
			fileCount: 2,
			outputPaths: calls.map(call => call.outputPath),
			failures: [],
		});
		assert.strictEqual(messagesOfType(fake, 'exportProgress').at(-1)?.percent, 100);
		provider.dispose();
	});

	test('cancels an in-flight backend export and reports cancelled completion', async () => {
		let notifyStarted!: () => void;
		const started = new Promise<void>(resolve => (notifyStarted = resolve));
		let receivedSignal: AbortSignal | undefined;
		stubClient('exportWorkflows', ((_input, options) => {
			receivedSignal = options?.signal;
			notifyStarted();
			return new Promise((_, reject) => {
				options?.signal?.addEventListener('abort', () => reject(new Error('cancelled by test')), {
					once: true,
				});
			});
		}) as typeof editorDataClient.exportWorkflows);
		const { provider, fake } = await loadProviderCatalog(workflowRows(1));

		const exportPromise = fake.state.listener?.({
			type: 'startExport',
			orgId: 'org-1',
			workflowIds: ['wf-1'],
			mode: 'bundle',
		});
		await started;
		await fake.state.listener?.({ type: 'cancelExport' });
		await exportPromise;

		assert.strictEqual(receivedSignal?.aborted, true);
		assert.deepStrictEqual(messagesOfType(fake, 'exportComplete').at(-1), {
			type: 'exportComplete',
			cancelled: true,
			exportedWorkflowCount: 0,
			fileCount: 0,
			outputPaths: [],
			failures: [],
		});
		provider.dispose();
	});

	test('reports a failed bundle while retaining a successful later batch', async () => {
		let callIndex = 0;
		stubClient('exportWorkflows', (async input => {
			if (callIndex++ === 0) throw new Error('first batch failed');
			return exportResult(input.workflowIds, input.outputPath ?? null);
		}) as typeof editorDataClient.exportWorkflows);
		const rows = workflowRows(26);
		const { provider, fake } = await loadProviderCatalog(rows);

		await fake.state.listener?.({
			type: 'startExport',
			orgId: 'org-1',
			workflowIds: rows.map(row => row.id),
			mode: 'bundle',
		});

		const completion = messagesOfType(fake, 'exportComplete').at(-1);
		assert.strictEqual(callIndex, 2);
		assert.strictEqual(completion?.cancelled, false);
		assert.strictEqual(completion?.exportedWorkflowCount, 1);
		assert.strictEqual(completion?.fileCount, 1);
		assert.deepStrictEqual(completion?.failures, [
			{
				workflowName: undefined,
				workflowId: undefined,
				workflowIds: rows.slice(0, 25).map(row => row.id),
				message: 'first batch failed',
			},
		]);
		provider.dispose();
	});

	test('rejects an existing file destination without changing the destination', async () => {
		setActiveOrganization();
		stubClient('getWorkflowExportDefaultDirectory', (async () =>
			process.cwd()) as typeof editorDataClient.getWorkflowExportDefaultDirectory);
		restores.push(
			stub(vscode.window, 'showSaveDialog', (async () =>
				vscode.Uri.file(join(process.cwd(), 'package.json'))) as typeof vscode.window.showSaveDialog),
		);
		const provider = new WorkflowExportViewProvider(vscode.Uri.file('/extension'));
		const fake = fakeView();
		provider.resolveWebviewView(fake.view);

		await fake.state.listener?.({ type: 'chooseFile', workflowCount: 1 });

		assert.deepStrictEqual(
			messagesOfType(fake, 'error').map(message => message.message),
			['Choose a new file name; workflow exports never overwrite files.'],
		);
		assert.deepStrictEqual(messagesOfType(fake, 'destination'), []);
		provider.dispose();
	});

	test('reveals only output paths returned by completed exports', async () => {
		const revealed: string[] = [];
		restores.push(
			stub(vscode.commands, 'executeCommand', (async (command: string, uri?: vscode.Uri) => {
				if (command === 'revealFileInOS' && uri) revealed.push(uri.fsPath);
			}) as typeof vscode.commands.executeCommand),
		);
		stubClient('exportWorkflows', (async input =>
			exportResult(input.workflowIds, '/exports/completed.json')) as typeof editorDataClient.exportWorkflows);
		const { provider, fake } = await loadProviderCatalog(workflowRows(1));

		await fake.state.listener?.({ type: 'reveal', path: '/exports/untrusted.json' });
		await fake.state.listener?.({ type: 'startExport', orgId: 'org-1', workflowIds: ['wf-1'], mode: 'bundle' });
		await fake.state.listener?.({ type: 'reveal', path: '/exports/completed.json' });
		await fake.state.listener?.({ type: 'reveal', path: '/exports/untrusted.json' });

		assert.deepStrictEqual(revealed, ['/exports/completed.json']);
		provider.dispose();
	});
});
