import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveSession } from './resolveSession';
import {
	listWorkflowExecutionsSchema,
	getWorkflowExecutionSchema,
	getWorkflowExecutionContextsSchema,
	searchTaskLogsSchema,
} from './schemas';

const LIST_WORKFLOW_EXECUTIONS_QUERY = `
	query ListWorkflowExecutions($where: WorkflowExecutionWhereInput, $search: WorkflowExecutionSearchInput, $limit: Int, $offset: Int, $order: [WorkflowExecutionOrderInput]) {
		workflowExecutions(where: $where, search: $search, limit: $limit, offset: $offset, order: $order) {
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
	query SearchTaskLogs($where: TaskLogWhereInput, $search: TaskLogSearchInput, $limit: Int, $offset: Int, $order: [TaskLogOrderInput]) {
		taskLogs(where: $where, search: $search, limit: $limit, offset: $offset, order: $order) {
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
				'List workflow executions with optional filters. Defaults to newest first. Use rewst_get_workflow_execution for full details with task logs.',
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
				'Get full workflow execution details including all task logs with their input/result data.',
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
				content: [
					{ type: 'text' as const, text: JSON.stringify(result.workflowExecution, null, 2) },
				],
			};
		},
	);

	server.registerTool(
		'rewst_get_workflow_execution_contexts',
		{
			title: 'Get Workflow Execution Contexts',
			description:
				'Get the context data that flowed through a workflow execution (trigger data, task inputs/outputs, variables). Optionally filter contexts by a search string to find specific values in the data.',
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
				'Search task logs with optional filters. The search parameter does client-side filtering through task input, result, and message JSON — solving the "find where input contained X" problem that is difficult via raw GraphQL.',
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
