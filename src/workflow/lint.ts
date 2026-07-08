import { isSuccessCondition, type RawTask, type RawWorkflow } from './types';

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintFinding {
	rule: string;
	severity: LintSeverity;
	taskId?: string;
	taskName?: string;
	message: string;
}

export const MONOLITH_TASK_THRESHOLD = 20;
export const MONOLITH_DEPTH_THRESHOLD = 12;

/**
 * Compute the longest forward-path depth (number of ranks) in the task graph.
 * Cycle-safe: back-edges (edges to nodes on the current DFS stack) are excluded.
 * Returns 0 for an empty task list.
 */
export function rankDepth(tasks: RawTask[]): number {
	if (tasks.length === 0) return 0;

	// Build forward-edge adjacency from task.next[].do[]
	const taskIds = new Set(tasks.map(t => t.id));
	const adj = new Map<string, string[]>();
	for (const task of tasks) {
		const targets: string[] = [];
		for (const tr of task.next ?? []) {
			for (const targetId of tr.do ?? []) {
				if (taskIds.has(targetId)) {
					targets.push(targetId);
				}
			}
		}
		adj.set(task.id, targets);
	}

	// Topological relaxation with cycle detection via DFS stack
	// dist[id] = longest path length to reach id
	const dist = new Map<string, number>();
	const visited = new Set<string>();
	const onStack = new Set<string>();

	function dfs(id: string): number {
		if (onStack.has(id)) return 0; // back-edge: skip to break cycle
		if (visited.has(id)) return dist.get(id) ?? 0;
		onStack.add(id);
		let maxChild = -1;
		for (const neighbor of adj.get(id) ?? []) {
			const d = dfs(neighbor);
			if (d > maxChild) maxChild = d;
		}
		onStack.delete(id);
		visited.add(id);
		const myDist = maxChild < 0 ? 0 : maxChild + 1;
		dist.set(id, myDist);
		return myDist;
	}

	let max = 0;
	for (const task of tasks) {
		const d = dfs(task.id);
		if (d > max) max = d;
	}
	return max + 1; // rank count = longest path length + 1
}

/**
 * Audit a workflow's structure and return a list of findings.
 * Ordered: error → warning → info; within a group, per-task findings in task order,
 * workflow-level monolith finding last.
 */
