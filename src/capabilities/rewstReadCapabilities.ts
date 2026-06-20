import { runReadonlyGraphql } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';

/**
 * Read-only Rewst capabilities exposed over the MCP server. Each operates on the
 * authenticated, multi-org sessions the extension already holds; the MCP server
 * runs in the extension host and receives only tool names and arguments, never
 * credentials.
 *
 * Descriptions are deliberately plain and factual: they enter an external
 * agent's context, so they avoid instruction-shaped or authority-claiming
 * wording (same discipline as the chat steering prompt).
 */

// Bounds list responses so a large org cannot flood an agent's context.
const DEFAULT_TEMPLATE_LIMIT = 200;
const DEFAULT_WORKFLOW_LIMIT = 100;
const MAX_WORKFLOW_LIMIT = 500;

function asString(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function requireString(input: Record<string, unknown>, key: string): string {
	const value = asString(input, key);
	if (!value) throw new Error(`Missing required string argument "${key}".`);
	return value;
}

function asPositiveInt(input: Record<string, unknown>, key: string): number | undefined {
	const value = input[key];
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
	return Math.floor(value);
}

const ORG_ID_PROP = {
	orgId: { type: 'string', description: 'Rewst organization id the operation runs against (from list_orgs).' },
} as const;

/** Lists every org reachable through the active sessions; needs no org id. */
const listOrgsSpec: ToolSpec = {
	name: 'list_orgs',
	args: '{}',
	description:
		'List the Rewst organizations reachable through the signed-in VS Code sessions, with their ids and names. Call this first to learn which orgId to pass to the other tools.',
	inputSchema: { type: 'object', properties: {} },
};

const listTemplatesSpec: ToolSpec = {
	name: 'list_templates',
	args: '{"orgId": string}',
	description: 'List the templates in one Rewst organization (id and name). Use get_template for a full body.',
	inputSchema: { type: 'object', properties: { ...ORG_ID_PROP }, required: ['orgId'] },
};

const getTemplateSpec: ToolSpec = {
	name: 'get_template',
	args: '{"orgId": string, "templateId": string}',
	description: 'Get one Rewst template, including its body, by org and template id.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			templateId: { type: 'string', description: 'Template id to fetch.' },
		},
		required: ['orgId', 'templateId'],
	},
};

const listWorkflowsSpec: ToolSpec = {
	name: 'list_workflows',
	args: '{"orgId": string, "search"?: string, "limit"?: number}',
	description:
		'List workflows in one Rewst organization (id, name, description). Optionally filter by a name search and cap the count.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			search: { type: 'string', description: 'Optional case-insensitive name filter.' },
			limit: { type: 'number', description: `Max workflows to return (default ${DEFAULT_WORKFLOW_LIMIT}).` },
		},
		required: ['orgId'],
	},
};

const getWorkflowSpec: ToolSpec = {
	name: 'get_workflow',
	args: '{"orgId": string, "workflowId": string}',
	description: 'Get one Rewst workflow (metadata and triggers) by org and workflow id.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			workflowId: { type: 'string', description: 'Workflow id to fetch.' },
		},
		required: ['orgId', 'workflowId'],
	},
};

const graphqlQuerySpec: ToolSpec = {
	name: 'rewst_graphql_query',
	args: '{"orgId": string, "query": string, "variables"?: object}',
	description:
		"Run a read-only GraphQL query against one Rewst organization with the user's session. Only query operations are allowed; mutations and subscriptions are rejected. Use this for data the dedicated read tools do not cover (executions, integrations, variables, and so on).",
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			query: { type: 'string', description: 'GraphQL query document (no mutations or subscriptions).' },
			variables: { type: 'object', description: 'Optional GraphQL variables.' },
		},
		required: ['orgId', 'query'],
	},
};

// GraphQL for workflow reads: the typed SDK has no workflow operations, so these
// use the session's rawGraphql against the documented schema fields.
const VISIBLE_WORKFLOWS_QUERY = `query RewstBuddyMcpWorkflows($orgId: ID!, $limit: Int, $search: WorkflowSearch) {
	visibleWorkflows(orgId: $orgId, limit: $limit, search: $search) {
		id
		name
		description
		orgId
		createdAt
		updatedAt
	}
}`;

const WORKFLOW_QUERY = `query RewstBuddyMcpWorkflow($id: ID!) {
	workflow(where: { id: $id }) {
		id
		name
		description
		orgId
		createdAt
		updatedAt
		triggers {
			id
			name
		}
	}
}`;

