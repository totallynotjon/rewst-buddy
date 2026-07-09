import { FolderLink, LinkManager, Org, SyncOnSaveManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment, stub } from '@test';
import { getHash, log } from '@utils';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { resolveConflictChoice, SyncManager, orgFromTemplate } from './SyncManager';

const { suite, test, setup, teardown } = Mocha;

/**
 * Create a mock TextDocument for testing
 */
function createMockDocument(options: { uri: vscode.Uri; content: string }): vscode.TextDocument {
	const { uri, content } = options;
	const lines = content.split('\n');

	return {
		uri,
		fileName: uri.fsPath,
		isUntitled: false,
		languageId: 'plaintext',
		version: 1,
		isDirty: false,
		isClosed: false,
		eol: vscode.EndOfLine.LF,
		lineCount: lines.length,
		encoding: 'utf8',
		getText: () => content,
		getWordRangeAtPosition: () => undefined,
		lineAt: (line: number | vscode.Position) => {
			const lineNumber = typeof line === 'number' ? line : line.line;
			const text = lines[lineNumber] || '';
			return {
				lineNumber,
				text,
				range: new vscode.Range(lineNumber, 0, lineNumber, text.length),
				rangeIncludingLineBreak: new vscode.Range(lineNumber, 0, lineNumber + 1, 0),
				firstNonWhitespaceCharacterIndex: text.search(/\S/) >= 0 ? text.search(/\S/) : text.length,
				isEmptyOrWhitespace: text.trim().length === 0,
			};
		},
		offsetAt: () => 0,
		positionAt: () => new vscode.Position(0, 0),
		save: () => Promise.resolve(true),
		validateRange: (range: vscode.Range) => range,
		validatePosition: (pos: vscode.Position) => pos,
	} as vscode.TextDocument;
}