export function lintWorkflow(workflow: RawWorkflow): LintFinding[] {
	const tasks = workflow.tasks ?? [];
	if (tasks.length === 0) return [];

	const errors: LintFinding[] = [];
	const warnings: LintFinding[] = [];
	const infos: LintFinding[] = [];

	// Build reachability set via BFS from the task with no incoming transition.
	const taskById = new Map(tasks.map(t => [t.id, t]));
	const incoming = new Set<string>();
	for (const task of tasks) {
		for (const tr of task.next ?? []) {
			for (const targetId of tr.do ?? []) {
				if (taskById.has(targetId)) incoming.add(targetId);
			}
		}
	}
	const reachable = new Set<string>();
	const entryId = tasks.find(t => !incoming.has(t.id))?.id ?? tasks[0].id;
	reachable.add(entryId);
	const queue = [entryId];
	let head = 0;
	while (head < queue.length) {
		const current = queue[head++];
		const task = taskById.get(current);
		for (const tr of task?.next ?? []) {
			for (const targetId of tr.do ?? []) {
				if (taskById.has(targetId) && !reachable.has(targetId)) {
					reachable.add(targetId);
					queue.push(targetId);
				}
			}
		}
	}

	for (const task of tasks) {
		// unreachable-task: not reachable from entry (entry itself is never flagged)
		if (task.id !== entryId && !reachable.has(task.id)) {
			warnings.push({
				rule: 'unreachable-task',
				severity: 'warning',
				taskId: task.id,
				taskName: task.name,
				message: `Task "${task.name}" (${task.id}) is not reachable from the workflow entry.`,
			});
		}

		// success-transition-shadowed: a success/default transition appears before a custom one
		const next = task.next ?? [];
		if ((task.transitionMode ?? 'FOLLOW_FIRST') === 'FOLLOW_FIRST') {
			for (let i = 0; i < next.length; i++) {
				if (isSuccessCondition(next[i].when)) {
					// Check if any later transition is custom (non-success)
					for (let j = i + 1; j < next.length; j++) {
						if (!isSuccessCondition(next[j].when)) {
							errors.push({
								rule: 'success-transition-shadowed',
								severity: 'error',
								taskId: task.id,
								taskName: task.name,
								message: `Task "${task.name}" (${task.id}) has a success/default transition at position ${i} that shadows a custom condition at position ${j}. Reorder so custom conditions come first.`,
							});
							break; // one finding per task
						}
					}
					break; // found first success transition, done checking this task
				}
			}
		}

		// missing-success-transition: has transitions but none is success/default
		if (next.length > 0 && !next.some(tr => isSuccessCondition(tr.when))) {
			warnings.push({
				rule: 'missing-success-transition',
				severity: 'warning',
				taskId: task.id,
				taskName: task.name,
				message: `Task "${task.name}" (${task.id}) has outgoing transitions but no success/default path. It may get stuck if no condition matches.`,
			});
		}

		// task-retry-configured: task-level retry is engine-breaking
		if (task.retry != null) {
			warnings.push({
				rule: 'task-retry-configured',
				severity: 'warning',
				taskId: task.id,
				taskName: task.name,
				message: `Task "${task.name}" (${task.id}) has a task-level retry config; the Rewst engine can fail to initialize such a task. Replace it with a loop: a sub-workflow wrapper with a delay task on the failure path.`,
			});
		}

		// unlabeled-custom-transition: custom transition with no label
		for (const tr of next) {
			if (!isSuccessCondition(tr.when) && (tr.label == null || tr.label.trim() === '')) {
				warnings.push({
					rule: 'unlabeled-custom-transition',
					severity: 'warning',
					taskId: task.id,
					taskName: task.name,
					message: `Task "${task.name}" (${task.id}) has a custom transition (when: ${tr.when}) with no label. Custom transitions need a label naming the branch.`,
				});
			}
		}

		// with-items-on-action: with-items loop directly on a pack action
		if (task.with != null && typeof task.action?.ref === 'string' && task.action.ref.includes('.')) {
			warnings.push({
				rule: 'with-items-on-action',
				severity: 'warning',
				taskId: task.id,
				taskName: task.name,
				message: `Task "${task.name}" (${task.id}) runs a with-items loop directly on action ${task.action.ref}. Wrap the action in a sub-workflow and loop over the wrapper so each item can fail, retry, and log individually.`,
			});
		}

		// action-without-timeout: pack-action task with no timeout
		if ((task.action?.ref || task.actionId) && task.timeout == null) {
			infos.push({
				rule: 'action-without-timeout',
				severity: 'info',
				taskId: task.id,
				taskName: task.name,
				message: `Task "${task.name}" (${task.id}) is an action task with no timeout configured. Consider adding one so a hung call cannot stall the run.`,
			});
		}

		// mock-input-enabled
		if (task.isMocked === true) {
			warnings.push({
				rule: 'mock-input-enabled',
				severity: 'warning',
				taskId: task.id,
				taskName: task.name,
				message: `Task "${task.name}" (${task.id}) has mock input enabled. Disable mocking before using this workflow in production.`,
			});
		}
	}

	// missing-start-anchor: workflow-level, no taskId
	// Entry candidates = tasks with zero inbound edges (same set used for BFS above)
	const entryCandidates = tasks.filter(t => !incoming.has(t.id));
	const hasStartAnchor = entryCandidates.some(t => t.name.trim().toUpperCase() === 'START');
	if (!hasStartAnchor) {
		infos.push({
			rule: 'missing-start-anchor',
			severity: 'info',
			message:
				'Workflow has no "START" entry anchor. Convention: begin with a core.noop task named "START" with no inbound transitions and a single success transition to the first real action.',
		});
	}

	// monolith: workflow-level finding (no taskId)
	const depth = rankDepth(tasks);
	if (tasks.length >= MONOLITH_TASK_THRESHOLD || depth >= MONOLITH_DEPTH_THRESHOLD) {
		infos.push({
			rule: 'monolith',
			severity: 'info',
			message: `Workflow has ${tasks.length} task(s) and a dependency-chain depth of ${depth}. Consider extracting sub-workflows to improve maintainability (threshold: ${MONOLITH_TASK_THRESHOLD} tasks or depth ${MONOLITH_DEPTH_THRESHOLD}).`,
		});
	}

	return [...errors, ...warnings, ...infos];
}

/**
 * Format a lint report as a human-readable string.
 */
export function formatLintReport(workflow: RawWorkflow, findings: LintFinding[]): string {
	if (findings.length === 0) {
		return `No issues found in workflow "${workflow.name}" (${workflow.id}).`;
	}

	const errorCount = findings.filter(f => f.severity === 'error').length;
	const warningCount = findings.filter(f => f.severity === 'warning').length;
	const infoCount = findings.filter(f => f.severity === 'info').length;

	const parts: string[] = [
		`Workflow "${workflow.name}" (${workflow.id}) — ${findings.length} issue(s): ${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info(s).`,
	];
	for (const f of findings) {
		parts.push(`[${f.severity.toUpperCase()}] ${f.rule}: ${f.message}`);
	}
	return parts.join('\n');
}
