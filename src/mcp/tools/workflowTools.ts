import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveSession } from './resolveSession';
import { listWorkflowsSchema, getWorkflowSchema } from './schemas';

const LIST_WORKFLOWS_QUERY = `
	query ListWorkflows($where: WorkflowWhereInput, $search: WorkflowSearch, $limit: Int, $offset: Int) {
		workflows(where: $where, search: $search, limit: $limit, offset: $offset) {
			id name description createdAt updatedAt humanSecondsSaved
			tags { id name }
			triggers { id name enabled triggerType { name ref } }
		}
	}
`;

const GET_WORKFLOW_QUERY = `
	query GetWorkflow($where: WorkflowWhereInput) {
		workflow(where: $where) {
			id name description createdAt updatedAt humanSecondsSaved
			inputSchema outputSchema type version timeout
			tags { id name color }
			triggers {
				id name enabled description
				triggerType { name ref }
				parameters criteria formId
			}
			tasks {
				id name description actionId
				packOverrides parameters publishedResultAs transitions
			}
			tasksObject
		}
	}
`;

export function registerWorkflowTools(server: McpServer): void {
	server.registerTool(
		'rewst_list_workflows',
		{
			title: 'List Workflows',
			description:
				'List workflows for an organization with optional name search (case-insensitive partial match). Returns summaries with: id, name, description, createdAt, updatedAt, humanSecondsSaved, tags, triggers. Use rewst_get_workflow with a workflow id for full details including tasks and schemas. Use rewst_list_workflow_executions with a workflow id to see execution history.',
			inputSchema: listWorkflowsSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ name, limit, offset, orgId }) => {
			const session = resolveSession(orgId);
			const targetOrgId = orgId ?? session.profile.org.id;

			if (!session.client) {
				throw new Error('Session has no GraphQL client available');
			}

			const variables: Record<string, unknown> = {
				where: { orgId: targetOrgId },
				limit: limit ?? 25,
				offset: offset ?? 0,
			};

			if (name) {
				variables.search = { name: { _ilike: `%${name}%` } };
			}

			const result: { workflows: Record<string, unknown>[] } = await session.client.request(
				LIST_WORKFLOWS_QUERY,
				variables,
			);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result.workflows, null, 2) }],
			};
		},
	);

	server.registerTool(
		'rewst_get_workflow',
		{
			title: 'Get Workflow',
			description:
				'Get full workflow details by ID. Returns: id, name, description, inputSchema, outputSchema, type, version, timeout, humanSecondsSaved, tags { id name color }, triggers { id name enabled description triggerType parameters criteria formId }, tasks { id name description actionId packOverrides parameters publishedResultAs transitions }, tasksObject. The tasks array defines the workflow logic. Use rewst_list_workflow_executions to see runs of this workflow.',
			inputSchema: getWorkflowSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ workflowId, orgId }) => {
			const session = resolveSession(orgId);

			if (!session.client) {
				throw new Error('Session has no GraphQL client available');
			}

			const result: { workflow: Record<string, unknown> } = await session.client.request(GET_WORKFLOW_QUERY, {
				where: { id: workflowId },
			});

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result.workflow, null, 2) }],
			};
		},
	);
}