suite('Unit: SyncManager.checkAutoFetch', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	test('should not fetch when file is not linked', async () => {
		// Arrange: Create a document that is NOT linked
		const uri = vscode.Uri.file('/test/unlinked-file.txt');
		const content = '// some content';
		const doc = createMockDocument({ uri, content });

		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });
		const { session, wrapper } = createMockSession({
			profile: { org, allManagedOrgs: [org] },
		});

		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({ name: 'Test Template' }),
		});

		SessionManager._setSessionsForTesting([session]);

		// Act: Call checkAutoFetch
		// Note: checkAutoFetch is private, so we access it via bracket notation
		await (SyncManager as any)['checkAutoFetch'](doc);

		// Assert: getTemplate should NOT have been called since file isn't linked
		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 0);
	});

	test('should fetch when file is linked (even without sync-on-save enabled)', async () => {
		// Arrange: Create a linked file but DO NOT enable sync-on-save
		const uri = vscode.Uri.file('/test/linked-file.txt');
		const content = '// template content';
		const bodyHash = getHash(content);
		const templateId = 'template-123';
		const updatedAt = '2024-01-01T00:00:00Z';

		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: {
				id: templateId,
				name: 'Test Template',
				updatedAt,
			} as any,
			bodyHash,
		};

		LinkManager.addLink(link);

		// Important: Do NOT enable sync-on-save for this URI

		const { session, wrapper } = createMockSession({
			profile: { org, allManagedOrgs: [org] },
		});

		// Configure the mock to return the same template (no update needed)
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Test Template',
				body: content,
				updatedAt, // Same timestamp = no update
				orgId: 'org-1',
				organization: Fixtures.org({ id: 'org-1', name: 'Test Org' }),
			}),
		});

		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content });

		// Act: Call checkAutoFetch
		await (SyncManager as any)['checkAutoFetch'](doc);

		// Assert: getTemplate SHOULD have been called even without sync-on-save enabled
		assert.strictEqual(
			wrapper.getCallsFor('getTemplate').length,
			1,
			'getTemplate should be called for linked files regardless of sync-on-save setting',
		);
	});

	test('should not apply template when fetch fails', async () => {
		// Arrange: Link file and configure SDK to fail on getTemplate
		const uri = vscode.Uri.file('/test/linked-file.txt');
		const content = '// template content';
		const bodyHash = getHash(content);
		const templateId = 'template-123';
		const originalUpdatedAt = '2024-01-01T00:00:00Z';

		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: {
				id: templateId,
				name: 'Test Template',
				updatedAt: originalUpdatedAt,
			} as any,
			bodyHash,
		};

		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({
			profile: { org, allManagedOrgs: [org] },
		});

		// Configure the mock to fail on getTemplate
		wrapper.when('getTemplate', {
			error: Fixtures.networkError('Connection failed'),
		});

		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content });

		// Act: Call checkAutoFetch
		await (SyncManager as any)['checkAutoFetch'](doc);

		// Assert: getTemplate was called
		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);

		// Assert: Link should remain unchanged (updatedAt should be the same)
		const updatedLink = LinkManager.getTemplateLink(uri);
		assert.strictEqual(updatedLink.template.updatedAt, originalUpdatedAt);
	});

	test('should not apply template when local file has changed', async () => {
		// Arrange: Link with hash of ORIGINAL content, but document has DIFFERENT content
		const uri = vscode.Uri.file('/test/linked-file.txt');
		const originalContent = '// original content';
		const modifiedContent = '// modified content'; // Different from original
		const originalBodyHash = getHash(originalContent);
		const templateId = 'template-123';
		const originalUpdatedAt = '2024-01-01T00:00:00Z';
		const remoteUpdatedAt = '2024-01-02T00:00:00Z'; // Remote is newer

		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: {
				id: templateId,
				name: 'Test Template',
				updatedAt: originalUpdatedAt,
			} as any,
			bodyHash: originalBodyHash, // Hash of original content
		};

		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({
			profile: { org, allManagedOrgs: [org] },
		});

		// Configure remote to have newer timestamp
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Test Template',
				body: '// remote content',
				updatedAt: remoteUpdatedAt,
				orgId: 'org-1',
				organization: Fixtures.org({ id: 'org-1', name: 'Test Org' }),
			}),
		});

		SessionManager._setSessionsForTesting([session]);

		// Create doc with MODIFIED content (hash mismatch)
		const doc = createMockDocument({ uri, content: modifiedContent });

		// Act: Call checkAutoFetch
		await (SyncManager as any)['checkAutoFetch'](doc);

		// Assert: getTemplate was called
		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);

		// Assert: Link should NOT be updated because local file has changed
		// The updatedAt should remain the original value
		const updatedLink = LinkManager.getTemplateLink(uri);
		assert.strictEqual(
			updatedLink.template.updatedAt,
			originalUpdatedAt,
			'Link should not be updated when local file has unsaved changes',
		);
	});

	test('should not apply template when remote is in sync', async () => {
		// Arrange: Link and doc have matching hash, remote and local have same updatedAt
		const uri = vscode.Uri.file('/test/linked-file.txt');
		const content = '// template content';
		const bodyHash = getHash(content);
		const templateId = 'template-123';
		const updatedAt = '2024-01-01T00:00:00Z'; // Same timestamp

		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: {
				id: templateId,
				name: 'Test Template',
				updatedAt,
			} as any,
			bodyHash,
		};

		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({
			profile: { org, allManagedOrgs: [org] },
		});

		// Configure remote with SAME timestamp (in sync)
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Test Template',
				body: content,
				updatedAt, // Same as local = no update needed
				orgId: 'org-1',
				organization: Fixtures.org({ id: 'org-1', name: 'Test Org' }),
			}),
		});

		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content });

		// Act: Call checkAutoFetch
		await (SyncManager as any)['checkAutoFetch'](doc);

		// Assert: getTemplate was called
		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);

		// Assert: Link should remain unchanged
		const updatedLink = LinkManager.getTemplateLink(uri);
		assert.strictEqual(updatedLink.template.updatedAt, updatedAt);
		assert.strictEqual(updatedLink.bodyHash, bodyHash);
	});

	// One session manages a parent org plus its sub-orgs. A sync must record the
	// org the template actually belongs to (from the template), not the session's
	// primary org — otherwise sub-org templates report the main org. See issue #94.
	test('orgFromTemplate uses the template org, falling back to orgId without an organization', () => {
		const withOrg = Fixtures.fullTemplate({
			orgId: 'sub-org',
			organization: Fixtures.org({ id: 'sub-org', name: 'Sub Org' }),
		});
		assert.deepStrictEqual(orgFromTemplate(withOrg), { id: 'sub-org', name: 'Sub Org' });

		const withoutOrg = Fixtures.fullTemplate({ orgId: 'sub-org', organization: null as any });
		assert.deepStrictEqual(orgFromTemplate(withoutOrg), { id: 'sub-org', name: 'sub-org' });

		const blankOrgId = Fixtures.fullTemplate({
			orgId: '' as any,
			organization: Fixtures.org({ id: 'sub-org', name: 'Sub Org' }),
		});
		assert.deepStrictEqual(
			orgFromTemplate(blankOrgId),
			{ id: 'sub-org', name: 'Sub Org' },
			'a blank orgId must fall back to organization.id, never persist an empty org id',
		);
	});

	test('refreshLinkMetadata keeps a sub-org template in its sub-org, not the session org', () => {
		const mainOrg = Fixtures.orgModel({ id: 'main-org', name: 'Main Org' });
		const { session } = createMockSession({
			profile: { org: mainOrg, allManagedOrgs: [mainOrg, { id: 'sub-org', name: 'Sub Org' }] },
		});
		SessionManager._setSessionsForTesting([session]);

		const uri = vscode.Uri.file('/test/sub-org-template.txt');
		const body = '// sub org template body';
		// The link is created in the sub-org, as the link commands build it.
		const existing: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: { id: 'sub-org', name: 'Sub Org' },
			template: { id: 'tpl-1', name: 'Sub Tpl', updatedAt: '0' } as any,
			bodyHash: getHash(body),
		};
		LinkManager.addLink(existing);

		const doc = createMockDocument({ uri, content: body });
		const remoteTemplate = Fixtures.fullTemplate({
			id: 'tpl-1',
			name: 'Sub Tpl',
			body,
			updatedAt: '2024-02-02T00:00:00Z',
			orgId: 'sub-org',
			organization: Fixtures.org({ id: 'sub-org', name: 'Sub Org' }),
		});

		SyncManager.refreshLinkMetadata(doc, session, remoteTemplate, body);

		const link = LinkManager.getTemplateLink(uri);
		assert.strictEqual(link.org.id, 'sub-org', 'link must stay in the sub-org');
		assert.strictEqual(link.org.name, 'Sub Org');
		assert.notStrictEqual(link.org.id, mainOrg.id, 'must not be rewritten to the session primary org');
	});

	test('applyTemplateToDocument records the template sub-org, not the session org', async () => {
		const mainOrg = Fixtures.orgModel({ id: 'main-org', name: 'Main Org' });
		const { session } = createMockSession({
			profile: { org: mainOrg, allManagedOrgs: [mainOrg, { id: 'sub-org', name: 'Sub Org' }] },
		});
		SessionManager._setSessionsForTesting([session]);

		const uri = vscode.Uri.file('/test/apply-sub-org.txt');
		const body = '// downloaded body';
		// Pre-set with the session (main) org so a clobber would be visible.
		const existing: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: mainOrg,
			template: { id: 'tpl-2', name: 'Sub Tpl 2', updatedAt: '0' } as any,
			bodyHash: getHash('old'),
		};
		LinkManager.addLink(existing);

		const doc = createMockDocument({ uri, content: 'old' });
		const remoteTemplate = Fixtures.fullTemplate({
			id: 'tpl-2',
			name: 'Sub Tpl 2',
			body,
			updatedAt: '2024-03-03T00:00:00Z',
			orgId: 'sub-org',
			organization: Fixtures.org({ id: 'sub-org', name: 'Sub Org' }),
		});

		// addLink only runs after a confirmed save (#172), so stub applyEdit/save
		// to succeed — a non-open mock document's save fails for real otherwise.
		const restoreApply = stub(vscode.workspace, 'applyEdit', (async () => true) as typeof vscode.workspace.applyEdit);
		const restoreSave = stub(vscode.workspace, 'save', (async (u: vscode.Uri) => u) as typeof vscode.workspace.save);
		try {
			await SyncManager.applyTemplateToDocument(doc, session, remoteTemplate);
		} finally {
			restoreApply();
			restoreSave();
		}

		const link = LinkManager.getTemplateLink(uri);
		assert.strictEqual(link.org.id, 'sub-org', 'downloaded link must record the template sub-org');
		assert.strictEqual(link.org.name, 'Sub Org');
	});

	// Spec: issue #172 — concurrent downloads mostly failed to save, and a
	// retry after a failed save falsely reported "in sync" against an empty
	// local file because the failed edit was left applied in memory.
	suite('applyTemplateToDocument resilience (#172)', () => {
		function setUpDownload(uri: vscode.Uri, localContent: string) {
			const org = Fixtures.orgModel({ id: 'org-172', name: 'Org 172' });
			const { session } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
			SessionManager._setSessionsForTesting([session]);
			const doc = createMockDocument({ uri, content: localContent });
			const remoteTemplate = Fixtures.fullTemplate({
				id: 'tpl-172',
				name: 'Tpl 172',
				body: '// remote body',
				updatedAt: '2024-05-05T00:00:00Z',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			});
			return { doc, session, remoteTemplate };
		}

		test('retries a failed save before giving up, and links the template once it succeeds', async () => {
			const uri = vscode.Uri.file('/test/retry-succeeds.txt');
			const { doc, session, remoteTemplate } = setUpDownload(uri, '');

			let saveCalls = 0;
			const restoreApply = stub(
				vscode.workspace,
				'applyEdit',
				(async () => true) as typeof vscode.workspace.applyEdit,
			);
			const restoreSave = stub(vscode.workspace, 'save', (async (u: vscode.Uri) => {
				saveCalls++;
				return saveCalls < 3 ? undefined : u; // fails twice, succeeds on the 3rd attempt
			}) as typeof vscode.workspace.save);

			try {
				await SyncManager.applyTemplateToDocument(doc, session, remoteTemplate);
			} finally {
				restoreApply();
				restoreSave();
			}

			assert.strictEqual(saveCalls, 3, 'save is retried until it succeeds');
			const link = LinkManager.getTemplateLink(uri);
			assert.strictEqual(link.template.id, 'tpl-172', 'the link is recorded once the retried save succeeds');
		});

		test('reverts the in-memory edit and does not update the link when every save attempt fails', async () => {
			const uri = vscode.Uri.file('/test/retry-exhausted.txt');
			const localContent = ''; // matches the real #172 repro: an empty local file
			const { doc, session, remoteTemplate } = setUpDownload(uri, localContent);

			const appliedTexts: (string | undefined)[] = [];
			const restoreApply = stub(vscode.workspace, 'applyEdit', (async (edit: vscode.WorkspaceEdit) => {
				appliedTexts.push(edit.get(uri)[0]?.newText);
				return true;
			}) as typeof vscode.workspace.applyEdit);
			const restoreSave = stub(vscode.workspace, 'save', (async () => undefined) as typeof vscode.workspace.save);

			try {
				await assert.rejects(
					() => SyncManager.applyTemplateToDocument(doc, session, remoteTemplate),
					/applyTemplateToDocument: failed to save/,
				);
			} finally {
				restoreApply();
				restoreSave();
			}

			assert.strictEqual(appliedTexts.length, 2, 'the download edit, then a revert edit, are applied');
			assert.strictEqual(appliedTexts[0], '// remote body', 'the first edit writes the remote body');
			assert.strictEqual(
				appliedTexts[1],
				localContent,
				'the revert edit restores the pre-download local content, not the unpersisted remote body',
			);
			assert.throws(
				() => LinkManager.getTemplateLink(uri),
				'the link is never recorded for a download that never actually saved',
			);
		});

		test('serializes concurrent applyTemplateToDocument calls across different files', async () => {
			const uriA = vscode.Uri.file('/test/concurrent-a.txt');
			const uriB = vscode.Uri.file('/test/concurrent-b.txt');
			const a = setUpDownload(uriA, '');
			const b = setUpDownload(uriB, '');

			let inFlight = 0;
			let maxInFlight = 0;
			const restoreApply = stub(
				vscode.workspace,
				'applyEdit',
				(async () => true) as typeof vscode.workspace.applyEdit,
			);
			const restoreSave = stub(vscode.workspace, 'save', (async (u: vscode.Uri) => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise(resolve => setTimeout(resolve, 20));
				inFlight--;
				return u;
			}) as typeof vscode.workspace.save);

			try {
				await Promise.all([
					SyncManager.applyTemplateToDocument(a.doc, a.session, a.remoteTemplate),
					SyncManager.applyTemplateToDocument(b.doc, b.session, b.remoteTemplate),
				]);
			} finally {
				restoreApply();
				restoreSave();
			}

			assert.strictEqual(maxInFlight, 1, 'saves for different files never overlap');
		});
	});

	test('should attempt to apply remote template when local unchanged and remote is newer', async () => {
		// Arrange: Link and doc have matching hash, remote has newer updatedAt
		const uri = vscode.Uri.file('/test/linked-file.txt');
		const content = '// template content';
		const bodyHash = getHash(content);
		const templateId = 'template-123';
		const localUpdatedAt = '2024-01-01T00:00:00Z';
		const remoteUpdatedAt = '2024-01-02T00:00:00Z'; // Newer

		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: {
				id: templateId,
				name: 'Test Template',
				updatedAt: localUpdatedAt,
			} as any,
			bodyHash,
		};

		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({
			profile: { org, allManagedOrgs: [org] },
		});

		const remoteBody = '// updated remote content';

		// Configure remote with NEWER timestamp
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Test Template',
				body: remoteBody,
				updatedAt: remoteUpdatedAt,
				orgId: 'org-1',
				organization: Fixtures.org({ id: 'org-1', name: 'Test Org' }),
			}),
		});

		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content });

		// Act: Call checkAutoFetch
		// Note: This will try to call vscode.workspace.applyEdit which won't work in tests,
		// but we can verify that getTemplate was called with the right conditions
		try {
			await (SyncManager as any)['checkAutoFetch'](doc);
		} catch {
			// Expected - applyEdit won't work in unit test environment
		}

		// Assert: getTemplate was called (the method attempted to fetch and apply)
		assert.strictEqual(
			wrapper.getCallsFor('getTemplate').length,
			1,
			'getTemplate should be called when remote may be newer',
		);
	});

	// Spec: template-sync "Auto-fetch disabled". The rewst-buddy.autoFetchOnOpen
	// gate is the first check in checkAutoFetch; when off, no remote fetch happens
	// even for a linked, otherwise fetch-eligible file.
	test('does not fetch when rewst-buddy.autoFetchOnOpen is disabled', async () => {
		const uri = vscode.Uri.file('/test/auto-fetch-disabled.txt');
		const content = '// template content';
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: 'template-123', name: 'Test Template', updatedAt: 'local-ts' } as any,
			bodyHash: getHash(content),
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		// A newer remote is available, so only the setting stops the fetch.
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: 'template-123',
				name: 'Test Template',
				body: '// newer remote content',
				updatedAt: 'remote-ts',
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		const restore = stub(vscode.workspace, 'getConfiguration', (() => ({
			get: (key: string, defaultValue?: unknown) => (key === 'autoFetchOnOpen' ? false : defaultValue),
		})) as unknown as typeof vscode.workspace.getConfiguration);

		const doc = createMockDocument({ uri, content });
		try {
			await (SyncManager as any)['checkAutoFetch'](doc);
		} finally {
			restore();
		}

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 0, 'no remote fetch when auto-fetch is disabled');
		const after = LinkManager.getTemplateLink(uri);
		assert.strictEqual(after.template.updatedAt, 'local-ts', 'link is left unchanged');
		assert.strictEqual(after.bodyHash, getHash(content), 'local content is left unchanged');
	});

	test('auto-fetch on open records the template sub-org, not the session org', async () => {
		const mainOrg = Fixtures.orgModel({ id: 'main-org', name: 'Main Org' });
		const { session, wrapper } = createMockSession({
			profile: { org: mainOrg, allManagedOrgs: [mainOrg, { id: 'sub-org', name: 'Sub Org' }] },
		});
		SessionManager._setSessionsForTesting([session]);

		const uri = vscode.Uri.file('/test/auto-fetch-sub-org.txt');
		const content = '// unchanged local body';
		// Pre-set with the session (main) org so a clobber would be visible.
		const existing: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org: mainOrg,
			template: { id: 'tpl-af', name: 'Sub Tpl', updatedAt: '2024-01-01T00:00:00Z' } as any,
			bodyHash: getHash(content),
		};
		LinkManager.addLink(existing);

		// Remote is newer and local matches its stored hash -> auto-fetch applies it.
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: 'tpl-af',
				name: 'Sub Tpl',
				body: '// newer remote body',
				updatedAt: '2024-01-02T00:00:00Z',
				orgId: 'sub-org',
				organization: Fixtures.org({ id: 'sub-org', name: 'Sub Org' }),
			}),
		});

		const doc = createMockDocument({ uri, content });
		// addLink only runs after a confirmed save (#172), so stub applyEdit/save
		// to succeed — a non-open mock document's save fails for real otherwise.
		const restoreApply = stub(vscode.workspace, 'applyEdit', (async () => true) as typeof vscode.workspace.applyEdit);
		const restoreSave = stub(vscode.workspace, 'save', (async (u: vscode.Uri) => u) as typeof vscode.workspace.save);
		try {
			await (SyncManager as any)['checkAutoFetch'](doc);
		} finally {
			restoreApply();
			restoreSave();
		}

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);
		const link = LinkManager.getTemplateLink(uri);
		assert.strictEqual(link.org.id, 'sub-org', 'auto-fetched link records the template sub-org');
		assert.strictEqual(link.org.name, 'Sub Org');
	});
});

