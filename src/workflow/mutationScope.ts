import {
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	workflowToolAlwaysPrompts,
} from './specs';
import { asObject, str } from './types';

const WORKFLOW_MUTATION_TOOLS = new Set<string>([
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
]);

export interface WorkflowMutationScope {
	scopeId: string;
	scopeName: string;
	orgId: string;
	orgName: string;
}

export function workflowEditScope(name: string, input: unknown): WorkflowMutationScope | undefined {
	if (!WORKFLOW_MUTATION_TOOLS.has(name)) return undefined;
	const args = asObject(input);
	const workflowId = str(args.workflowId);
	const workflowName = str(args.workflowName);
	const orgId = str(args.orgId);
	const orgName = str(args.orgName);
	if (!workflowId || !workflowName || !orgId || !orgName) return undefined;
	// A section autolayout is remembered under its own approval scope: the
	// user approved re-arranging one chunk, which must not silently authorize
	// a later full-canvas re-arrange of the workflow (and vice versa).
	const section = args.section;
	const hasSection =
		name === WORKFLOW_AUTOLAYOUT_TOOL_NAME &&
		((typeof section === 'string' && section.trim() !== '') || (Array.isArray(section) && section.length > 0));
	return {
		scopeId: hasSection ? `${workflowId}::autolayout-section` : workflowId,
		scopeName: workflowName,
		orgId,
		orgName,
	};
}

export function workflowMutationAlwaysPrompts(name: string): boolean {
	return workflowToolAlwaysPrompts(name);
}
