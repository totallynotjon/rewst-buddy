import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { LinkManager } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment, stub } from '@test';
import {
	_resetJinjaFilterCacheForTesting,
	_resetJinjaFilterFetcherForTesting,
	_setJinjaFilterFetcherForTesting,
	parseJinjaFilters,
	primeFilters,
} from '../capabilities/jinjaDocsCapabilities';
import { JinjaFilterProvider } from './JinjaFilterProvider';

const { suite, test, setup, teardown } = Mocha;

const DEFAULT_ENGINE_BASE = 'https://engine.rewst.io';

const SAMPLE_PAYLOAD = [
	{ label: { label: 'abs' }, insertText: 'abs', documentation: { value: 'Absolute value.' } },
	{
		label: { label: 'center', detail: '(width=80)' },
		insertText: 'center',
		documentation: { value: 'Centers the value.' },
	},
];

function makeDoc(uri: vscode.Uri, text: string): vscode.TextDocument {
	return {
		uri,
		lineAt: () => ({ text }) as unknown as vscode.TextLine,
	} as unknown as vscode.TextDocument;
}

function makeTemplateLink(uri: vscode.Uri, orgId: string, orgName: string) {
	return {
		uriString: uri.toString(),
		org: { id: orgId, name: orgName },
		type: 'Template' as const,
		template: { id: 'template-1', name: 'Template 1', updatedAt: '' } as any,
		bodyHash: 'hash',
	};
}

async function primeAndWait(): Promise<void> {
	_setJinjaFilterFetcherForTesting(async () => parseJinjaFilters(SAMPLE_PAYLOAD));
	primeFilters(DEFAULT_ENGINE_BASE);
	await new Promise(resolve => setTimeout(resolve, 0));
}

suite('Unit: JinjaFilterProvider', () => {
	const uri = vscode.Uri.file('/test/linked.txt');
	const provider = new JinjaFilterProvider();
	const dummyToken = {} as vscode.CancellationToken;
	const dummyContext = { triggerKind: vscode.CompletionTriggerKind.Invoke } as vscode.CompletionContext;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		_resetJinjaFilterCacheForTesting();
		_resetJinjaFilterFetcherForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		_resetJinjaFilterCacheForTesting();
		_resetJinjaFilterFetcherForTesting();
	});

	suite('provideHover()', () => {
		test('unlinked document → undefined, no work', () => {
			let calls = 0;
			const restore = stub(SessionManager, 'getActiveSessions', () => {
				calls++;
				return [];
			});
			try {
				const doc = makeDoc(uri, '{{ name | center }}');
				const result = provider.provideHover(doc, new vscode.Position(0, 12), dummyToken);
				assert.strictEqual(result, undefined);
				assert.strictEqual(calls, 0);
			} finally {
				restore();
			}
		});

		test('warm cache, cursor on filter name → hover with docs', async () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
			const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
			SessionManager._setSessionsForTesting([session]);
			LinkManager.addLink(makeTemplateLink(uri, org.id, org.name));
			await primeAndWait();

			const line = '{{ name | center }}';
			const doc = makeDoc(uri, line);
			const character = line.indexOf('center') + 2;
			const result = provider.provideHover(doc, new vscode.Position(0, character), dummyToken);
			assert.ok(result instanceof vscode.Hover);
			const content = (result as vscode.Hover).contents[0] as vscode.MarkdownString;
			assert.ok(content.value.includes('Centers the value.'));
		});

		test('cold cache → undefined, primes in background', async () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
			const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
			SessionManager._setSessionsForTesting([session]);
			LinkManager.addLink(makeTemplateLink(uri, org.id, org.name));
			_setJinjaFilterFetcherForTesting(async () => parseJinjaFilters(SAMPLE_PAYLOAD));

			const line = '{{ name | center }}';
			const doc = makeDoc(uri, line);
			const character = line.indexOf('center') + 2;
			const result = provider.provideHover(doc, new vscode.Position(0, character), dummyToken);
			assert.strictEqual(result, undefined);

			await new Promise(resolve => setTimeout(resolve, 0));
			const second = provider.provideHover(doc, new vscode.Position(0, character), dummyToken);
			assert.ok(second instanceof vscode.Hover, 'background prime should have populated the cache by now');
		});

		test('linked but no session for the org → undefined, no throw', () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
			LinkManager.addLink(makeTemplateLink(uri, org.id, org.name));
			SessionManager._setSessionsForTesting([]);

			const line = '{{ name | center }}';
			const doc = makeDoc(uri, line);
			const character = line.indexOf('center') + 2;
			assert.doesNotThrow(() => {
				const result = provider.provideHover(doc, new vscode.Position(0, character), dummyToken);
				assert.strictEqual(result, undefined);
			});
		});
	});

	suite('provideCompletionItems()', () => {
		test('unlinked document → undefined, no work', () => {
			let calls = 0;
			const restore = stub(SessionManager, 'getActiveSessions', () => {
				calls++;
				return [];
			});
			try {
				const line = '{{ name | }}';
				const doc = makeDoc(uri, line);
				const character = line.indexOf('|') + 1;
				const result = provider.provideCompletionItems(
					doc,
					new vscode.Position(0, character),
					dummyToken,
					dummyContext,
				);
				assert.strictEqual(result, undefined);
				assert.strictEqual(calls, 0);
			} finally {
				restore();
			}
		});

		test('not after a pipe → undefined', async () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
			const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
			SessionManager._setSessionsForTesting([session]);
			LinkManager.addLink(makeTemplateLink(uri, org.id, org.name));
			await primeAndWait();

			const line = '{{ name | center }}';
			const doc = makeDoc(uri, line);
			const result = provider.provideCompletionItems(doc, new vscode.Position(0, 3), dummyToken, dummyContext);
			assert.strictEqual(result, undefined);
		});

		test('warm cache, right after pipe → full filter list as items', async () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
			const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
			SessionManager._setSessionsForTesting([session]);
			LinkManager.addLink(makeTemplateLink(uri, org.id, org.name));
			await primeAndWait();

			const line = '{{ name | }}';
			const doc = makeDoc(uri, line);
			const character = line.indexOf('|') + 1;
			const result = provider.provideCompletionItems(
				doc,
				new vscode.Position(0, character),
				dummyToken,
				dummyContext,
			) as vscode.CompletionItem[];
			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 2);
			const center = result.find(item => item.label === 'center')!;
			assert.ok(center);
			assert.strictEqual(center.insertText, 'center');
			assert.strictEqual(center.detail, 'center(width=80)');
			assert.ok((center.documentation as vscode.MarkdownString).value.includes('Centers the value.'));
		});

		test('linked but no session for the org → undefined, no throw', async () => {
			const org = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
			LinkManager.addLink(makeTemplateLink(uri, org.id, org.name));
			SessionManager._setSessionsForTesting([]);

			const line = '{{ name | }}';
			const doc = makeDoc(uri, line);
			const character = line.indexOf('|') + 1;
			assert.doesNotThrow(() => {
				const result = provider.provideCompletionItems(
					doc,
					new vscode.Position(0, character),
					dummyToken,
					dummyContext,
				);
				assert.strictEqual(result, undefined);
			});
		});
	});
});
