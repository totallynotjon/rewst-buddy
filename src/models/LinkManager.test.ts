import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { LinkManager, TemplateLink, FolderLink } from '@models';
import { initTestEnvironment } from '@test';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: LinkManager', () => {
	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
	});

	teardown(() => {
		LinkManager._resetForTesting();
	});

	suite('addLink() and getTemplateLink()', () => {
		test('should add and retrieve a template link', () => {
			const uri = vscode.Uri.file('/test/file.txt');
			const link: TemplateLink = {
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: {
					id: 'template-id-1',
					name: 'Test Template',
					updatedAt: '2024-01-01T00:00:00Z',
				} as any,
				bodyHash: 'abc123',
			};

			LinkManager.addLink(link);
			const retrieved = LinkManager.getTemplateLink(uri);

			assert.strictEqual(retrieved.template.id, 'template-id-1');
			assert.strictEqual(retrieved.template.name, 'Test Template');
			assert.strictEqual(retrieved.bodyHash, 'abc123');
		});

		test('should add and retrieve a folder link', () => {
			const uri = vscode.Uri.file('/test/folder');
			const link: FolderLink = {
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Folder',
			};

			LinkManager.addLink(link);
			const retrieved = LinkManager.getFolderLink(uri);

			assert.strictEqual(retrieved.type, 'Folder');
			assert.strictEqual(retrieved.org.id, 'org-1');
		});
	});

	suite('isLinked()', () => {
		test('should return true for linked file', () => {
			const uri = vscode.Uri.file('/test/file.txt');
			const link: TemplateLink = {
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: 'template-1', name: 'Test', updatedAt: '' } as any,
				bodyHash: 'hash',
			};

			LinkManager.addLink(link);
			assert.strictEqual(LinkManager.isLinked(uri), true);
		});

		test('should return false for unlinked file', () => {
			const uri = vscode.Uri.file('/test/unlinked.txt');
			assert.strictEqual(LinkManager.isLinked(uri), false);
		});
	});

	suite('removeLink()', () => {
		test('should remove a link', () => {
			const uri = vscode.Uri.file('/test/file.txt');
			const link: TemplateLink = {
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: 'template-1', name: 'Test', updatedAt: '' } as any,
				bodyHash: 'hash',
			};

			LinkManager.addLink(link);
			assert.strictEqual(LinkManager.isLinked(uri), true);

			LinkManager.removeLink(uri.toString());
			assert.strictEqual(LinkManager.isLinked(uri), false);
		});
	});

	suite('getTemplateLinkFromId()', () => {
		test('should find links by template ID', () => {
			const templateId = '550e8400-e29b-41d4-a716-446655440000';
			const uri1 = vscode.Uri.file('/test/file1.txt');
			const uri2 = vscode.Uri.file('/test/file2.txt');

			const link1: TemplateLink = {
				uriString: uri1.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: templateId, name: 'Shared Template', updatedAt: '' } as any,
				bodyHash: 'hash1',
			};

			const link2: TemplateLink = {
				uriString: uri2.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: templateId, name: 'Shared Template', updatedAt: '' } as any,
				bodyHash: 'hash2',
			};

			LinkManager.addLink(link1);
			LinkManager.addLink(link2);

			const links = LinkManager.getTemplateLinkFromId(templateId);
			assert.strictEqual(links.length, 2);
		});

		test('should return empty array for unknown template ID', () => {
			const links = LinkManager.getTemplateLinkFromId('unknown-id');
			assert.strictEqual(links.length, 0);
		});

		test('should update index when link is removed', () => {
			const templateId = 'template-to-remove';
			const uri = vscode.Uri.file('/test/file.txt');
			const link: TemplateLink = {
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: templateId, name: 'Test', updatedAt: '' } as any,
				bodyHash: 'hash',
			};

			LinkManager.addLink(link);
			assert.strictEqual(LinkManager.getTemplateLinkFromId(templateId).length, 1);

			LinkManager.removeLink(uri.toString());
			assert.strictEqual(LinkManager.getTemplateLinkFromId(templateId).length, 0);
		});
	});

	suite('clearTemplateLinks()', () => {
		test('should clear only template links, not folder links', () => {
			const templateUri = vscode.Uri.file('/test/template.txt');
			const folderUri = vscode.Uri.file('/test/folder');

			const templateLink: TemplateLink = {
				uriString: templateUri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: 'template-1', name: 'Test', updatedAt: '' } as any,
				bodyHash: 'hash',
			};

			const folderLink: FolderLink = {
				uriString: folderUri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Folder',
			};

			LinkManager.addLink(templateLink);
			LinkManager.addLink(folderLink);

			assert.strictEqual(LinkManager.isLinked(templateUri), true);
			assert.strictEqual(LinkManager.isLinked(folderUri), true);

			LinkManager.clearTemplateLinks();

			assert.strictEqual(LinkManager.isLinked(templateUri), false);
			assert.strictEqual(LinkManager.isLinked(folderUri), true);
		});
	});

	suite('getOrgLinks()', () => {
		test('should return only links for specified org', () => {
			const org1 = { id: 'org-1', name: 'Org One' };
			const org2 = { id: 'org-2', name: 'Org Two' };

			const link1: TemplateLink = {
				uriString: vscode.Uri.file('/test/file1.txt').toString(),
				org: org1,
				type: 'Template',
				template: { id: 't1', name: 'Template 1', updatedAt: '' } as any,
				bodyHash: 'h1',
			};

			const link2: TemplateLink = {
				uriString: vscode.Uri.file('/test/file2.txt').toString(),
				org: org2,
				type: 'Template',
				template: { id: 't2', name: 'Template 2', updatedAt: '' } as any,
				bodyHash: 'h2',
			};

			const link3: FolderLink = {
				uriString: vscode.Uri.file('/test/folder').toString(),
				org: org1,
				type: 'Folder',
			};

			LinkManager.addLink(link1);
			LinkManager.addLink(link2);
			LinkManager.addLink(link3);

			const org1Links = LinkManager.getOrgLinks(org1);
			assert.strictEqual(org1Links.length, 2);
			assert.ok(org1Links.every(l => l.org.id === 'org-1'));
		});
	});

	suite('getAllUris()', () => {
		test('should return all linked URIs', () => {
			const uri1 = vscode.Uri.file('/test/file1.txt');
			const uri2 = vscode.Uri.file('/test/file2.txt');

			const templateLink: TemplateLink = {
				uriString: uri1.toString(),
				org: { id: 'org-1', name: 'Org' },
				type: 'Template',
				template: { id: 't1', name: 'T1', updatedAt: '' } as any,
				bodyHash: 'h1',
			};

			const folderLink: FolderLink = {
				uriString: uri2.toString(),
				org: { id: 'org-1', name: 'Org' },
				type: 'Folder',
			};

			LinkManager.addLink(templateLink);
			LinkManager.addLink(folderLink);

			const uris = LinkManager.getAllUris();
			assert.strictEqual(uris.length, 2);
		});
	});

	suite('onLinksSaved event', () => {
		test('should emit event when link is added', done => {
			const uri = vscode.Uri.file('/test/file.txt');

			const subscription = LinkManager.onLinksSaved(event => {
				assert.strictEqual(event.links.length, 1);
				subscription.dispose();
				done();
			});

			const link: TemplateLink = {
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Org' },
				type: 'Template',
				template: { id: 't1', name: 'T1', updatedAt: '' } as any,
				bodyHash: 'h1',
			};
			LinkManager.addLink(link);
		});

		test('should not emit event during batch mode', done => {
			let eventCount = 0;

			const subscription = LinkManager.onLinksSaved(() => {
				eventCount++;
			});

			LinkManager.beginBatch();

			const link1: TemplateLink = {
				uriString: vscode.Uri.file('/test/f1.txt').toString(),
				org: { id: 'org-1', name: 'Org' },
				type: 'Template',
				template: { id: 't1', name: 'T1', updatedAt: '' } as any,
				bodyHash: 'h1',
			};

			const link2: TemplateLink = {
				uriString: vscode.Uri.file('/test/f2.txt').toString(),
				org: { id: 'org-1', name: 'Org' },
				type: 'Template',
				template: { id: 't2', name: 'T2', updatedAt: '' } as any,
				bodyHash: 'h2',
			};

			LinkManager.addLink(link1);
			LinkManager.addLink(link2);

			// No events during batch
			assert.strictEqual(eventCount, 0);

			LinkManager.endBatch().then(() => {
				// One event after batch ends
				assert.strictEqual(eventCount, 1);
				subscription.dispose();
				done();
			});
		});
	});
});
