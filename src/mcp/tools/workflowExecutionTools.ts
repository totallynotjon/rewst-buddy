import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveSession } from './resolveSession';
import {
	listWorkflowExecutionsSchema,
	getWorkflowExecutionSchema,
	getWorkflowExecutionContextsSchema,
	searchTaskLogsSchema,
} from './schemas';

const LIST_WORKFLOW_EXECUTIONS_QUERY = `
	query ListWorkflowExecutions($where: WorkflowExecutionWhereInput, $search: WorkflowExecutionSearchInput, $limit: Int, $offset: Int) {
		workflowExecutions(where: $where, search: $search, limit: $limit, offset: $offset, order: [["createdAt", "DESC"]]) {
			id status createdAt updatedAt
			workflow { id name }
			numSuccessfulTasks numAwaitingResponseTasks
		}
	}
`;

const GET_WORKFLOW_EXECUTION_QUERY = `
	query GetWorkflowExecution($where: WorkflowExecutionWhereInput) {
		workflowExecution(where: $where) {
			id status createdAt updatedAt
			workflow { id name }
			numSuccessfulTasks numAwaitingResponseTasks
			parentExecutionId originatingExecutionId
			taskLogs {
				id status message input result executionTime
				workflowTaskId workflowTask { name }
				createdAt runAsOrgId principalOrgId
			}
		}
	}
`;

const GET_WORKFLOW_EXECUTION_CONTEXTS_QUERY = `
	query GetWorkflowExecutionContexts($workflowExecutionId: ID!) {
		workflowExecutionContexts(workflowExecutionId: $workflowExecutionId)
	}
`;

const SEARCH_TASK_LOGS_QUERY = `
	query SearchTaskLogs($where: TaskLogWhereInput, $search: TaskLogSearchInput, $limit: Int, $offset: Int) {
		taskLogs(where: $where, search: $search, limit: $limit, offset: $offset, order: [["createdAt", "DESC"]]) {
			id status message input result executionTime
			workflowTaskId workflowTask { name }
			workflowExecutionId createdAt
			runAsOrgId principalOrgId
		}
	}
`;

export function registerWorkflowExecutionTools(server: McpServer): void {
	server.registerTool(
		'rewst_list_workflow_executions',
		{
			title: 'List Workflow Executions',
			description:
				'List workflow executions with optional filters. Defaults to newest first. Returns: id, status, createdAt, updatedAt, workflow { id name }, numSuccessfulTasks, numAwaitingResponseTasks. Status values include "completed", "failed", "running". Use rewst_get_workflow_execution with an execution id for full details including task logs. Use rewst_get_workflow_execution_contexts for the data that flowed through.',
			inputSchema: listWorkflowExecutionsSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ workflowId, status, limit, offset, orgId }) => {
			const session = resolveSession(orgId);
			const targetOrgId = orgId ?? session.profile.org.id;

			if (!session.client) {
				throw new Error('Session has no GraphQL client available');
			}

			const where: Record<string, unknown> = { orgId: targetOrgId };
			if (workflowId) where.workflowId = workflowId;
			if (status) where.status = status;

			const result: { workflowExecutions: Record<string, unknown>[] } = await session.client.request(
				LIST_WORKFLOW_EXECUTIONS_QUERY,
				{
					where,
					limit: limit ?? 25,
					offset: offset ?? 0,
					order: [{ createdAt: 'DESC' }],
				},
			);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result.workflowExecutions, null, 2) }],
			};
		},
	);

	server.registerTool(
		'rewst_get_workflow_execution',
		{
			title: 'Get Workflow Execution',
			description:
				'Get full workflow execution details by ID. Returns: id, status, createdAt, updatedAt, workflow { id name }, parentExecutionId, originatingExecutionId, and taskLogs array with: id, status, message, input, result, executionTime, workflowTaskId, workflowTask { name }, createdAt, runAsOrgId, principalOrgId. Task logs contain the full input/result data for each step. Use rewst_get_workflow_execution_contexts for the execution context data.',
			inputSchema: getWorkflowExecutionSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ executionId, orgId }) => {
			const session = resolveSession(orgId);

			if (!session.client) {
				throw new Error('Session has no GraphQL client available');
			}

			const result: { workflowExecution: Record<string, unknown> } = await session.client.request(
				GET_WORKFLOW_EXECUTION_QUERY,
				{ where: { id: executionId } },
			);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result.workflowExecution, null, 2) }],
			};
		},
	);

	server.registerTool(
		'rewst_get_workflow_execution_contexts',
		{
			title: 'Get Workflow Execution Contexts',
			description:
				'Get the context data that flowed through a workflow execution — trigger data, task inputs/outputs, variables, and accumulated state. The search parameter does case-insensitive client-side filtering through the JSON context data, which is invaluable for finding specific values (emails, org names, error messages) in large execution contexts. Without search, returns all contexts.',
			inputSchema: getWorkflowExecutionContextsSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ executionId, search, orgId }) => {
			const session = resolveSession(orgId);

			if (!session.client) {
				throw new Error('Session has no GraphQL client available');
			}

			const result: { workflowExecutionContexts: unknown[] } = await session.client.request(
				GET_WORKFLOW_EXECUTION_CONTEXTS_QUERY,
				{ workflowExecutionId: executionId },
			);

			let contexts = result.workflowExecutionContexts;

			if (search) {
				const searchLower = search.toLowerCase();
				contexts = contexts.filter(ctx => JSON.stringify(ctx).toLowerCase().includes(searchLower));
			}

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(contexts, null, 2) }],
			};
		},
	);

	server.registerTool(
		'rewst_search_task_logs',
		{
			title: 'Search Task Logs',
			description:
				'Search task logs across executions with optional filters. Returns: id, status, message, input, result, executionTime, workflowTaskId, workflowTask { name }, workflowExecutionId, createdAt, runAsOrgId, principalOrgId. The search parameter does case-insensitive client-side filtering through the full JSON of each log entry (input, result, message) — solving the "find where input contained X" problem. Scope with workflowId or executionId to narrow results. Fetches 4x the limit when searching to compensate for client-side filtering.',
			inputSchema: searchTaskLogsSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ workflowId, executionId, status, search, limit, offset, orgId }) => {
			const session = resolveSession(orgId);
			const targetOrgId = orgId ?? session.profile.org.id;

			if (!session.client) {
				throw new Error('Session has no GraphQL client available');
			}

			const where: Record<string, unknown> = {};
			if (executionId) {
				where.workflowExecutionId = executionId;
			} else {
				// When no executionId, scope by org via the workflow execution's org
				where.workflowExecution = { orgId: targetOrgId };
			}
			if (workflowId) where.workflow = { id: workflowId };
			if (status) where.status = status;

			// When doing client-side search, fetch more to filter from
			const fetchLimit = search ? Math.max((limit ?? 25) * 4, 100) : (limit ?? 25);

			const result: { taskLogs: Record<string, unknown>[] } = await session.client.request(
				SEARCH_TASK_LOGS_QUERY,
				{
					where,
					limit: fetchLimit,
					offset: offset ?? 0,
					order: [{ createdAt: 'DESC' }],
				},
			);

			let logs = result.taskLogs;

			if (search) {
				const searchLower = search.toLowerCase();
				logs = logs.filter(log => JSON.stringify(log).toLowerCase().includes(searchLower));
				logs = logs.slice(0, limit ?? 25);
			}

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(logs, null, 2) }],
			};
		},
	);
}
