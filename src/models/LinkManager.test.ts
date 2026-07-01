import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { LinkManager, TemplateLink, FolderLink, Link } from '@models';
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

		test('should not create duplicates when same link is re-added', () => {
			const uri = vscode.Uri.file('/test/file.txt');
			const link: TemplateLink = {
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: 'template-1', name: 'Test', updatedAt: '2024-01-01' } as any,
				bodyHash: 'hash-v1',
			};

			LinkManager.addLink(link);
			assert.strictEqual(LinkManager.getTemplateLinkFromId('template-1').length, 1);

			link.bodyHash = 'hash-v2';
			LinkManager.addLink(link);
			assert.strictEqual(LinkManager.getTemplateLinkFromId('template-1').length, 1);

			link.bodyHash = 'hash-v3';
			LinkManager.addLink(link);
			const result = LinkManager.getTemplateLinkFromId('template-1');
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].bodyHash, 'hash-v3');
		});

		test('should preserve both entries when same template has different URIs after re-add', () => {
			const templateId = 'shared-template';
			const uri1 = vscode.Uri.file('/test/file1.txt');
			const uri2 = vscode.Uri.file('/test/file2.txt');

			const link1: TemplateLink = {
				uriString: uri1.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: templateId, name: 'Shared', updatedAt: '' } as any,
				bodyHash: 'hash1',
			};

			const link2: TemplateLink = {
				uriString: uri2.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: templateId, name: 'Shared', updatedAt: '' } as any,
				bodyHash: 'hash2',
			};

			LinkManager.addLink(link1);
			LinkManager.addLink(link2);
			assert.strictEqual(LinkManager.getTemplateLinkFromId(templateId).length, 2);

			link1.bodyHash = 'hash1-updated';
			LinkManager.addLink(link1);
			assert.strictEqual(LinkManager.getTemplateLinkFromId(templateId).length, 2);
		});

		test('re-linking a uri to a different template/org clears the old indexes', () => {
			// Issue #90: overwriting a link with a different template id / org left the
			// old templateIdIndex and orgIdIndex entries behind, so reverse lookups
			// (hover, ctrl-click, open-by-id) returned the stale file.
			const uri = vscode.Uri.file('/test/relink.txt');
			const orgA = { id: 'org-A', name: 'Org A' };
			const orgB = { id: 'org-B', name: 'Org B' };

			const first: TemplateLink = {
				uriString: uri.toString(),
				org: orgA,
				type: 'Template',
				template: { id: 'tpl-A', name: 'A', updatedAt: '' } as any,
				bodyHash: 'h1',
			};
			LinkManager.addLink(first);
			assert.strictEqual(LinkManager.getTemplateLinkFromId('tpl-A').length, 1);

			const second: TemplateLink = {
				uriString: uri.toString(),
				org: orgB,
				type: 'Template',
				template: { id: 'tpl-B', name: 'B', updatedAt: '' } as any,
				bodyHash: 'h2',
			};
			LinkManager.addLink(second);

			assert.deepStrictEqual(LinkManager.getTemplateLinkFromId('tpl-A'), [], 'old template index cleared');
			assert.strictEqual(LinkManager.getTemplateLinkFromId('tpl-B').length, 1, 'new template index populated');
			assert.strictEqual(LinkManager.getTemplateLink(uri).template.id, 'tpl-B');
			assert.strictEqual(LinkManager.getOrgTemplateLinks(orgA).length, 0, 'old org index cleared');
			assert.strictEqual(LinkManager.getOrgTemplateLinks(orgB).length, 1, 'new org index populated');
		});

		test('re-linking to a different template in the same org moves the reverse lookup without duplicating the org entry', () => {
			const uri = vscode.Uri.file('/test/same-org.txt');
			const org = { id: 'org-1', name: 'Org One' };

			const first: TemplateLink = {
				uriString: uri.toString(),
				org,
				type: 'Template',
				template: { id: 'old', name: 'Old', updatedAt: '' } as any,
				bodyHash: 'h1',
			};
			LinkManager.addLink(first);

			const second: TemplateLink = {
				uriString: uri.toString(),
				org,
				type: 'Template',
				template: { id: 'new', name: 'New', updatedAt: '' } as any,
				bodyHash: 'h2',
			};
			LinkManager.addLink(second);

			assert.deepStrictEqual(LinkManager.getTemplateLinkFromId('old'), [], 'old reverse lookup cleared');
			assert.strictEqual(LinkManager.getTemplateLinkFromId('new').length, 1, 'new reverse lookup populated');
			// Same org throughout: the org index still holds exactly this one uri.
			assert.strictEqual(LinkManager.getOrgLinks(org).length, 1, 'no duplicate org entry');
		});

		test('overwriting a template link with a folder link at the same uri clears the template reverse lookup', () => {
			const uri = vscode.Uri.file('/test/swap');
			const org = { id: 'org-1', name: 'Org One' };

			const tmpl: TemplateLink = {
				uriString: uri.toString(),
				org,
				type: 'Template',
				template: { id: 'tpl', name: 'T', updatedAt: '' } as any,
				bodyHash: 'h',
			};
			LinkManager.addLink(tmpl);
			assert.strictEqual(LinkManager.getTemplateLinkFromId('tpl').length, 1);

			const folder: FolderLink = { uriString: uri.toString(), org, type: 'Folder' };
			LinkManager.addLink(folder);

			assert.deepStrictEqual(
				LinkManager.getTemplateLinkFromId('tpl'),
				[],
				'no stale template entry after folder swap',
			);
			assert.strictEqual(LinkManager.getFolderLink(uri).type, 'Folder');
			assert.strictEqual(LinkManager.getOrgLinks(org).length, 1, 'org index holds the single folder link');
		});

		test('should not grow index across repeated sync cycles', () => {
			const uri = vscode.Uri.file('/test/synced.txt');
			const link: TemplateLink = {
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: 'sync-template', name: 'Synced', updatedAt: '' } as any,
				bodyHash: 'hash',
			};

			for (let i = 0; i < 10; i++) {
				link.bodyHash = `hash-cycle-${i}`;
				LinkManager.addLink(link);
			}

			assert.strictEqual(LinkManager.getTemplateLinkFromId('sync-template').length, 1);
			assert.strictEqual(LinkManager.getAllTemplateLinks().length, 1);
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

	suite('pruneStaleLinks()', () => {
		test('should remove links pointing to non-existent files', async () => {
			const existingUri = vscode.Uri.file(__filename); // This test file exists
			const missingUri = vscode.Uri.file('/nonexistent/path/template.js');

			const existingLink: TemplateLink = {
				uriString: existingUri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: 't-exists', name: 'Existing', updatedAt: '' } as any,
				bodyHash: 'h1',
			};

			const missingLink: TemplateLink = {
				uriString: missingUri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: 't-missing', name: 'Missing', updatedAt: '' } as any,
				bodyHash: 'h2',
			};

			LinkManager.addLink(existingLink);
			LinkManager.addLink(missingLink);
			assert.strictEqual(LinkManager.isLinked(existingUri), true);
			assert.strictEqual(LinkManager.isLinked(missingUri), true);

			await LinkManager._pruneForTesting();

			assert.strictEqual(LinkManager.isLinked(existingUri), true, 'Existing file link should be kept');
			assert.strictEqual(LinkManager.isLinked(missingUri), false, 'Missing file link should be pruned');
		});

		test('should keep all links when all files exist', async () => {
			const uri = vscode.Uri.file(__filename);
			const link: TemplateLink = {
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: 't1', name: 'Test', updatedAt: '' } as any,
				bodyHash: 'hash',
			};

			LinkManager.addLink(link);
			await LinkManager._pruneForTesting();

			assert.strictEqual(LinkManager.isLinked(uri), true, 'Link to existing file should be kept');
		});

		test('should do nothing when there are no links', async () => {
			await LinkManager._pruneForTesting();
			assert.strictEqual(LinkManager.getAllTemplateLinks().length, 0);
		});
	});

	suite('handleDelete()', () => {
		test('should remove a directly linked file on delete', () => {
			const uri = vscode.Uri.file('/test/linked-file.txt');
			const link: TemplateLink = {
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: 't1', name: 'Test', updatedAt: '' } as any,
				bodyHash: 'hash',
			};

			LinkManager.addLink(link);
			assert.strictEqual(LinkManager.isLinked(uri), true);

			LinkManager._handleDeleteForTesting({ files: [uri] });
			assert.strictEqual(LinkManager.isLinked(uri), false);
		});

		test('should remove descendant links when a directory is deleted', () => {
			const dirUri = vscode.Uri.file('/test/project');
			const child1Uri = vscode.Uri.file('/test/project/file1.txt');
			const child2Uri = vscode.Uri.file('/test/project/sub/file2.txt');
			const outsideUri = vscode.Uri.file('/test/other/file3.txt');

			const makeLink = (uri: vscode.Uri, id: string): TemplateLink => ({
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id, name: `Template ${id}`, updatedAt: '' } as any,
				bodyHash: 'hash',
			});

			LinkManager.addLink(makeLink(child1Uri, 't1'));
			LinkManager.addLink(makeLink(child2Uri, 't2'));
			LinkManager.addLink(makeLink(outsideUri, 't3'));

			LinkManager._handleDeleteForTesting({ files: [dirUri] });

			assert.strictEqual(LinkManager.isLinked(child1Uri), false, 'Child file should be removed');
			assert.strictEqual(LinkManager.isLinked(child2Uri), false, 'Nested child should be removed');
			assert.strictEqual(LinkManager.isLinked(outsideUri), true, 'Outside file should remain');
		});

		test('should do nothing when deleting an unlinked file', () => {
			const linkedUri = vscode.Uri.file('/test/linked.txt');
			const unlinkedUri = vscode.Uri.file('/test/unlinked.txt');

			const link: TemplateLink = {
				uriString: linkedUri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id: 't1', name: 'Test', updatedAt: '' } as any,
				bodyHash: 'hash',
			};

			LinkManager.addLink(link);
			LinkManager._handleDeleteForTesting({ files: [unlinkedUri] });

			assert.strictEqual(LinkManager.isLinked(linkedUri), true, 'Existing link should remain');
		});
	});

	// handleRename's single-file branch is already covered indirectly via
	// moveLink() (see 'org index' suite below); this covers the directory
	// branch, which must relink every descendant under the new folder path.
	// vscode.workspace.fs.stat in this test host is real, so the *new* path
	// needs to actually exist on disk for the directory check to pass — the
	// old path does not (handleRename never stats it).
	suite('handleRename() directory branch', () => {
		let newDirPath: string;

		setup(() => {
			newDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-rename-'));
		});

		teardown(() => {
			fs.rmSync(newDirPath, { recursive: true, force: true });
		});

		test('renaming a folder relinks every descendant link under the new path', async () => {
			const oldDirUri = vscode.Uri.file('/test/old-project');
			const newDirUri = vscode.Uri.file(newDirPath);

			const child1Old = vscode.Uri.file('/test/old-project/file1.txt');
			const child2Old = vscode.Uri.file('/test/old-project/sub/file2.txt');
			const outsideUri = vscode.Uri.file('/test/other/file3.txt');

			const makeLink = (uri: vscode.Uri, id: string): TemplateLink => ({
				uriString: uri.toString(),
				org: { id: 'org-1', name: 'Test Org' },
				type: 'Template',
				template: { id, name: `Template ${id}`, updatedAt: '' } as any,
				bodyHash: `hash-${id}`,
			});

			LinkManager.addLink(makeLink(child1Old, 't1'));
			LinkManager.addLink(makeLink(child2Old, 't2'));
			LinkManager.addLink(makeLink(outsideUri, 't3'));

			await LinkManager._handleRenameForTesting({ files: [{ oldUri: oldDirUri, newUri: newDirUri }] });

			const child1New = vscode.Uri.joinPath(newDirUri, 'file1.txt');
			const child2New = vscode.Uri.joinPath(newDirUri, 'sub', 'file2.txt');

			assert.strictEqual(LinkManager.isLinked(child1Old), false, 'old child path no longer linked');
			assert.strictEqual(LinkManager.isLinked(child2Old), false, 'old nested child path no longer linked');
			assert.strictEqual(LinkManager.isLinked(child1New), true, 'child relinked under the new folder path');
			assert.strictEqual(
				LinkManager.isLinked(child2New),
				true,
				'nested child relinked under the new folder path',
			);
			assert.strictEqual(LinkManager.isLinked(outsideUri), true, 'unrelated link is untouched');

			const movedLink1 = LinkManager.getTemplateLink(child1New);
			assert.strictEqual(movedLink1.bodyHash, 'hash-t1', 'link data is preserved across the move');
			assert.strictEqual(
				LinkManager.getTemplateLinkFromId('t1')[0]?.uriString,
				child1New.toString(),
				'reverse index follows the move',
			);

			const movedLink2 = LinkManager.getTemplateLink(child2New);
			assert.strictEqual(movedLink2.bodyHash, 'hash-t2', 'nested link data is preserved across the move');
			assert.strictEqual(
				LinkManager.getTemplateLinkFromId('t2')[0]?.uriString,
				child2New.toString(),
				'nested reverse index follows the move',
			);
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

	suite('debounced persistence', () => {
		const makeLink = (path: string, id: string): TemplateLink => ({
			uriString: vscode.Uri.file(path).toString(),
			org: { id: 'org-1', name: 'Test Org' },
			type: 'Template',
			template: { id, name: `Template ${id}`, updatedAt: '' } as any,
			bodyHash: 'hash',
		});

		function getPersisted(): Link[] {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { context } = require('@global');
			return context.globalState.get(LinkManager.stateKey) ?? [];
		}

		test('flush() persists all pending changes in one write', async () => {
			LinkManager.addLink(makeLink('/test/d1.txt', 't1'));
			LinkManager.addLink(makeLink('/test/d2.txt', 't2'));

			await LinkManager.flush();

			assert.strictEqual(getPersisted().length, 2);
		});

		test('endBatch() resolves only after state is persisted', async () => {
			LinkManager.beginBatch();
			LinkManager.addLink(makeLink('/test/b1.txt', 't1'));
			LinkManager.addLink(makeLink('/test/b2.txt', 't2'));

			await LinkManager.endBatch();

			assert.strictEqual(getPersisted().length, 2);
		});

		test('flush() is idempotent', async () => {
			LinkManager.addLink(makeLink('/test/i1.txt', 't1'));

			await LinkManager.flush();
			await LinkManager.flush();

			assert.strictEqual(getPersisted().length, 1);
		});

		test('removeLink change is persisted on flush', async () => {
			const link = makeLink('/test/r1.txt', 't1');
			LinkManager.addLink(link);
			await LinkManager.flush();
			assert.strictEqual(getPersisted().length, 1);

			LinkManager.removeLink(link.uriString);
			await LinkManager.flush();
			assert.strictEqual(getPersisted().length, 0);
		});
	});

	suite('org index', () => {
		const org1 = { id: 'org-1', name: 'Org One' };
		const org2 = { id: 'org-2', name: 'Org Two' };

		const makeLink = (path: string, id: string, org = org1): TemplateLink => ({
			uriString: vscode.Uri.file(path).toString(),
			org,
			type: 'Template',
			template: { id, name: `Template ${id}`, updatedAt: '' } as any,
			bodyHash: 'hash',
		});

		test('getOrgLinks reflects removals', () => {
			const link1 = makeLink('/test/o1.txt', 't1');
			const link2 = makeLink('/test/o2.txt', 't2');
			LinkManager.addLink(link1);
			LinkManager.addLink(link2);
			assert.strictEqual(LinkManager.getOrgLinks(org1).length, 2);

			LinkManager.removeLink(link1.uriString);
			const remaining = LinkManager.getOrgLinks(org1);
			assert.strictEqual(remaining.length, 1);
			assert.strictEqual(remaining[0].uriString, link2.uriString);
		});

		test('getOrgLinks returns empty for unknown org', () => {
			LinkManager.addLink(makeLink('/test/o1.txt', 't1'));
			assert.strictEqual(LinkManager.getOrgLinks({ id: 'nope', name: 'Nope' }).length, 0);
		});

		test('getOrgLinks survives moveLink rename (uriString mutated before removal)', async () => {
			const oldUri = vscode.Uri.file('/test/old-name.txt').toString();
			const newUri = vscode.Uri.file('/test/new-name.txt').toString();
			LinkManager.addLink(makeLink('/test/old-name.txt', 't1'));

			LinkManager.beginBatch();
			await LinkManager.moveLink(oldUri, newUri);
			await LinkManager.endBatch();

			const links = LinkManager.getOrgLinks(org1);
			assert.strictEqual(links.length, 1, 'exactly one link should remain after rename');
			assert.strictEqual(links[0].uriString, newUri);
		});

		test('clearTemplateLinks removes template links from org index but keeps folders', () => {
			LinkManager.addLink(makeLink('/test/t1.txt', 't1'));
			LinkManager.addLink(makeLink('/test/t2.txt', 't2', org2));
			const folderLink: FolderLink = {
				uriString: vscode.Uri.file('/test/folder').toString(),
				org: org1,
				type: 'Folder',
			};
			LinkManager.addLink(folderLink);

			LinkManager.clearTemplateLinks();

			const org1Links = LinkManager.getOrgLinks(org1);
			assert.strictEqual(org1Links.length, 1);
			assert.strictEqual(org1Links[0].type, 'Folder');
			assert.strictEqual(LinkManager.getOrgLinks(org2).length, 0);
		});
	});

	suite('Template org normalization', () => {
		// A stale parent org stored on the link; the template fragment carries the
		// real sub-org. orgForTemplateLink prefers the template org, and both addLink
		// and loadLinks must index under the derived org, not the stored one.
		const staleOrg = { id: 'org-stale', name: 'Stale Parent' };
		const realOrg = { id: 'org-real', name: 'Real Sub Org' };

		const staleLink = (path: string, id: string): TemplateLink => ({
			uriString: vscode.Uri.file(path).toString(),
			org: staleOrg,
			type: 'Template',
			template: { id, name: 'T', updatedAt: '', orgId: realOrg.id, organization: realOrg } as any,
			bodyHash: 'h',
		});

		test('addLink indexes under the template-derived org, not the stale link.org', () => {
			const uri = vscode.Uri.file('/test/stale-org.j2');
			LinkManager.addLink(staleLink('/test/stale-org.j2', 't-add'));

			assert.strictEqual(LinkManager.getOrgLinks(staleOrg).length, 0, 'not indexed under the stale org');
			assert.strictEqual(LinkManager.getOrgTemplateLinks(realOrg).length, 1, 'indexed under the derived org');
			assert.strictEqual(LinkManager.getTemplateLink(uri).org.id, realOrg.id, 'stored org normalized');
		});

		test('loadLinks normalizes a persisted stale link.org', () => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { context } = require('@global');
			// Use a real file so pruneStaleLinks (fire-and-forget after load) keeps it.
			context.globalState.update(LinkManager.stateKey, [staleLink(__filename, 't-load')]);

			LinkManager.loadLinks();

			assert.strictEqual(LinkManager.getOrgLinks(staleOrg).length, 0, 'stale org not indexed');
			assert.strictEqual(LinkManager.getOrgTemplateLinks(realOrg).length, 1, 'derived org indexed');
		});
	});
});
