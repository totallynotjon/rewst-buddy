import { LinkManager, SyncOnSaveManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import { getHash } from '@utils';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { SyncManager } from './SyncManager';

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
});
