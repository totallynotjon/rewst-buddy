import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import { formatLintReport, lintWorkflow, MONOLITH_DEPTH_THRESHOLD, MONOLITH_TASK_THRESHOLD, rankDepth } from './lint';
import type { RawTask, RawWorkflow } from './types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTask(id: string, over: Partial<RawTask> = {}): RawTask {
	return { id, name: id, ...over };
}

function makeWorkflow(tasks: RawTask[], over: Partial<RawWorkflow> = {}): RawWorkflow {
	return { id: 'wf-1', name: 'Test Workflow', orgId: 'org-1', tasks, ...over };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('Unit: workflowLint', () => {
	test('clean workflow yields no findings', () => {
		const entry = makeTask('entry', {
			name: 'START',
			action: { ref: 'msgraph.x' },
			timeout: 30,
			next: [{ when: '{{ SUCCEEDED }}', do: ['terminal'] }],
		});
		const terminal = makeTask('terminal');
		const wf = makeWorkflow([entry, terminal]);
		const findings = lintWorkflow(wf);
		assert.deepStrictEqual(findings, []);
		const report = formatLintReport(wf, findings);
		assert.match(report, /No issues found/);
		assert.ok(report.includes(wf.name));
		assert.ok(report.includes(wf.id));
	});

	test('empty tasks yields no findings', () => {
		const wf = makeWorkflow([]);
		assert.deepStrictEqual(lintWorkflow(wf), []);
	});

	test('unreachable disconnected task flagged', () => {
		const entry = makeTask('entry', { name: 'START' }); // no edges to X
		const orphan = makeTask('orphan');
		const wf = makeWorkflow([entry, orphan]);
		const findings = lintWorkflow(wf);
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].rule, 'unreachable-task');
		assert.strictEqual(findings[0].taskId, 'orphan');
		// entry is never flagged
		assert.ok(!findings.some(f => f.taskId === 'entry'));
	});

	test('derives the entry task from incoming transitions when tasks are unordered', () => {
		const child = makeTask('child');
		const entry = makeTask('entry', { name: 'START', next: [{ when: '{{ SUCCEEDED }}', do: ['child'] }] });
		const wf = makeWorkflow([child, entry]);
		const findings = lintWorkflow(wf);
		assert.ok(!findings.some(f => f.rule === 'unreachable-task'), 'entry and child are reachable');
	});

	test('cycle-only island flagged unreachable', () => {
		// E is terminal (no edges); A↔B cycle, no edge from E
		const entry = makeTask('entry', { name: 'START' });
		const a = makeTask('a', { next: [{ when: '{{ SUCCEEDED }}', do: ['b'] }] });
		const b = makeTask('b', { next: [{ when: '{{ SUCCEEDED }}', do: ['a'] }] });
		const wf = makeWorkflow([entry, a, b]);
		const findings = lintWorkflow(wf);
		const unreachable = findings.filter(f => f.rule === 'unreachable-task');
		assert.ok(
			unreachable.some(f => f.taskId === 'a'),
			'a flagged unreachable',
		);
		assert.ok(
			unreachable.some(f => f.taskId === 'b'),
			'b flagged unreachable',
		);
		// rankDepth must not hang on the cycle
		const depth = rankDepth([entry, a, b]);
		assert.ok(typeof depth === 'number' && isFinite(depth));
	});

	test('success transition before custom is shadowed', () => {
		const task = makeTask('t1', {
			next: [
				{ when: '{{ SUCCEEDED }}', do: ['t2'] },
				{ when: '{{ x }}', do: ['t3'] },
			],
		});
		const t2 = makeTask('t2');
		const t3 = makeTask('t3');
		const wf = makeWorkflow([task, t2, t3]);
		const findings = lintWorkflow(wf);
		const shadowed = findings.filter(f => f.rule === 'success-transition-shadowed');
		assert.strictEqual(shadowed.length, 1);
		assert.strictEqual(shadowed[0].severity, 'error');
		assert.strictEqual(shadowed[0].taskId, 't1');
	});

	test('success transition before custom is not shadowed under FOLLOW_ALL', () => {
		const task = makeTask('t1', {
			transitionMode: 'FOLLOW_ALL',
			next: [
				{ when: '{{ SUCCEEDED }}', do: ['t2'] },
				{ when: '{{ x }}', do: ['t3'] },
			],
		});
		const t2 = makeTask('t2');
		const t3 = makeTask('t3');
		const wf = makeWorkflow([task, t2, t3]);
		const findings = lintWorkflow(wf);
		assert.ok(!findings.some(f => f.rule === 'success-transition-shadowed'));
	});

	test('custom before success is NOT shadowed', () => {
		const task = makeTask('t1', {
			next: [
				{ when: '{{ x }}', do: ['t3'] },
				{ when: '{{ SUCCEEDED }}', do: ['t2'] },
			],
		});
		const t2 = makeTask('t2');
		const t3 = makeTask('t3');
		const wf = makeWorkflow([task, t2, t3]);
		const findings = lintWorkflow(wf);
		assert.ok(!findings.some(f => f.rule === 'success-transition-shadowed'));
	});

	test('missing success/default path flagged', () => {
		const task = makeTask('t1', {
			next: [{ when: '{{ x }}', do: ['t2'] }],
		});
		const t2 = makeTask('t2');
		const wf = makeWorkflow([task, t2]);
		const findings = lintWorkflow(wf);
		const missing = findings.filter(f => f.rule === 'missing-success-transition');
		assert.strictEqual(missing.length, 1);
		assert.strictEqual(missing[0].severity, 'warning');
		assert.strictEqual(missing[0].taskId, 't1');
	});

	test('task with success transition is NOT missing-success-transition', () => {
		const task = makeTask('t1', {
			next: [{ when: '{{ SUCCEEDED }}', do: ['t2'] }],
		});
		const t2 = makeTask('t2');
		const wf = makeWorkflow([task, t2]);
		const findings = lintWorkflow(wf);
		assert.ok(!findings.some(f => f.rule === 'missing-success-transition'));
	});

	test('task with zero transitions is NOT missing-success-transition', () => {
		const task = makeTask('t1'); // no next
		const wf = makeWorkflow([task]);
		const findings = lintWorkflow(wf);
		assert.ok(!findings.some(f => f.rule === 'missing-success-transition'));
	});

	test('action task without timeout flagged', () => {
		const task = makeTask('t1', { action: { ref: 'msgraph.x' } });
		const wf = makeWorkflow([task]);
		const findings = lintWorkflow(wf);
		const noTimeout = findings.filter(f => f.rule === 'action-without-timeout');
		assert.strictEqual(noTimeout.length, 1);
		assert.strictEqual(noTimeout[0].severity, 'info');
	});

	test('action task with retry but no timeout still fires action-without-timeout', () => {
		const task = makeTask('t1', { action: { ref: 'msgraph.x' }, retry: { count: '3' } });
		const wf = makeWorkflow([task]);
		assert.ok(lintWorkflow(wf).some(f => f.rule === 'action-without-timeout'));
	});

	test('action task with timeout is NOT action-without-timeout', () => {
		const task = makeTask('t1', { action: { ref: 'msgraph.x' }, timeout: 30 });
		const wf = makeWorkflow([task]);
		assert.ok(!lintWorkflow(wf).some(f => f.rule === 'action-without-timeout'));
	});

	test('non-action task with no timeout is NOT action-without-timeout', () => {
		const task = makeTask('t1'); // no action ref, no actionId
		const wf = makeWorkflow([task]);
		assert.ok(!lintWorkflow(wf).some(f => f.rule === 'action-without-timeout'));
	});

	test('enabled mock input flagged', () => {
		const task = makeTask('t1', { isMocked: true });
		const wf = makeWorkflow([task]);
		const findings = lintWorkflow(wf);
		const mocked = findings.filter(f => f.rule === 'mock-input-enabled');
		assert.strictEqual(mocked.length, 1);
		assert.strictEqual(mocked[0].severity, 'warning');
	});

	test('isMocked false/absent is NOT mock-input-enabled', () => {
		const t1 = makeTask('t1', { isMocked: false });
		const t2 = makeTask('t2');
		const wf = makeWorkflow([t1, t2]);
		assert.ok(!lintWorkflow(wf).some(f => f.rule === 'mock-input-enabled'));
	});

	test('monolith by task count', () => {
		// Build MONOLITH_TASK_THRESHOLD tasks in a linear chain
		const tasks: RawTask[] = [];
		for (let i = 0; i < MONOLITH_TASK_THRESHOLD; i++) {
			const id = `t${i}`;
			const next = i < MONOLITH_TASK_THRESHOLD - 1 ? [{ when: '{{ SUCCEEDED }}', do: [`t${i + 1}`] }] : undefined;
			tasks.push(makeTask(id, { next }));
		}
		const wf = makeWorkflow(tasks);
		const findings = lintWorkflow(wf);
		const monolith = findings.filter(f => f.rule === 'monolith');
		assert.strictEqual(monolith.length, 1);
		assert.ok(monolith[0].message.includes(String(MONOLITH_TASK_THRESHOLD)));
	});

	test('one below monolith task threshold is NOT monolith', () => {
		const tasks: RawTask[] = [];
		for (let i = 0; i < MONOLITH_TASK_THRESHOLD - 1; i++) {
			tasks.push(makeTask(`t${i}`));
		}
		const wf = makeWorkflow(tasks);
		assert.ok(!lintWorkflow(wf).some(f => f.rule === 'monolith'));
	});

	test('monolith by depth', () => {
		// Build a linear chain of MONOLITH_DEPTH_THRESHOLD tasks
		const tasks: RawTask[] = [];
		for (let i = 0; i < MONOLITH_DEPTH_THRESHOLD; i++) {
			const id = `t${i}`;
			const next =
				i < MONOLITH_DEPTH_THRESHOLD - 1 ? [{ when: '{{ SUCCEEDED }}', do: [`t${i + 1}`] }] : undefined;
			tasks.push(makeTask(id, { next }));
		}
		const wf = makeWorkflow(tasks);
		const findings = lintWorkflow(wf);
		assert.ok(
			findings.some(f => f.rule === 'monolith'),
			'monolith finding present',
		);
	});

	test('short chain is NOT monolith', () => {
		const entry = makeTask('entry', { name: 'START', next: [{ when: '{{ SUCCEEDED }}', do: ['t1'] }] });
		const t1 = makeTask('t1');
		const wf = makeWorkflow([entry, t1]);
		assert.ok(!lintWorkflow(wf).some(f => f.rule === 'monolith'));
	});

	test('findings ordered error → warning → info', () => {
		// Create a workflow that triggers one of each severity:
		// - success-transition-shadowed (error)
		// - mock-input-enabled (warning)
		// - action-without-timeout (info)
		const task = makeTask('t1', {
			action: { ref: 'msgraph.x' }, // triggers action-without-timeout (info)
			isMocked: true, // triggers mock-input-enabled (warning)
			next: [
				{ when: '{{ SUCCEEDED }}', do: ['t2'] }, // triggers success-transition-shadowed (error)
				{ when: '{{ x }}', do: ['t3'] },
			],
		});
		const t2 = makeTask('t2');
		const t3 = makeTask('t3');
		const wf = makeWorkflow([task, t2, t3]);
		const findings = lintWorkflow(wf);
		const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
		for (let i = 1; i < findings.length; i++) {
			assert.ok(
				severityOrder[findings[i - 1].severity] <= severityOrder[findings[i].severity],
				`finding ${i - 1} (${findings[i - 1].severity}) should come before finding ${i} (${findings[i].severity})`,
			);
		}
		// Verify we have at least one of each
		assert.ok(findings.some(f => f.severity === 'error'));
		assert.ok(findings.some(f => f.severity === 'warning'));
		assert.ok(findings.some(f => f.severity === 'info'));
	});

	test('task-retry-configured flags a stored retry', () => {
		const task = makeTask('t1', { name: 'my_task', action: { ref: 'msgraph.x' }, retry: { count: '3' } });
		const wf = makeWorkflow([task]);
		const findings = lintWorkflow(wf);
		const retryFindings = findings.filter(f => f.rule === 'task-retry-configured');
		assert.strictEqual(retryFindings.length, 1);
		assert.strictEqual(retryFindings[0].severity, 'warning');
		assert.strictEqual(retryFindings[0].taskId, 't1');
		assert.ok(retryFindings[0].message.includes('my_task'));
		assert.ok(retryFindings[0].message.includes('CTX.retry|d|int'));
		assert.ok(retryFindings[0].message.includes('CTX.retry|d|int + 1'));
		assert.ok(retryFindings[0].message.includes('CTX.retry|d|int <= 3'));
	});

	test('action-without-timeout no longer mentions retry', () => {
		// action task with timeout set, no retry → no action-without-timeout
		const task = makeTask('t1', { action: { ref: 'msgraph.x' }, timeout: 5 });
		const wf = makeWorkflow([task]);
		assert.ok(!lintWorkflow(wf).some(f => f.rule === 'action-without-timeout'));
	});

	test('action task without timeout still gets info', () => {
		// action task, no timeout, no retry → one action-without-timeout info
		const task = makeTask('t1', { action: { ref: 'msgraph.x' } });
		const wf = makeWorkflow([task]);
		const findings = lintWorkflow(wf).filter(f => f.rule === 'action-without-timeout');
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].severity, 'info');
	});

	test('unlabeled-custom-transition flags custom when without label', () => {
		const task = makeTask('t1', {
			name: 'my_task',
			next: [{ when: '{{ FAILED }}', label: '', do: ['t2'] }],
		});
		const t2 = makeTask('t2');
		const wf = makeWorkflow([task, t2]);
		const findings = lintWorkflow(wf).filter(f => f.rule === 'unlabeled-custom-transition');
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].severity, 'warning');
		assert.strictEqual(findings[0].taskId, 't1');
		assert.ok(findings[0].message.includes('my_task'));
		assert.ok(findings[0].message.includes('{{ FAILED }}'));
	});

	test('success transitions never need labels', () => {
		const task = makeTask('t1', {
			next: [{ when: '{{ SUCCEEDED }}', label: '', do: ['t2'] }],
		});
		const t2 = makeTask('t2');
		const wf = makeWorkflow([task, t2]);
		assert.ok(!lintWorkflow(wf).some(f => f.rule === 'unlabeled-custom-transition'));
	});

	test('with-items-on-action flags a pack action loop', () => {
		const task = makeTask('t1', {
			name: 'my_loop',
			action: { ref: 'core.http_request' },
			with: { items: '{{ CTX.list }}' },
		});
		const wf = makeWorkflow([task]);
		const findings = lintWorkflow(wf).filter(f => f.rule === 'with-items-on-action');
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].severity, 'warning');
		assert.ok(findings[0].message.includes('core.http_request'));
	});

	test('with-items on a sub-workflow task is fine', () => {
		// task with 'with' set but action has no dot-ref (sub-workflow style)
		const task = makeTask('t1', {
			action: { id: 'wf-id' },
			with: { items: '{{ CTX.list }}' },
		});
		const wf = makeWorkflow([task]);
		assert.ok(!lintWorkflow(wf).some(f => f.rule === 'with-items-on-action'));
	});

	test('missing-start-anchor fires without a START entry', () => {
		const t1 = makeTask('t1', { name: 'first', next: [{ when: '{{ SUCCEEDED }}', do: ['t2'] }] });
		const t2 = makeTask('t2', { name: 'second' });
		const wf = makeWorkflow([t1, t2]);
		const findings = lintWorkflow(wf).filter(f => f.rule === 'missing-start-anchor');
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].severity, 'info');
		assert.strictEqual(findings[0].taskId, undefined);
	});

	test('START entry anchor satisfies the rule', () => {
		const start = makeTask('t1', { name: 'START', next: [{ when: '{{ SUCCEEDED }}', do: ['t2'] }] });
		const t2 = makeTask('t2', { name: 'second' });
		const wf = makeWorkflow([start, t2]);
		assert.ok(!lintWorkflow(wf).some(f => f.rule === 'missing-start-anchor'));
	});

	test('rankDepth is deterministic and cycle-safe', () => {
		// branching + a back-edge
		const a = makeTask('a', { next: [{ when: '{{ SUCCEEDED }}', do: ['b', 'c'] }] });
		const b = makeTask('b', { next: [{ when: '{{ SUCCEEDED }}', do: ['d'] }] });
		const c = makeTask('c', { next: [{ when: '{{ SUCCEEDED }}', do: ['d'] }] });
		const d = makeTask('d', { next: [{ when: '{{ SUCCEEDED }}', do: ['a'] }] }); // back-edge
		const tasks = [a, b, c, d];
		const depth1 = rankDepth(tasks);
		const depth2 = rankDepth(tasks);
		assert.strictEqual(depth1, depth2, 'deterministic');
		assert.ok(typeof depth1 === 'number' && isFinite(depth1), 'finite number');
	});

	test('formatLintReport groups and counts', () => {
		const task = makeTask('t1', {
			action: { ref: 'msgraph.x' },
			isMocked: true,
			next: [
				{ when: '{{ SUCCEEDED }}', do: ['t2'] },
				{ when: '{{ x }}', do: ['t3'] },
			],
		});
		const t2 = makeTask('t2');
		const t3 = makeTask('t3');
		const wf = makeWorkflow([task, t2, t3]);
		const findings = lintWorkflow(wf);
		const report = formatLintReport(wf, findings);
		// Should contain per-severity counts
		assert.ok(report.includes('error'), 'report mentions error');
		assert.ok(report.includes('warning'), 'report mentions warning');
		assert.ok(report.includes('info'), 'report mentions info');
		// Should contain one line per finding with rule id
		for (const f of findings) {
			assert.ok(report.includes(f.rule), `report includes rule ${f.rule}`);
		}
	});
});
