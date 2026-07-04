/**
 * MCP server instructions and recipe prompts.
 *
 * `buildMcpInstructions` assembles the working-method guidance string that is
 * sent to external MCP clients in the initialize handshake.  It is built from
 * the same steering-fragment constants that are embedded verbatim in the
 * workflow tool descriptions, so the wording cannot drift between the two
 * surfaces.
 *
 * `MCP_PROMPTS` / `renderMcpPrompt` expose three recipe prompts that walk the
 * standard tool sequence for common tasks.
 */

import {
	RENDER_VERIFY_STEERING,
	WORKFLOW_COMPOSITION_STEERING,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SUMMARY_DETAIL_STEERING,
} from '@workflow';

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

/**
 * Build the instructions string sent to MCP clients on initialize.
 * Assembled from the shared steering fragments so it stays in sync with the
 * tool descriptions automatically.
 */
export function buildMcpInstructions(): string {
	return [
		'# Rewst Buddy — working method',
		'',
		'## Reading workflows',
		WORKFLOW_SUMMARY_DETAIL_STEERING,
		'',
		'## Composing workflows',
		WORKFLOW_COMPOSITION_STEERING,
		'',
		'## Verifying Jinja before and after edits',
		RENDER_VERIFY_STEERING,
		'',
		'## Run-and-check-logs loop',
		`After editing, run the workflow with ${WORKFLOW_RUN_TOOL_NAME} (wait:true),` +
			` then inspect the result with ${WORKFLOW_EXECUTION_LOGS_TOOL_NAME}.` +
			' If a task failed, read its message, input, and result before making further edits.' +
			' For sub-workflow failures, drill into the sub-execution id with a second' +
			` ${WORKFLOW_EXECUTION_LOGS_TOOL_NAME} call.`,
		'',
		'## Oversized results',
		'When a tool result is truncated, use buddy_result_read with the returned cache id' +
			' to page through the full output.',
		'',
		'## Approval',
		'Mutation tools (edit, run, autolayout) require user approval. approval_required' +
			' errors mean the user has not yet approved that scope — surface the prompt and' +
			' wait for confirmation before retrying.',
	].join('\n');
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export interface McpPromptDef {
	name: string;
	description: string;
	arguments: { name: string; description: string; required: boolean }[];
}

export const MCP_PROMPTS: McpPromptDef[] = [
	{
		name: 'debug-execution',
		description:
			'Walk the standard tool sequence for debugging a failed workflow execution: ' +
			'fetch execution logs, identify the failing task, inspect its input and result, ' +
			'and suggest a fix.',
		arguments: [
			{
				name: 'executionId',
				description: 'The workflow execution id to debug.',
				required: false,
			},
		],
	},
	{
		name: 'safe-workflow-edit',
		description:
			'Walk the standard tool sequence for safely editing a workflow: ' +
			'read summary, verify Jinja expressions, apply edits, run, and check logs.',
		arguments: [
			{
				name: 'workflowId',
				description: 'The workflow id to edit.',
				required: false,
			},
		],
	},
	{
		name: 'compose-sub-workflow',
		description:
			'Walk the standard tool sequence for extracting a reusable sub-workflow: ' +
			'identify the repeated sequence, create a new workflow with set_inputs/set_output, ' +
			'replace the inline tasks with a sub-workflow call.',
		arguments: [
			{
				name: 'goal',
				description: 'What the sub-workflow should accomplish.',
				required: false,
			},
		],
	},
];

const PROMPT_MAP = new Map(MCP_PROMPTS.map(p => [p.name, p]));

/**
 * Render one recipe prompt to a user-role message string.
 * Throws with /unknown prompt/i when the name is not defined.
 */
export function renderMcpPrompt(name: string, args: Record<string, string>): string {
	const def = PROMPT_MAP.get(name);
	if (!def) {
		throw new Error(`Unknown prompt: "${name}". Available prompts: ${[...PROMPT_MAP.keys()].join(', ')}.`);
	}

	switch (name) {
		case 'debug-execution': {
			const executionId = args['executionId'];
			const target = executionId ? `execution \`${executionId}\`` : 'the execution';
			return [
				`Debug ${target} using the following tool sequence:`,
				'',
				`1. Call \`${WORKFLOW_EXECUTION_LOGS_TOOL_NAME}\`${
					executionId ? ` with executionId "${executionId}"` : ''
				} to list all task statuses.`,
				'2. For each failed task, read its message, input, and result.',
				'3. If a task spawned a sub-execution, call ' +
					`\`${WORKFLOW_EXECUTION_LOGS_TOOL_NAME}\` again with the sub-execution id.`,
				'4. Use `buddy_render_jinja` to verify any suspect Jinja expressions against the execution context.',
				'5. Propose a targeted fix and apply it with `buddy_workflow_edit`.',
			].join('\n');
		}

		case 'safe-workflow-edit': {
			const workflowId = args['workflowId'];
			const target = workflowId ? `workflow \`${workflowId}\`` : 'the workflow';
			return [
				`Safely edit ${target} using the following tool sequence:`,
				'',
				'1. Call `buddy_workflow_get` with detail "summary" to read the current graph.',
				'2. Use `buddy_render_jinja` to verify any Jinja expressions you plan to change.',
				'3. Apply edits with `buddy_workflow_edit`.',
				`4. Run the workflow with \`${WORKFLOW_RUN_TOOL_NAME}\` (wait:true).`,
				`5. Inspect the result with \`${WORKFLOW_EXECUTION_LOGS_TOOL_NAME}\`.`,
				'6. If a task failed, read its message and result, then iterate from step 2.',
			].join('\n');
		}

		case 'compose-sub-workflow': {
			const goal = args['goal'];
			return [
				goal
					? `Compose a sub-workflow to accomplish: ${goal}`
					: 'Compose a reusable sub-workflow using the following tool sequence:',
				'',
				'1. Identify the repeated or independently testable sequence of tasks in the parent workflow.',
				'2. Create a new workflow (or use an existing one) and define its inputs with `set_inputs`.',
				'3. Define its return values with `set_output`.',
				'4. In the parent workflow, replace the inline tasks with a single sub-workflow task ' +
					'(set `subWorkflowId` to the new workflow id).',
				'5. Read the sub-workflow result in the parent as `RESULT.<publishResultAs>`.',
				`6. Run and verify with \`${WORKFLOW_RUN_TOOL_NAME}\` + \`${WORKFLOW_EXECUTION_LOGS_TOOL_NAME}\`.`,
			].join('\n');
		}

		default:
			// Should be unreachable — PROMPT_MAP.get already guards above.
			throw new Error(`Unknown prompt: "${name}".`);
	}
}
