import { LinkManager, TemplateLink } from '@models';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as Mocha from 'mocha';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { UnlinkTemplate } from './UnlinkTemplate';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: UnlinkTemplate', () => {
	let tmpDir: string;

	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-buddy-unlink-'));
	});

	teardown(() => {
		LinkManager._resetForTesting();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeFile(name: string): vscode.Uri {
		const filePath = path.join(tmpDir, name);
		fs.writeFileSync(filePath, 'content');
		return vscode.Uri.file(filePath);
	}

	test('removes the link for the given file while leaving other links intact', async () => {
		const uri = writeFile('linked.j2');
		const otherUri = vscode.Uri.file('/test/other.j2');

		const link: TemplateLink = {
			uriString: uri.toString(),
			org: { id: 'org-1', name: 'Org' },
			type: 'Template',
			template: { id: 'tpl-1', name: 'Tpl', updatedAt: '' } as any,
			bodyHash: 'hash',
		};
		const otherLink: TemplateLink = {
			uriString: otherUri.toString(),
			org: { id: 'org-1', name: 'Org' },
			type: 'Template',
			template: { id: 'tpl-2', name: 'Tpl2', updatedAt: '' } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(link);
		LinkManager.addLink(otherLink);

		await new UnlinkTemplate().execute([uri]);

		assert.strictEqual(LinkManager.isLinked(uri), false);
		assert.strictEqual(LinkManager.isLinked(otherUri), true, 'unrelated link should remain');
	});

	test('throws when the file has no template link', async () => {
		const uri = writeFile('unlinked.j2');
		await assert.rejects(() => new UnlinkTemplate().execute([uri]), /no template link to clear/);
	});
});