// Spec: template-sync "Sync on save when enabled". handleSave is the
// onDidSaveTextDocument handler: it consults SyncOnSaveManager and either runs
// a full sync or does nothing. Accessed via bracket notation, matching the
// checkAutoFetch pattern above.
suite('Unit: SyncManager.handleSave (sync on save)', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	function setUpLinkedDoc() {
		const uri = vscode.Uri.file('/test/save-file.txt');
		const templateId = 'template-save';
		const org = Fixtures.orgModel({ id: 'org-save', name: 'Save Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: templateId, name: 'Save Template', updatedAt: 'ts-1' } as any,
			bodyHash: getHash('// prior synced content'),
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		// Remote timestamp matches the link but the body differs from local ->
		// upload-local, a clean action with no vscode editor interaction.
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Save Template',
				body: '// remote body',
				updatedAt: 'ts-1',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		wrapper.when('updateTemplateBody', {
			data: Fixtures.updateTemplateBodyMutation({
				id: templateId,
				name: 'Save Template',
				updatedAt: 'ts-2',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content: '// locally edited content' });
		return { uri, doc, wrapper };
	}

	test('a save of a linked file with sync-on-save active runs a sync', async () => {
		const { uri, doc, wrapper } = setUpLinkedDoc();
		SyncOnSaveManager.enableSync(uri);

		await (SyncManager as any)['handleSave'](doc);

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1, 'save triggers a sync fetch');
		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 1, 'local edit is uploaded');
		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody')[0].variables.body, '// locally edited content');
	});

	test('a save of a linked file without sync-on-save active does not sync', async () => {
		const { doc, wrapper } = setUpLinkedDoc();

		await (SyncManager as any)['handleSave'](doc);

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 0, 'no fetch without sync-on-save');
		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 0, 'no upload without sync-on-save');
	});

	test('dismissing a conflict during sync-on-save is a clean no-op, not a scary error notification', async () => {
		const uri = vscode.Uri.file('/test/save-conflict-file.txt');
		const templateId = 'template-save-conflict';
		const org = Fixtures.orgModel({ id: 'org-save-conflict', name: 'Save Conflict Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: templateId, name: 'T', updatedAt: 'local-ts' } as any,
			bodyHash: getHash('// some prior synced content'),
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'T',
				body: '// remote content, different from local',
				updatedAt: 'remote-ts',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);
		SyncOnSaveManager.enableSync(uri);

		SyncManager._setConflictDepsForTesting({
			showDiff: async () => vscode.Uri.file('/test/fake-remote'),
			promptChoice: async () => undefined,
			closeDiff: async () => {},
		});

		let notifyErrorCalls = 0;
		const restoreError = stub(log, 'notifyError', ((message: string) => {
			notifyErrorCalls++;
			return new Error(message);
		}) as typeof log.notifyError);
		let notifyInfoCalls = 0;
		const restoreInfo = stub(log, 'notifyInfo', (() => {
			notifyInfoCalls++;
		}) as typeof log.notifyInfo);

		const doc = createMockDocument({ uri, content: '// locally edited content' });

		try {
			await (SyncManager as any)['handleSave'](doc);
		} finally {
			restoreError();
			restoreInfo();
			SyncManager._resetConflictDepsForTesting();
		}

		assert.strictEqual(notifyErrorCalls, 0, 'a dismissed conflict is a clean abort, not an error notification');
		assert.strictEqual(notifyInfoCalls, 0, 'a dismissed conflict did not succeed either');
	});
});

