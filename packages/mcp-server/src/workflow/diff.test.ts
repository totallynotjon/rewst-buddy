import { expect, test } from 'vitest';
import { diffWorkflowSnapshots, runWorkflowDiff } from './diff';

test('buddy_workflow_diff keeps array operations in deterministic order', () => {
	const first = diffWorkflowSnapshots({ tasks: ['start', 'old'] }, { tasks: ['start', 'new', 'added'] });
	const second = diffWorkflowSnapshots({ tasks: ['start', 'old'] }, { tasks: ['start', 'new', 'added'] });

	expect(first).toEqual(second);
	expect(first).toEqual([
		{ op: 'replace', path: '/tasks/1', value: 'new' },
		{ op: 'add', path: '/tasks/2', value: 'added' },
	]);
});

test('buddy_workflow_diff reports unchanged snapshots without operations', async () => {
	await expect(
		runWorkflowDiff({
			tool: 'buddy_workflow_diff',
			args: { workflowId: 'wf-1', orgId: 'org-1', original: { enabled: true }, modified: { enabled: true } },
		}),
	).resolves.toContain('No changes.');
});

test('buddy_workflow_diff caps output to valid bounded operations', async () => {
	const original = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`old-${index}`, index]));
	const output = await runWorkflowDiff({
		tool: 'buddy_workflow_diff',
		args: { workflowId: 'wf-1', orgId: 'org-1', original, modified: {} },
	});

	expect(output).toContain('capped at 500 operations');
	const json = output.match(/```json\n([\s\S]+)\n```/)?.[1];
	expect(json).toBeDefined();
	const operations = JSON.parse(json!);
	expect(operations).toHaveLength(500);
	expect(
		operations.every(
			(operation: { op?: string; path?: string }) =>
				['add', 'remove', 'replace'].includes(operation.op ?? '') && typeof operation.path === 'string',
		),
	).toBe(true);
});
