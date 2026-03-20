import { z } from 'zod';

export const optionalOrgId = {
	orgId: z
		.string()
		.optional()
		.describe('Organization ID. Required when multiple sessions are active. Omit if only one session exists.'),
};

export const listTemplatesSchema = {
	...optionalOrgId,
};

export const getTemplateSchema = {
	templateId: z.string().describe('Template ID'),
	...optionalOrgId,
};

export const createTemplateSchema = {
	name: z.string().describe('Template name'),
	orgId: z.string().describe('Organization ID to create the template in'),
	body: z.string().describe('Template body content'),
};

export const updateTemplateBodySchema = {
	templateId: z.string().describe('Template ID'),
	body: z.string().describe('New template body content'),
	...optionalOrgId,
};

export const updateTemplateNameSchema = {
	templateId: z.string().describe('Template ID'),
	name: z.string().describe('New template name'),
	...optionalOrgId,
};

export const deleteTemplateSchema = {
	templateId: z.string().describe('Template ID to delete'),
	...optionalOrgId,
};

export const getCurrentUserSchema = {
	...optionalOrgId,
};

export const introspectSchemaInput = {
	...optionalOrgId,
};

export const executeGraphqlSchema = {
	query: z.string().describe('GraphQL query or mutation string'),
	variables: z.record(z.string(), z.unknown()).optional().describe('Variables for the GraphQL operation'),
	...optionalOrgId,
};

// Organization tools
export const searchOrgsSchema = {
	search: z.string().describe('Search string to match against organization names'),
	limit: z.number().optional().describe('Max results to return (default 25)'),
	offset: z.number().optional().describe('Number of results to skip for pagination'),
	...optionalOrgId,
};

export const getOrganizationSchema = {
	organizationId: z.string().describe('Organization ID to retrieve'),
};

// Workflow tools
export const listWorkflowsSchema = {
	name: z.string().optional().describe('Filter workflows by name (case-insensitive partial match)'),
	limit: z.number().optional().describe('Max results to return (default 25)'),
	offset: z.number().optional().describe('Number of results to skip for pagination'),
	...optionalOrgId,
};

export const getWorkflowSchema = {
	workflowId: z.string().describe('Workflow ID to retrieve'),
	...optionalOrgId,
};

// Workflow Execution tools
export const listWorkflowExecutionsSchema = {
	workflowId: z.string().optional().describe('Filter by specific workflow ID'),
	status: z.string().optional().describe('Filter by status (e.g. "completed", "failed", "running")'),
	limit: z.number().optional().describe('Max results to return (default 25)'),
	offset: z.number().optional().describe('Number of results to skip for pagination'),
	...optionalOrgId,
};

export const getWorkflowExecutionSchema = {
	executionId: z.string().describe('Workflow execution ID to retrieve'),
	...optionalOrgId,
};

export const getWorkflowExecutionContextsSchema = {
	executionId: z.string().describe('Workflow execution ID to get contexts for'),
	search: z
		.string()
		.optional()
		.describe(
			'Text to search for within context data (client-side filter). Useful for finding specific input values, org names, etc.',
		),
	...optionalOrgId,
};

export const searchTaskLogsSchema = {
	executionId: z.string().optional().describe('Scope search to a specific execution ID'),
	status: z.string().optional().describe('Filter by task status (e.g. "failed", "success")'),
	search: z
		.string()
		.optional()
		.describe(
			'Text to search for within task log input, result, and message fields (client-side filter). Solves the "find where input contained X" problem.',
		),
	limit: z.number().optional().describe('Max results to return (default 25)'),
	offset: z.number().optional().describe('Number of results to skip for pagination'),
	...optionalOrgId,
};