// fetchFolder is the mechanism behind "Link Folder to Organization" + "Fetch
// Folder": it materializes an org's remote templates as linked local files.
// vscode.workspace.fs in this test host is real (not mocked), so these tests
// write to a throwaway temp directory on disk.
suite('Unit: SyncManager.fetchFolder', () => {
	let tmpDir: string;
	let folderUri: vscode.Uri;
	let org: Org;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-fetchFolder-'));
		folderUri = vscode.Uri.file(tmpDir);
		org = { id: 'org-fetch', name: 'Fetch Org' };
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function setUpSession(templates: { id: string; name: string }[]) {
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('listTemplates', {
			data: Fixtures.listTemplatesQuery(
				templates.map(t =>
					Fixtures.template({
						id: t.id,
						name: t.name,
						orgId: org.id,
						organization: Fixtures.org({ id: org.id, name: org.name }),
					}),
				),
			),
		});
		SessionManager._setSessionsForTesting([session]);
		return { session, wrapper };
	}

	const folderLink = (): FolderLink => ({ type: 'Folder', uriString: folderUri.toString(), org });

	test('links and fetches: missing org templates are materialized as linked local files', async () => {
		const { wrapper } = setUpSession([
			{ id: 't1', name: 'Alpha' },
			{ id: 't2', name: 'Beta' },
		]);
		wrapper.when('getTemplate', vars => ({
			data: Fixtures.getTemplateQuery({
				id: vars.id,
				name: vars.id === 't1' ? 'Alpha' : 'Beta',
				body: `body-${vars.id}`,
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		}));

		await SyncManager.fetchFolder(folderLink());

		const links = LinkManager.getOrgTemplateLinks(org);
		assert.strictEqual(links.length, 2, 'both remote templates are linked');
		const byId = new Map(links.map(l => [l.template.id, l]));
		assert.ok(byId.has('t1') && byId.has('t2'));

		for (const [id, link] of byId) {
			const filePath = vscode.Uri.parse(link.uriString).fsPath;
			assert.ok(fs.existsSync(filePath), `file for ${id} should exist on disk`);
			assert.strictEqual(fs.readFileSync(filePath, 'utf8'), `body-${id}`);
			assert.strictEqual(link.bodyHash, getHash(`body-${id}`));
		}
	});

	test('skips already-linked templates and only fetches the missing ones', async () => {
		const { wrapper } = setUpSession([
			{ id: 't1', name: 'Alpha' },
			{ id: 't2', name: 'Beta' },
		]);
		// t1 is already linked locally (e.g. from a previous fetch)
		const existingLink: TemplateLink = {
			type: 'Template',
			uriString: vscode.Uri.joinPath(folderUri, 'Alpha-existing.txt').toString(),
			org,
			template: {
				id: 't1',
				name: 'Alpha',
				updatedAt: '',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			} as any,
			bodyHash: 'existing-hash',
		};
		LinkManager.addLink(existingLink);

		wrapper.when('getTemplate', vars => ({
			data: Fixtures.getTemplateQuery({
				id: vars.id,
				name: 'Beta',
				body: 'beta-body',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		}));

		await SyncManager.fetchFolder(folderLink());

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1, 'only the missing template is fetched');
		assert.strictEqual(wrapper.getCallsFor('getTemplate')[0].variables.id, 't2');

		const links = LinkManager.getOrgTemplateLinks(org);
		assert.strictEqual(links.length, 2, 'existing link kept, new link added');
		assert.ok(links.some(l => l.template.id === 't2'));
	});

	test('reports successful and failed counts when one template cannot be fetched', async () => {
		const { wrapper } = setUpSession([
			{ id: 't1', name: 'Alpha' },
			{ id: 't2', name: 'Beta' },
			{ id: 't3', name: 'Gamma' },
		]);
		wrapper.when('getTemplate', vars => {
			if (vars.id === 't2') return { error: Fixtures.networkError('boom') };
			return {
				data: Fixtures.getTemplateQuery({
					id: vars.id,
					name: vars.id,
					body: `${vars.id}-body`,
					orgId: org.id,
					organization: Fixtures.org({ id: org.id, name: org.name }),
				}),
			};
		});

		const messages: string[] = [];
		const originalShowInformationMessage = vscode.window.showInformationMessage;
		Object.defineProperty(vscode.window, 'showInformationMessage', {
			value: (async (msg: string) => {
				messages.push(msg);
				return undefined;
			}) as typeof vscode.window.showInformationMessage,
			configurable: true,
			writable: true,
		});

		try {
			await SyncManager.fetchFolder(folderLink());
		} finally {
			Object.defineProperty(vscode.window, 'showInformationMessage', {
				value: originalShowInformationMessage,
				configurable: true,
				writable: true,
			});
		}

		const links = LinkManager.getOrgTemplateLinks(org);
		assert.strictEqual(links.length, 2, 'the failed template is not linked');
		assert.ok(!links.some(l => l.template.id === 't2'));
		for (const link of links) {
			const filePath = vscode.Uri.parse(link.uriString).fsPath;
			assert.strictEqual(
				fs.readFileSync(filePath, 'utf8'),
				`${link.template.id}-body`,
				'fetch continued: successful templates are written to disk',
			);
		}
		assert.ok(
			messages.includes('Fetched 2/3 templates into the folder'),
			`expected a partial-failure message, got: ${messages.join(' | ')}`,
		);
	});

	test('sanitizes unsafe characters and de-duplicates colliding filenames', async () => {
		fs.writeFileSync(path.join(tmpDir, 'Pre.txt'), 'do-not-overwrite');

		const { wrapper } = setUpSession([
			{ id: 't1', name: 'Dup' },
			{ id: 't2', name: 'Dup' },
			{ id: 't3', name: 'Weird:Name/Test' },
			{ id: 't4', name: 'Pre.txt' },
		]);
		wrapper.when('getTemplate', vars => ({
			data: Fixtures.getTemplateQuery({
				id: vars.id,
				name: vars.id,
				body: `${vars.id}-body`,
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		}));

		await SyncManager.fetchFolder(folderLink());

		const links = LinkManager.getOrgTemplateLinks(org);
		assert.strictEqual(links.length, 4);

		const basenames = links.map(l => path.basename(vscode.Uri.parse(l.uriString).fsPath)).sort();
		assert.deepStrictEqual(
			basenames,
			['Dup', 'Dup(1)', 'Pre(1).txt', 'Weird_Name_Test'].sort(),
			'sanitized + de-duplicated filenames',
		);

		// A pre-existing unrelated file that was never part of this fetch is untouched.
		assert.strictEqual(
			fs.readFileSync(path.join(tmpDir, 'Pre.txt'), 'utf8'),
			'do-not-overwrite',
			'pre-existing file left untouched',
		);
	});
});

// Spec: template-sync "Resolve conflicts via diff, not a blind modal". The
// 'conflict' action is only reachable through the public syncTemplate() entry
// point (computeSyncDecision -> syncTemplateInternal -> handleConflict), which
// no prior test exercised. These inject the showDiff/promptChoice/closeDiff
// deps via the test seam to drive each outcome without a real diff editor.
suite('Unit: SyncManager.syncTemplate (conflict resolution)', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
		SyncManager._resetConflictDepsForTesting();
	});

	function setUpConflict() {
		const uri = vscode.Uri.file('/test/conflict-file.txt');
		const localContent = '// locally edited content';
		const templateId = 'template-conflict';
		const org = Fixtures.orgModel({ id: 'org-conflict', name: 'Conflict Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: templateId, name: 'Conflict Template', updatedAt: 'local-ts' } as any,
			bodyHash: getHash('// some prior synced content'),
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Conflict Template',
				body: '// remote content, different from local',
				updatedAt: 'remote-ts', // differs from the link's local-ts -> conflict
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content: localContent });
		return { uri, doc, wrapper, templateId, org };
	}

	const fakeRemoteUri = vscode.Uri.parse('rewst-remote:/test/conflict-file.txt?rewst-remote=1');

	test('keeps local: uploads local body and shows a diff first', async () => {
		const { doc, wrapper, templateId, org } = setUpConflict();
		const calls: string[] = [];
		let showDiffArgs: [vscode.TextDocument, string] | undefined;
		let closeDiffArg: vscode.TextDocument | undefined;

		SyncManager._setConflictDepsForTesting({
			showDiff: async (d, remoteBody) => {
				calls.push('showDiff');
				showDiffArgs = [d, remoteBody];
				return fakeRemoteUri;
			},
			promptChoice: async () => {
				calls.push('promptChoice');
				return 'Keep Local';
			},
			closeDiff: async d => {
				calls.push('closeDiff');
				closeDiffArg = d;
			},
		});

		wrapper.when('updateTemplateBody', {
			data: Fixtures.updateTemplateBodyMutation({
				id: templateId,
				name: 'Conflict Template',
				updatedAt: 'uploaded-ts',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});

		await SyncManager.syncTemplate(doc);

		assert.deepStrictEqual(calls, ['showDiff', 'promptChoice', 'closeDiff']);
		assert.strictEqual(showDiffArgs?.[0], doc, 'showDiff receives the document');
		assert.strictEqual(
			showDiffArgs?.[1],
			'// remote content, different from local',
			'showDiff receives the remote body',
		);
		assert.strictEqual(closeDiffArg, doc, 'closeDiff runs after the choice is handled');

		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 1, 'keep local uploads local body');
		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody')[0].variables.body, '// locally edited content');

		const link = LinkManager.getTemplateLink(doc.uri);
		assert.strictEqual(link.template.updatedAt, 'uploaded-ts', 'link reflects the upload response');
	});

	test('keep local re-resolves session instead of reusing one captured before the prompt', async () => {
		const { doc, wrapper: staleWrapper, templateId, org } = setUpConflict();

		// A session can be refreshed, removed, or replaced while the user is
		// staring at the (indefinitely long) conflict prompt. Swap in a distinct
		// session for the same org from inside the promptChoice stub to simulate
		// that, and assert the upload lands on the new session, not the stale
		// one captured before the prompt was shown.
		const { session: freshSession, wrapper: freshWrapper } = createMockSession({
			profile: { org, allManagedOrgs: [org] },
		});
		freshWrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Conflict Template',
				body: '// remote content, different from local',
				updatedAt: 'remote-ts',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		freshWrapper.when('updateTemplateBody', {
			data: Fixtures.updateTemplateBodyMutation({
				id: templateId,
				name: 'Conflict Template',
				updatedAt: 'uploaded-ts',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});

		SyncManager._setConflictDepsForTesting({
			showDiff: async () => fakeRemoteUri,
			promptChoice: async () => {
				SessionManager._setSessionsForTesting([freshSession]);
				return 'Keep Local';
			},
			closeDiff: async () => {},
		});

		await SyncManager.syncTemplate(doc);

		assert.strictEqual(
			staleWrapper.getCallsFor('updateTemplateBody').length,
			0,
			'the session captured before the prompt must not be used for the upload',
		);
		assert.strictEqual(
			freshWrapper.getCallsFor('updateTemplateBody').length,
			1,
			'the session swapped in during the prompt wait should receive the upload',
		);
	});

	test('keep local surfaces a clear error when no session remains after the prompt', async () => {
		const { doc, wrapper: staleWrapper } = setUpConflict();

		// The org's only session is removed while the user is staring at the
		// conflict prompt; re-resolution must fail loudly rather than fall back
		// to the stale session captured before the prompt.
		SyncManager._setConflictDepsForTesting({
			showDiff: async () => fakeRemoteUri,
			promptChoice: async () => {
				SessionManager._setSessionsForTesting([]);
				return 'Keep Local';
			},
			closeDiff: async () => {},
		});

		await assert.rejects(() => SyncManager.syncTemplate(doc), /no session found/);

		assert.strictEqual(
			staleWrapper.getCallsFor('updateTemplateBody').length,
			0,
			'the stale session must not receive the upload when re-resolution fails',
		);
	});

	test('takes remote: remote body replaces local file', async () => {
		const { doc, wrapper } = setUpConflict();

		SyncManager._setConflictDepsForTesting({
			showDiff: async () => fakeRemoteUri,
			promptChoice: async () => 'Take Remote',
			closeDiff: async () => {},
		});

		// addLink only runs after a confirmed save (#172), so stub applyEdit/save
		// to succeed — a non-open mock document's save fails for real otherwise.
		const restoreApply = stub(vscode.workspace, 'applyEdit', (async () => true) as typeof vscode.workspace.applyEdit);
		const restoreSave = stub(vscode.workspace, 'save', (async (u: vscode.Uri) => u) as typeof vscode.workspace.save);
		try {
			await SyncManager.syncTemplate(doc);
		} finally {
			restoreApply();
			restoreSave();
		}

		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 0, 'no upload happens on take-remote');

		const link = LinkManager.getTemplateLink(doc.uri);
		assert.strictEqual(link.template.updatedAt, 'remote-ts', 'link now reflects the downloaded remote template');
		assert.strictEqual(link.bodyHash, getHash('// remote content, different from local'));
	});

	test('user dismisses: aborts, nothing changes, diff is still closed', async () => {
		const { doc, wrapper } = setUpConflict();
		let closeDiffCalled = false;

		SyncManager._setConflictDepsForTesting({
			showDiff: async () => fakeRemoteUri,
			promptChoice: async () => undefined,
			closeDiff: async () => {
				closeDiffCalled = true;
			},
		});

		await assert.rejects(() => SyncManager.syncTemplate(doc));

		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 0, 'no upload on dismiss');
		assert.ok(closeDiffCalled, 'closeDiff must run even when the user dismisses');
		const link = LinkManager.getTemplateLink(doc.uri);
		assert.strictEqual(link.template.updatedAt, 'local-ts', 'link is untouched after dismiss');
	});

	test('showDiff failure aborts without ever prompting', async () => {
		const { doc } = setUpConflict();
		let promptCalls = 0;

		SyncManager._setConflictDepsForTesting({
			showDiff: async () => {
				throw new Error('diff failed to open');
			},
			promptChoice: async () => {
				promptCalls++;
				return 'Keep Local';
			},
			closeDiff: async () => {},
		});

		await assert.rejects(() => SyncManager.syncTemplate(doc), /diff failed to open/);
		assert.strictEqual(promptCalls, 0, 'promptChoice must never run if the diff never opened');
	});
});

// Spec: conflict resolution is button-driven (editor/title toolbar buttons on
// the diff itself), not a showInformationMessage modal — the modal was the
// reported source of ambiguity even after the diff panes were labeled. These
// tests exercise the REAL defaultConflictDeps (no _setConflictDepsForTesting
// override), driving the choice via the exported resolveConflictChoice(), the
// same function the toolbar button commands call.
suite('Unit: SyncManager.syncTemplate (conflict resolution, real button-driven deps)', () => {
	// The notification is a second, parallel resolution path alongside the diff's
	// toolbar buttons (see resolveConflictChoice's doc comment) — stub it so tests
	// don't leave a real, unresolvable notification open in the test extension
	// host, and so the dedicated test below can drive it explicitly.
	let notificationResolve: ((choice: string | undefined) => void) | undefined;
	let restoreNotification: (() => void) | undefined;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
		SyncManager._resetConflictDepsForTesting();
		notificationResolve = undefined;
		restoreNotification = stub(vscode.window, 'showInformationMessage', ((..._args: unknown[]) => {
			return new Promise<string | undefined>(resolve => {
				notificationResolve = resolve;
			});
		}) as unknown as typeof vscode.window.showInformationMessage);
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
		SyncManager._resetConflictDepsForTesting();
		restoreNotification?.();
		notificationResolve = undefined;
	});

	function setUpConflict() {
		const uri = vscode.Uri.file('/test/real-conflict-file.txt');
		const localContent = '// locally edited content';
		const templateId = 'template-real-conflict';
		const org = Fixtures.orgModel({ id: 'org-real-conflict', name: 'Real Conflict Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: templateId, name: 'Conflict Template', updatedAt: 'local-ts' } as any,
			bodyHash: getHash('// some prior synced content'),
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Conflict Template',
				body: '// remote content, different from local',
				updatedAt: 'remote-ts',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content: localContent });
		return { uri, doc, wrapper, templateId, org };
	}

	test('resolveConflictChoice("Keep Local") resolves the pending diff and uploads', async () => {
		const { doc, wrapper, templateId, org } = setUpConflict();
		wrapper.when('updateTemplateBody', {
			data: Fixtures.updateTemplateBodyMutation({
				id: templateId,
				name: 'Conflict Template',
				updatedAt: 'uploaded-ts',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		const restoreExec = stub(
			vscode.commands,
			'executeCommand',
			(async () => undefined) as typeof vscode.commands.executeCommand,
		);

		try {
			const syncPromise = SyncManager.syncTemplate(doc);
			await new Promise(resolve => setTimeout(resolve, 0));
			resolveConflictChoice('Keep Local');
			await syncPromise;
		} finally {
			restoreExec();
		}

		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 1);
		const link = LinkManager.getTemplateLink(doc.uri);
		assert.strictEqual(link.template.updatedAt, 'uploaded-ts');
	});

	test('sets the conflictDiffActive context key while the diff is open and clears it after', async () => {
		const { doc, wrapper, templateId, org } = setUpConflict();
		wrapper.when('updateTemplateBody', {
			data: Fixtures.updateTemplateBodyMutation({
				id: templateId,
				name: 'Conflict Template',
				updatedAt: 'uploaded-ts',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		const setContextCalls: unknown[][] = [];
		const restoreExec = stub(vscode.commands, 'executeCommand', (async (...args: unknown[]) => {
			if (args[0] === 'setContext') setContextCalls.push(args);
			return undefined;
		}) as typeof vscode.commands.executeCommand);

		try {
			const syncPromise = SyncManager.syncTemplate(doc);
			await new Promise(resolve => setTimeout(resolve, 0));
			resolveConflictChoice('Keep Local');
			await syncPromise;
		} finally {
			restoreExec();
		}

		assert.deepStrictEqual(setContextCalls, [
			['setContext', 'rewst-buddy.conflictDiffActive', true],
			['setContext', 'rewst-buddy.conflictDiffActive', false],
		]);
	});

	test('closing the diff tab without a choice aborts, same as an explicit dismiss', async () => {
		const { doc } = setUpConflict();
		let closeHandler: ((doc: vscode.TextDocument) => void) | undefined;
		const restoreClose = stub(vscode.workspace, 'onDidCloseTextDocument', ((
			listener: (doc: vscode.TextDocument) => void,
		) => {
			closeHandler = listener;
			return { dispose() {} };
		}) as typeof vscode.workspace.onDidCloseTextDocument);

		let capturedRemoteUri: vscode.Uri | undefined;
		const restoreExec = stub(vscode.commands, 'executeCommand', (async (...args: unknown[]) => {
			if (args[0] === 'vscode.diff') capturedRemoteUri = args[2] as vscode.Uri;
			return undefined;
		}) as typeof vscode.commands.executeCommand);

		try {
			const syncPromise = SyncManager.syncTemplate(doc);
			await new Promise(resolve => setTimeout(resolve, 0));
			assert.ok(closeHandler, 'expected promptChoice to register a close listener');
			assert.ok(capturedRemoteUri, 'expected showDiff to have opened the diff');
			closeHandler!({ uri: capturedRemoteUri! } as vscode.TextDocument);
			await assert.rejects(() => syncPromise);
		} finally {
			restoreClose();
			restoreExec();
		}

		const link = LinkManager.getTemplateLink(doc.uri);
		assert.strictEqual(
			link.template.updatedAt,
			'local-ts',
			'nothing changes when the tab is closed without a choice',
		);
	});

	test('clicking the notification button also resolves the pending diff, same as the toolbar buttons', async () => {
		const { doc, wrapper, templateId, org } = setUpConflict();
		wrapper.when('updateTemplateBody', {
			data: Fixtures.updateTemplateBodyMutation({
				id: templateId,
				name: 'Conflict Template',
				updatedAt: 'uploaded-ts',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		const restoreExec = stub(
			vscode.commands,
			'executeCommand',
			(async () => undefined) as typeof vscode.commands.executeCommand,
		);

		try {
			const syncPromise = SyncManager.syncTemplate(doc);
			await new Promise(resolve => setTimeout(resolve, 0));
			assert.ok(
				notificationResolve,
				'expected promptChoice to show a notification with Keep Local/Take Remote buttons',
			);
			notificationResolve!('Keep Local');
			await syncPromise;
		} finally {
			restoreExec();
		}

		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 1);
		const link = LinkManager.getTemplateLink(doc.uri);
		assert.strictEqual(link.template.updatedAt, 'uploaded-ts');
	});
});

// Spec: template-sync "Guard against concurrent syncs". The syncingUris Set
// guard inside the public syncTemplate() entry point was never exercised by a
// prior test. Calling syncTemplate() twice back-to-back (without awaiting in
// between) relies on JS run-to-completion: the first call's synchronous prefix
// adds the uri to the guard Set before yielding at its first await, so the
// second call's synchronous guard check is guaranteed to see it.
suite('Unit: SyncManager.syncTemplate (concurrency guard)', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	test('a second sync started before the first finishes is suppressed, not raced', async () => {
		const uri = vscode.Uri.file('/test/concurrent-file.txt');
		const content = '// edited content';
		const templateId = 'template-concurrent';
		const updatedAt = 'ts-1';
		const org = Fixtures.orgModel({ id: 'org-concurrent', name: 'Concurrent Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: templateId, name: 'Concurrent Template', updatedAt } as any,
			bodyHash: getHash('// some prior synced content'),
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		// Remote timestamp matches the link (no remote change) but the body differs
		// from local -> upload-local, a clean action with no vscode editor interaction.
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Concurrent Template',
				body: '// remote body',
				updatedAt,
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		wrapper.when('updateTemplateBody', {
			data: Fixtures.updateTemplateBodyMutation({
				id: templateId,
				name: 'Concurrent Template',
				updatedAt: 'ts-2',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content });

		await Promise.all([SyncManager.syncTemplate(doc), SyncManager.syncTemplate(doc)]);

		assert.strictEqual(
			wrapper.getCallsFor('getTemplate').length,
			1,
			'only the first sync fetches the remote template',
		);
		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 1, 'only the first sync uploads');
	});
});

// Spec: template-sync "Avoid false conflicts after upload". SyncManager.ts:196
// (link.template = response.template inside updateTemplateBody) is the actual
// mechanism; this exercises it through two real syncTemplate() calls in a row
// rather than mocking the upload/decision step away.
suite('Unit: SyncManager.syncTemplate (avoid false conflicts after upload)', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	test('a second save right after a successful upload uploads cleanly instead of reporting a conflict', async () => {
		const uri = vscode.Uri.file('/test/two-saves-file.txt');
		const templateId = 'template-two-saves';
		const org = Fixtures.orgModel({ id: 'org-two-saves', name: 'Two Saves Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: templateId, name: 'Two Saves Template', updatedAt: 'ts-1' } as any,
			bodyHash: getHash('// original content'),
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });

		// First sync: remote is still at ts-1 (matches the link) -> upload-local.
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Two Saves Template',
				body: '// original content',
				updatedAt: 'ts-1',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		wrapper.when('updateTemplateBody', {
			data: Fixtures.updateTemplateBodyMutation({
				id: templateId,
				name: 'Two Saves Template',
				updatedAt: 'ts-2',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		const firstDoc = createMockDocument({ uri, content: '// edit one' });
		await SyncManager.syncTemplate(firstDoc);

		assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 1, 'first save uploads');
		const afterFirst = LinkManager.getTemplateLink(uri);
		assert.strictEqual(afterFirst.template.updatedAt, 'ts-2', 'link records the timestamp Rewst returned');

		// Second sync: remote now reflects what was just uploaded (ts-2, body = edit
		// one). Without recording the upload response timestamp, the link would still
		// read 'ts-1' here and this would misread as a conflict instead of a clean upload.
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: templateId,
				name: 'Two Saves Template',
				body: '// edit one',
				updatedAt: 'ts-2',
				orgId: org.id,
				organization: Fixtures.org({ id: org.id, name: org.name }),
			}),
		});

		const secondDoc = createMockDocument({ uri, content: '// edit two' });
		await SyncManager.syncTemplate(secondDoc);

		assert.strictEqual(
			wrapper.getCallsFor('updateTemplateBody').length,
			2,
			'second save uploads cleanly, not a conflict',
		);
	});
});

// Spec: template-sync "Background folder fetch". fetchAllFolders is the
// periodic ALL-folders background job (distinct from the single-folder,
// user-triggered fetchFolder covered above). isActive is flipped directly via
// bracket access, matching the existing private-method access pattern in this
// file, so these tests exercise fetchAllFolders' own loop/gate without
// depending on the real SessionManager-driven activation lifecycle.
suite('Unit: SyncManager.fetchAllFolders', () => {
	let tmpDirA: string;
	let tmpDirB: string;
	let folderUriA: vscode.Uri;
	let folderUriB: vscode.Uri;
	let orgA: Org;
	let orgB: Org;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
		tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-fetchAllFolders-a-'));
		tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-fetchAllFolders-b-'));
		folderUriA = vscode.Uri.file(tmpDirA);
		folderUriB = vscode.Uri.file(tmpDirB);
		orgA = { id: 'org-bg-a', name: 'Org A' };
		orgB = { id: 'org-bg-b', name: 'Org B' };
	});

	teardown(() => {
		(SyncManager as any)['isActive'] = false;
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
		fs.rmSync(tmpDirA, { recursive: true, force: true });
		fs.rmSync(tmpDirB, { recursive: true, force: true });
	});

	test('does nothing when the manager is inactive', async () => {
		(SyncManager as any)['isActive'] = false;

		const { session, wrapper } = createMockSession({ profile: { org: orgA, allManagedOrgs: [orgA] } });
		SessionManager._setSessionsForTesting([session]);
		LinkManager.addLink({ type: 'Folder', uriString: folderUriA.toString(), org: orgA });

		await SyncManager.fetchAllFolders();

		assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 0, 'no folder is fetched while inactive');
	});

	test('fetches missing templates for every linked folder and links them locally', async () => {
		const { session, wrapper } = createMockSession({
			profile: { org: orgA, allManagedOrgs: [orgA, orgB] },
		});
		wrapper.when('listTemplates', vars => ({
			data: Fixtures.listTemplatesQuery([
				Fixtures.template({
					id: vars.orgId === orgA.id ? 'a1' : 'b1',
					name: vars.orgId === orgA.id ? 'Alpha' : 'Bravo',
					orgId: vars.orgId,
					organization: Fixtures.org({
						id: vars.orgId,
						name: vars.orgId === orgA.id ? orgA.name : orgB.name,
					}),
				}),
			]),
		}));
		wrapper.when('getTemplate', vars => {
			const isA = vars.id === 'a1';
			return {
				data: Fixtures.getTemplateQuery({
					id: vars.id,
					name: isA ? 'Alpha' : 'Bravo',
					body: `${vars.id}-body`,
					orgId: isA ? orgA.id : orgB.id,
					organization: Fixtures.org({ id: isA ? orgA.id : orgB.id, name: isA ? orgA.name : orgB.name }),
				}),
			};
		});
		SessionManager._setSessionsForTesting([session]);

		LinkManager.addLink({ type: 'Folder', uriString: folderUriA.toString(), org: orgA });
		LinkManager.addLink({ type: 'Folder', uriString: folderUriB.toString(), org: orgB });

		(SyncManager as any)['isActive'] = true;
		await SyncManager.fetchAllFolders();

		assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 2, 'both linked folders are fetched');

		const linksA = LinkManager.getOrgTemplateLinks(orgA);
		const linksB = LinkManager.getOrgTemplateLinks(orgB);
		assert.strictEqual(linksA.length, 1, 'org A got its missing template linked');
		assert.strictEqual(linksB.length, 1, 'org B got its missing template linked');

		const fileA = vscode.Uri.parse(linksA[0].uriString).fsPath;
		const fileB = vscode.Uri.parse(linksB[0].uriString).fsPath;
		assert.ok(fs.existsSync(fileA), 'org A template written to disk');
		assert.ok(fs.existsSync(fileB), 'org B template written to disk');
		assert.strictEqual(fs.readFileSync(fileA, 'utf8'), 'a1-body');
		assert.strictEqual(fs.readFileSync(fileB, 'utf8'), 'b1-body');
	});

	test('a folder whose org has no session does not stop the remaining folders from fetching', async () => {
		// Only org B has a session; org A's folder link is stale (its session
		// was removed) and its failure must not abort the whole background pass.
		const { session, wrapper } = createMockSession({ profile: { org: orgB, allManagedOrgs: [orgB] } });
		wrapper.when('listTemplates', {
			data: Fixtures.listTemplatesQuery([
				Fixtures.template({
					id: 'b1',
					name: 'Bravo',
					orgId: orgB.id,
					organization: Fixtures.org({ id: orgB.id, name: orgB.name }),
				}),
			]),
		});
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: 'b1',
				name: 'Bravo',
				body: 'b1-body',
				orgId: orgB.id,
				organization: Fixtures.org({ id: orgB.id, name: orgB.name }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		// Org A first: its failure previously aborted the loop before org B ran.
		LinkManager.addLink({ type: 'Folder', uriString: folderUriA.toString(), org: orgA });
		LinkManager.addLink({ type: 'Folder', uriString: folderUriB.toString(), org: orgB });

		(SyncManager as any)['isActive'] = true;
		await SyncManager.fetchAllFolders();

		const linksB = LinkManager.getOrgTemplateLinks(orgB);
		assert.strictEqual(linksB.length, 1, "org B's folder is still fetched after org A's folder failed");
	});
});

// Contract from openspec/specs/template-sync "Auto-fetch on open without
// clobbering local edits": "newer" means a parsed instant later than the link's
// last-known updatedAt; older, missing, or unparsable timestamps must not
// replace the local file.
suite('Unit: SyncManager.checkAutoFetch (spec contract: timestamp comparison)', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	test('an older remote timestamp does not replace the local file', async () => {
		const uri = vscode.Uri.file('/test/older-remote.txt');
		const content = '// synced content';
		const bodyHash = getHash(content);
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: 'tpl-old', name: 'Tpl', updatedAt: '2024-05-02T00:00:00Z' } as any,
			bodyHash,
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: 'tpl-old',
				name: 'Tpl',
				body: '// stale remote body',
				updatedAt: '2024-05-01T00:00:00Z',
				orgId: 'org-1',
				organization: Fixtures.org({ id: 'org-1', name: 'Test Org' }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content });
		try {
			await (SyncManager as any)['checkAutoFetch'](doc);
		} catch {
			// applying an edit in the unit host throws; the link mutation below is the observable signal
		}

		const after = LinkManager.getTemplateLink(uri);
		assert.strictEqual(
			after.template.updatedAt,
			'2024-05-02T00:00:00Z',
			'an older remote must not replace the local link state',
		);
		assert.strictEqual(after.bodyHash, bodyHash, 'an older remote must not rewrite the local body');
	});

	test('an unparsable remote timestamp does not replace the local file', async () => {
		const uri = vscode.Uri.file('/test/unparsable-remote.txt');
		const content = '// synced content';
		const bodyHash = getHash(content);
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: 'tpl-bad-ts', name: 'Tpl', updatedAt: '2024-05-02T00:00:00Z' } as any,
			bodyHash,
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery({
				id: 'tpl-bad-ts',
				name: 'Tpl',
				body: '// remote body',
				updatedAt: 'not-a-timestamp',
				orgId: 'org-1',
				organization: Fixtures.org({ id: 'org-1', name: 'Test Org' }),
			}),
		});
		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content });
		try {
			await (SyncManager as any)['checkAutoFetch'](doc);
		} catch {
			// applying an edit in the unit host throws; the link mutation below is the observable signal
		}

		const after = LinkManager.getTemplateLink(uri);
		assert.strictEqual(
			after.template.updatedAt,
			'2024-05-02T00:00:00Z',
			'a remote that cannot prove it is newer must leave the local file unchanged',
		);
		assert.strictEqual(after.bodyHash, bodyHash);
	});
});

