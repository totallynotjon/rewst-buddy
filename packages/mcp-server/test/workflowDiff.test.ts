import { expect, test } from 'vitest';
import { diffWorkflowSnapshots, runWorkflowDiff } from '../src/workflow/diff';

test('workflow diff is deterministic and sorts object keys', async () => {
	const original = { z: 1, nested: { keep: true, remove: 'old' } };
	const modified = { nested: { add: 'new', keep: false }, z: 1 };
	const first = diffWorkflowSnapshots(original, modified);
	const second = diffWorkflowSnapshots({ nested: { remove: 'old', keep: true }, z: 1 }, modified);

	expect(first).toEqual(second);
	expect(first).toEqual([
		{ op: 'remove', path: '/nested/remove' },
		{ op: 'replace', path: '/nested/keep', value: false },
		{ op: 'add', path: '/nested/add', value: 'new' },
	]);
});

test('workflow diff reports array edits and escapes JSON pointer segments', async () => {
	const output = await runWorkflowDiff({
		tool: 'buddy_workflow_diff',
		args: {
			workflowId: 'wf-1',
			orgId: 'org-1',
			fromVersion: 'v1',
			toVersion: 'v2',
			original: { 'a/b~c': ['one', 'two'] },
			modified: { 'a/b~c': ['one', 'three', 'four'] },
		},
	});

	expect(output).toContain('Workflow diff for "wf-1" (org org-1) (v1 → v2)');
	expect(output).toContain('"path": "/a~1b~0c/1"');
	expect(output).toContain('"op": "replace"');
	expect(output).toContain('"path": "/a~1b~0c/2"');
});

test('workflow diff accepts JSON strings and reports no changes', async () => {
	await expect(
		runWorkflowDiff({
			tool: 'buddy_workflow_diff',
			args: { workflowId: 'wf-1', orgId: 'org-1', original: '{"x":1}', modified: '{"x":1}' },
		}),
	).resolves.toContain('No changes.');
});

test('workflow diff validates required ids and snapshot JSON', async () => {
	await expect(
		runWorkflowDiff({ tool: 'buddy_workflow_diff', args: { orgId: 'org-1', original: {}, modified: {} } }),
	).rejects.toThrow(/workflowId/);
	await expect(
		runWorkflowDiff({
			tool: 'buddy_workflow_diff',
			args: { workflowId: 'wf-1', orgId: 'org-1', original: '{not-json}', modified: {} },
		}),
	).rejects.toThrow(/original.*valid JSON/i);
});

test('workflow diff caps large output without inventing a JSON pointer operation', async () => {
	const original = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`old-${index}`, index]));
	const output = await runWorkflowDiff({
		tool: 'buddy_workflow_diff',
		args: { workflowId: 'wf-1', orgId: 'org-1', original, modified: {} },
	});

	expect(output).toContain('capped at 500 operations');
	expect(output).toContain('additional operations were omitted');
	const json = output.match(/```json\n([\s\S]+)\n```/)?.[1];
	expect(json).toBeDefined();
	expect(JSON.parse(json!)).toHaveLength(500);
});
