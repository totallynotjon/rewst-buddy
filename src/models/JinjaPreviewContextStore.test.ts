/**
 * Unit tests for JinjaPreviewContextStore — globalState persistence of the
 * last-picked Jinja preview context per template id.
 *
 * Runner: mocha extension-host.
 */

import { createMockContext, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { getLastContext, saveLastContext, type JinjaPreviewContextEntry } from './JinjaPreviewContextStore';

const { suite, test, setup } = Mocha;

suite('Unit: JinjaPreviewContextStore', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('getLastContext: returns undefined when nothing saved for the template id', () => {
		const ctx = createMockContext();
		const result = getLastContext(ctx, 'tpl-unknown');
		assert.strictEqual(result, undefined);
	});

	test('saveLastContext then getLastContext: round-trips the saved context', () => {
		const ctx = createMockContext();
		const entry: JinjaPreviewContextEntry = {
			workflowId: 'wf-1',
			workflowName: 'My Workflow',
			orgId: 'org-1',
			executionId: 'exec-1',
		};

		saveLastContext(ctx, 'tpl-1', entry);
		const result = getLastContext(ctx, 'tpl-1');

		assert.deepStrictEqual(result, entry);
	});

	test('saveLastContext: overwrites only the given template id entry', () => {
		const ctx = createMockContext();
		const entry1: JinjaPreviewContextEntry = {
			workflowId: 'wf-1',
			workflowName: 'Workflow One',
			orgId: 'org-1',
			executionId: 'exec-1',
		};
		const entry2: JinjaPreviewContextEntry = {
			workflowId: 'wf-2',
			workflowName: 'Workflow Two',
			orgId: 'org-2',
			executionId: 'exec-2',
		};

		saveLastContext(ctx, 'tpl-1', entry1);
		saveLastContext(ctx, 'tpl-2', entry2);

		assert.deepStrictEqual(getLastContext(ctx, 'tpl-1'), entry1, 'tpl-1 entry should be intact');
		assert.deepStrictEqual(getLastContext(ctx, 'tpl-2'), entry2, 'tpl-2 entry should be intact');
	});

	test('saveLastContext: overwrites an existing entry for the same template id', () => {
		const ctx = createMockContext();
		const first: JinjaPreviewContextEntry = {
			workflowId: 'wf-1',
			workflowName: 'Workflow',
			orgId: 'org-1',
			executionId: 'exec-old',
		};
		const second: JinjaPreviewContextEntry = {
			workflowId: 'wf-1',
			workflowName: 'Workflow',
			orgId: 'org-1',
			executionId: 'exec-new',
		};

		saveLastContext(ctx, 'tpl-1', first);
		saveLastContext(ctx, 'tpl-1', second);

		const result = getLastContext(ctx, 'tpl-1');
		assert.strictEqual(result?.executionId, 'exec-new', 'only the latest entry should be retained');
	});
});
