import { LinkManager, TemplateLink } from '@models';
import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { requireUnlinked } from './requireUnlinked';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: requireUnlinked', () => {
	setup(() => {
		initTestEnvironment();
		LinkManager._resetForTesting();
	});

	teardown(() => {
		LinkManager._resetForTesting();
	});

	test('does not throw for a file with no link', () => {
		const uri = vscode.Uri.file('/test/unlinked.j2');
		assert.doesNotThrow(() => requireUnlinked(uri));
	});

	test('throws naming the existing template and org when the file is already linked', () => {
		const uri = vscode.Uri.file('/test/linked.j2');
		const link: TemplateLink = {
			uriString: uri.toString(),
			org: { id: 'org-1', name: 'Org One' },
			type: 'Template',
			template: { id: 'tpl-1', name: 'Existing Template', updatedAt: '', orgId: 'org-1' } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(link);

		assert.throws(() => requireUnlinked(uri), /Already linked to Existing Template/);
	});
});