async function runListOrgs(_input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgs = new Map<string, string>();
	for (const session of ctx.sessions) {
		for (const org of session.profile.allManagedOrgs) {
			if (org.id) orgs.set(org.id, org.name);
		}
	}
	if (orgs.size === 0) return 'No organizations are available. Sign in to Rewst in VS Code first.';
	const lines = [...orgs.entries()].map(([id, name]) => `${name} (${id})`).sort();
	return lines.join('\n');
}

async function runListTemplates(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const response = await ctx.session.sdk?.listTemplates({ orgId });
	const templates = response?.templates ?? [];
	if (templates.length === 0) return 'No templates found for this organization.';
	const capped = templates.slice(0, DEFAULT_TEMPLATE_LIMIT);
	const lines = capped.map(template => `${template?.name ?? '(unnamed)'} (${template?.id})`);
	if (templates.length > capped.length) {
		lines.push(`…(${templates.length - capped.length} more not shown; refine in Rewst or use rewst_graphql_query)`);
	}
	return lines.join('\n');
}

async function runGetTemplate(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const templateId = requireString(input, 'templateId');
	const template = await ctx.session.getTemplate(templateId);
	// A session can manage several orgs, so a bare id lookup can cross org
	// boundaries; enforce the requested orgId against the returned resource.
	const templateOrgId = (template as { orgId?: unknown }).orgId;
	if (typeof templateOrgId === 'string' && templateOrgId !== orgId) {
		throw new Error(`Template ${templateId} is not in org ${orgId}.`);
	}
	return JSON.stringify(template, null, 2);
}

async function runListWorkflows(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const search = asString(input, 'search');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_WORKFLOW_LIMIT, MAX_WORKFLOW_LIMIT);
	const variables: Record<string, unknown> = { orgId, limit };
	if (search) variables.search = { name: search };
	const { data, errors } = await ctx.session.rawGraphql(VISIBLE_WORKFLOWS_QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const workflows = ((data as { visibleWorkflows?: unknown[] } | undefined)?.visibleWorkflows ?? []) as {
		id?: string;
		name?: string;
		description?: string;
	}[];
	if (workflows.length === 0) return 'No workflows found for this organization.';
	return workflows
		.map(
			workflow =>
				`${workflow.name ?? '(unnamed)'} (${workflow.id})${workflow.description ? ` — ${workflow.description}` : ''}`,
		)
		.join('\n');
}

async function runGetWorkflow(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const workflowId = requireString(input, 'workflowId');
	const { data, errors } = await ctx.session.rawGraphql(WORKFLOW_QUERY, { id: workflowId });
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const workflow = (data as { workflow?: { orgId?: unknown } } | undefined)?.workflow;
	if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
	// workflow(where:{id}) ignores org, so enforce the requested orgId here.
	if (typeof workflow.orgId === 'string' && workflow.orgId !== orgId) {
		throw new Error(`Workflow ${workflowId} is not in org ${orgId}.`);
	}
	return JSON.stringify(workflow, null, 2);
}

async function runGraphqlQuery(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	requireString(input, 'orgId');
	const query = requireString(input, 'query');
	const rawVariables = input.variables;
	if (
		rawVariables !== undefined &&
		(typeof rawVariables !== 'object' || rawVariables === null || Array.isArray(rawVariables))
	) {
		throw new Error('"variables" must be a JSON object when provided.');
	}
	return runReadonlyGraphql(query, rawVariables as Record<string, unknown> | undefined, (q, v) =>
		ctx.session.rawGraphql(q, v),
	);
}

export const READ_CAPABILITIES: Capability[] = [
	{
		spec: listOrgsSpec,
		access: 'read',
		chat: false,
		mcp: true,
		requiresOrg: false,
		enabled: () => true,
		run: runListOrgs,
	},
	{ spec: listTemplatesSpec, access: 'read', chat: false, mcp: true, enabled: () => true, run: runListTemplates },
	{ spec: getTemplateSpec, access: 'read', chat: false, mcp: true, enabled: () => true, run: runGetTemplate },
	{ spec: listWorkflowsSpec, access: 'read', chat: false, mcp: true, enabled: () => true, run: runListWorkflows },
	{ spec: getWorkflowSpec, access: 'read', chat: false, mcp: true, enabled: () => true, run: runGetWorkflow },
	{
		spec: graphqlQuerySpec,
		access: 'read',
		chat: false,
		mcp: true,
		enabled: settings => settings.enableGraphqlTool,
		run: runGraphqlQuery,
	},
];