// Contract from openspec/specs/template-sync "Normalize organizations during
// sync updates": every content-changing path — including the interactive
// save-driven sync — verifies the fetched remote template belongs to the
// expected organization before changing either side.
suite('Unit: SyncManager.syncTemplate (spec contract: org guard)', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		SyncOnSaveManager._resetForTesting();
	});

	test('an interactive sync fails closed before uploading when the remote template belongs to another org', async () => {
		const uri = vscode.Uri.file('/test/org-guard-upload.txt');
		const localContent = '// locally edited content';
		const org = Fixtures.orgModel({ id: 'org-a', name: 'Org A' });

		const link: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: 'tpl-guard', name: 'Guarded', updatedAt: 'ts-1', orgId: 'org-a' } as any,
			bodyHash: getHash('// prior synced content'),
		};
		LinkManager.addLink(link);

		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', {
			data: Fixtures.getTemplateQuery(
				Fixtures.fullTemplate({
					id: 'tpl-guard',
					name: 'Guarded',
					body: '// prior synced content',
					updatedAt: 'ts-1',
					orgId: 'org-b',
				}),
			),
		});
		wrapper.when('updateTemplateBody', {
			data: Fixtures.updateTemplateBodyMutation({ id: 'tpl-guard', updatedAt: 'ts-2' }),
		});
		SessionManager._setSessionsForTesting([session]);

		const doc = createMockDocument({ uri, content: localContent });
		await assert.rejects(
			SyncManager.syncTemplate(doc),
			'a remote template owned by another org must fail the sync closed',
		);

		assert.strictEqual(
			wrapper.getCallsFor('updateTemplateBody').length,
			0,
			'no upload may happen once the remote org mismatches the expected org',
		);
	});
});
