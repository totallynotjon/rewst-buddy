import { asStringArg, type ToolRequest } from '../tools/toolProtocol';

export interface WorkflowDiffOperation {
	op: 'add' | 'remove' | 'replace';
	path: string;
	value?: unknown;
}

const MAX_DIFF_OPERATIONS = 500;

function pointerSegment(value: string): string {
	return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function childPath(parent: string, segment: string): string {
	return `${parent}/${pointerSegment(segment)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseSnapshot(value: unknown, label: string): unknown {
	const parsed =
		typeof value === 'string'
			? (() => {
					try {
						return JSON.parse(value);
					} catch {
						throw new Error(`buddy_workflow_diff ${label} must be valid JSON.`);
					}
				})()
			: value;
	if (!parsed || typeof parsed !== 'object')
		throw new Error(`buddy_workflow_diff ${label} must be a JSON object or array.`);
	return parsed;
}

interface DiffResult {
	operations: WorkflowDiffOperation[];
	truncated: boolean;
}

/** Deterministic RFC-6902-style diff for workflow snapshots. */
function computeWorkflowDiff(original: unknown, modified: unknown): DiffResult {
	const operations: WorkflowDiffOperation[] = [];
	let truncated = false;
	const push = (operation: WorkflowDiffOperation): void => {
		if (operations.length >= MAX_DIFF_OPERATIONS) {
			truncated = true;
			return;
		}
		operations.push(operation);
	};
	const walk = (before: unknown, after: unknown, path: string): void => {
		if (truncated) return;
		if (Object.is(before, after)) return;
		if (Array.isArray(before) && Array.isArray(after)) {
			const shared = Math.min(before.length, after.length);
			for (let index = 0; index < shared; index++)
				walk(before[index], after[index], childPath(path, String(index)));
			for (let index = before.length - 1; index >= after.length; index--)
				push({ op: 'remove', path: childPath(path, String(index)) });
			for (let index = shared; index < after.length; index++)
				push({ op: 'add', path: childPath(path, String(index)), value: after[index] });
			return;
		}
		if (isRecord(before) && isRecord(after)) {
			for (const key of Object.keys(before).sort()) {
				if (!Object.hasOwn(after, key)) push({ op: 'remove', path: childPath(path, key) });
			}
			for (const key of Object.keys(before).sort()) {
				if (Object.hasOwn(after, key)) walk(before[key], after[key], childPath(path, key));
			}
			for (const key of Object.keys(after).sort()) {
				if (!Object.hasOwn(before, key)) push({ op: 'add', path: childPath(path, key), value: after[key] });
			}
			return;
		}
		push({ op: 'replace', path: path || '', value: after });
	};
	walk(original, modified, '');
	return { operations, truncated };
}

export function diffWorkflowSnapshots(original: unknown, modified: unknown): WorkflowDiffOperation[] {
	return computeWorkflowDiff(original, modified).operations;
}

export async function runWorkflowDiff(request: ToolRequest): Promise<string> {
	const workflowId = asStringArg(request.args, 'workflowId');
	const orgId = asStringArg(request.args, 'orgId');
	if (!workflowId || !orgId) throw new Error('buddy_workflow_diff requires "workflowId" and "orgId".');
	const original = parseSnapshot(request.args.original, 'original');
	const modified = parseSnapshot(request.args.modified, 'modified');
	const diff = computeWorkflowDiff(original, modified);
	const operations = diff.operations;
	const fromVersion = asStringArg(request.args, 'fromVersion');
	const toVersion = asStringArg(request.args, 'toVersion');
	const versionLabel = fromVersion || toVersion ? ` (${fromVersion ?? '?'} → ${toVersion ?? '?'})` : '';
	const header = `Workflow diff for "${workflowId}" (org ${orgId})${versionLabel}`;
	if (operations.length === 0) return `${header}\n\nNo changes.`;
	const capNote = diff.truncated
		? `\n\nDiff output is capped at ${MAX_DIFF_OPERATIONS} operations; additional operations were omitted. Narrow the snapshots to review the remainder.`
		: '';
	return `${header}\n\n${operations.length} change(s):${capNote}\n\n\`\`\`json\n${JSON.stringify(operations, null, 2)}\n\`\`\``;
}
