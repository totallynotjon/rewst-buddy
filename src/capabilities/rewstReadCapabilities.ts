import { runReadonlyGraphql } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import {
	asPositiveInt,
	asString,
	mapWithConcurrency,
	ORG_ID_PROP,
	rawGraphqlOrThrow,
	requireString,
} from './inputHelpers';

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
const DEFAULT_REFERENCE_LIMIT = 25;
const DEFAULT_ORG_VARIABLE_LIMIT = 50;
const DEFAULT_ACTION_LIMIT = 25;
const DEFAULT_EXECUTION_LIMIT = 25;
const DEFAULT_TASK_LIMIT = 100;
const DEFAULT_PATCH_LIMIT = 25;
const MAX_WORKFLOW_LIMIT = 500;
const MAX_REFERENCE_LIMIT = 100;
const MAX_ORG_VARIABLE_LIMIT = 200;
const MAX_ACTION_LIMIT = 100;
const MAX_EXECUTION_LIMIT = 100;
const MAX_TASK_LIMIT = 500;
const MAX_PATCH_LIMIT = 100;

const LOCAL_REFERENCE_MODELS = [
	'Crate',
	'CustomDatabase',
	'Organization',
	'PackConfig',
	'Role',
	'Template',
	'TemplateExport',
	'User',
	'Workflow',
	'Trigger',
	'Form',
	'Site',
	'Page',
] as const;

/** Lists every org reachable through the active sessions; needs no org id. */
const listOrgsSpec: ToolSpec = {
	name: 'buddy_list_orgs',
	args: '{}',
	description:
		'List the Rewst organizations reachable through the signed-in VS Code sessions, with their ids and names. Call this first to learn which orgId to pass to the other tools.',
	inputSchema: { type: 'object', properties: {} },
};

const listTemplatesSpec: ToolSpec = {
	name: 'buddy_list_templates',
	args: '{"orgId": string}',
	description: 'List the templates in one Rewst organization (id and name). Use buddy_get_template for a full body.',
	inputSchema: { type: 'object', properties: { ...ORG_ID_PROP }, required: ['orgId'] },
};

const getTemplateSpec: ToolSpec = {
	name: 'buddy_get_template',
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
	name: 'buddy_list_workflows',
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

const listOrgVariablesSpec: ToolSpec = {
	name: 'buddy_list_org_variables',
	args: '{"orgId": string, "search"?: string, "limit"?: number}',
	description:
		'List configuration variables for one Rewst organization (name, value, category, cascade). Secret-category values are returned masked. Optionally filter by a case-insensitive name substring.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			search: { type: 'string', description: 'Optional case-insensitive name substring filter.' },
			limit: {
				type: 'number',
				description: `Max variables to return (default ${DEFAULT_ORG_VARIABLE_LIMIT}, max ${MAX_ORG_VARIABLE_LIMIT}).`,
			},
		},
		required: ['orgId'],
	},
};

const listWorkflowExecutionsSpec: ToolSpec = {
	name: 'buddy_list_workflow_executions',
	args: '{"orgId": string, "status"?: string, "limit"?: number}',
	description:
		'List recent workflow executions for one Rewst organization (id, status, workflowId, createdAt, numSuccessfulTasks), newest first. Optionally filter by an exact status (e.g. succeeded, failed, running). createdAt is an epoch-millisecond string.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			status: { type: 'string', description: 'Optional exact execution status filter.' },
			limit: {
				type: 'number',
				description: `Max executions to return (default ${DEFAULT_EXECUTION_LIMIT}, max ${MAX_EXECUTION_LIMIT}).`,
			},
		},
		required: ['orgId'],
	},
};

const findExecutionsByVariableSpec: ToolSpec = {
	name: 'buddy_find_executions_by_variable',
	args: '{"orgId": string, "workflowId": string, "name": string, "kind"?: "input"|"output"|"context", "value"?: string, "limit"?: number}',
	description:
		"Find executions of ONE Rewst workflow whose input, output, or context variable matches a name (and optionally a value). Scans the most-recently-created executions of the given workflow and filters client-side. kind selects which variable surface to search: input (the values the run was started with), output (the values it produced — absent until a run completes), or context (the run's CTX). name is matched case-insensitively as a substring against variable names; pass value to also require the variable's value to contain that text. Returns one line per matching execution with its id, status, created time, and the matched variable(s). Both orgId and workflowId are required — there is no way to search executions across a whole org by variable, and kind=context issues one extra request per scanned execution.",
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			workflowId: { type: 'string', description: 'The workflow whose executions to scan.' },
			name: { type: 'string', description: 'Case-insensitive substring matched against variable names.' },
			kind: {
				type: 'string',
				enum: ['input', 'output', 'context'],
				description: "Which variable surface to search: input (default), output, or context (the run's CTX).",
			},
			value: {
				type: 'string',
				description: "Optional case-insensitive substring the matched variable's value must contain.",
			},
			limit: {
				type: 'number',
				description: `Max executions to scan, most-recent first (default ${DEFAULT_EXECUTION_LIMIT}, max ${MAX_EXECUTION_LIMIT}). For kind=context this is also the number of extra context requests issued.`,
			},
		},
		required: ['orgId', 'workflowId', 'name'],
	},
};

const listWorkflowTasksSpec: ToolSpec = {
	name: 'buddy_list_workflow_tasks',
	args: '{"orgId": string, "workflowId": string, "limit"?: number}',
	description:
		'List the tasks (steps) in one Rewst workflow (id, name, actionId, mocked marker only when a task is mocked, timeout, description). Task ids are dash-less hex strings.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			workflowId: { type: 'string', description: 'Workflow id whose tasks to list.' },
			limit: {
				type: 'number',
				description: `Max tasks to return (default ${DEFAULT_TASK_LIMIT}, max ${MAX_TASK_LIMIT}).`,
			},
		},
		required: ['orgId', 'workflowId'],
	},
};

const listWorkflowPatchesSpec: ToolSpec = {
	name: 'buddy_list_workflow_patches',
	args: '{"orgId": string, "workflowId": string, "limit"?: number}',
	description:
		'List the revision history (patch metadata) for one Rewst workflow, newest first (id, patchType, comment, createdAt). Use buddy_get_workflow_patch with a patch id to see the actual change. createdAt is an epoch-millisecond string.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			workflowId: { type: 'string', description: 'Workflow id whose patch history to list.' },
			limit: {
				type: 'number',
				description: `Max patches to return (default ${DEFAULT_PATCH_LIMIT}, max ${MAX_PATCH_LIMIT}).`,
			},
		},
		required: ['orgId', 'workflowId'],
	},
};

const getWorkflowPatchSpec: ToolSpec = {
	name: 'buddy_get_workflow_patch',
	args: '{"orgId": string, "patchId": string}',
	description:
		'Get one Rewst workflow patch by id, including `patch` — the actual change as an RFC-6902 JSON Patch array. Pair with buddy_list_workflow_patches to find a patch id.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			patchId: { type: 'string', description: 'Workflow patch id to fetch.' },
		},
		required: ['orgId', 'patchId'],
	},
};

const latestWorkflowExecutionSpec: ToolSpec = {
	name: 'buddy_latest_workflow_execution',
	args: '{"orgId": string, "workflowId": string, "status"?: string}',
	description:
		'Get the most recent execution of one workflow in a Rewst organization (id, status, createdAt, task counts). Optionally constrain to a specific status.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			workflowId: { type: 'string', description: 'Workflow id to inspect.' },
			status: { type: 'string', description: 'Optional exact execution status constraint.' },
		},
		required: ['orgId', 'workflowId'],
	},
};

const getWorkflowExecutionStatsSpec: ToolSpec = {
	name: 'buddy_get_workflow_execution_stats',
	args: '{"orgId": string, "createdSince": string}',
	description:
		'Get aggregate workflow-execution status counts for one Rewst organization since a date (succeeded, failed, running, pending, paused, delayed, humanSecondsSaved). createdSince must be an ISO-8601 date string (e.g. 2025-01-01 or 2025-01-01T00:00:00Z) — epoch milliseconds are rejected.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			createdSince: {
				type: 'string',
				description: 'ISO-8601 date string such as 2025-01-01 or 2025-01-01T00:00:00Z.',
			},
		},
		required: ['orgId', 'createdSince'],
	},
};

const findActionSpec: ToolSpec = {
	name: 'buddy_find_action',
	args: '{"orgId": string, "filter"?: string, "limit"?: number}',
	description:
		"Search the actions available in one Rewst organization's installed packs. The filter is matched case-insensitively against each action's display name. Returns one line per match — `<ref> (<id>) — <pack>: <description>` — where `<id>` is the action id and `<ref>` is its callable reference; rows with no ref (workflow-as-action entries) show the action name in place of the ref. Capped to `limit`; omitting the filter returns many results, so prefer a filter. For the platform-wide action catalog rather than this org's installed packs, use buddy_action_search.",
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			filter: {
				type: 'string',
				description: "Optional text matched case-insensitively against the action's display name.",
			},
			limit: {
				type: 'number',
				description: `Max flattened actions to return (default ${DEFAULT_ACTION_LIMIT}, max ${MAX_ACTION_LIMIT}).`,
			},
		},
		required: ['orgId'],
	},
};

const resolveReferenceSpec: ToolSpec = {
	name: 'buddy_resolve_reference',
	args: '{"orgId": string, "modelType": string, "search"?: string, "limit"?: number}',
	description:
		'Resolve Rewst object names to ids for one organization and a model type (Workflow, Template, Trigger, Form, Organization, User, Role, PackConfig, Site, Page, Crate, CustomDatabase, TemplateExport). Optionally filter by a case-insensitive name substring. Returns matching options as name (id). Use this when you have a name and need the id.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			modelType: {
				type: 'string',
				enum: LOCAL_REFERENCE_MODELS,
				description: 'Which kind of Rewst object to resolve.',
			},
			search: { type: 'string', description: 'Optional case-insensitive name substring filter.' },
			limit: {
				type: 'number',
				description: `Max references to return (default ${DEFAULT_REFERENCE_LIMIT}, max ${MAX_REFERENCE_LIMIT}).`,
			},
		},
		required: ['orgId', 'modelType'],
	},
};

const getWorkflowSpec: ToolSpec = {
	name: 'buddy_get_workflow',
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
	name: 'buddy_graphql_query',
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
/** Lists workflows for one org through the working workflows query. */
const WORKFLOWS_QUERY = `query RewstBuddyMcpWorkflows($orgId: ID!, $limit: Int, $search: WorkflowSearch) {
  workflows(where: { orgId: $orgId }, search: $search, limit: $limit, order: [["updatedAt", "DESC"]]) {
    id
    name
    description
    orgId
    createdAt
    updatedAt
  }
}`;

const ORG_VARIABLES_QUERY = `query RewstBuddyMcpOrgVariables($orgId: ID!, $search: OrgVariableSearchInput, $limit: Int) {
  orgVariables(where: { orgId: $orgId }, search: $search, maskSecrets: true, limit: $limit, order: [["name", "asc"]]) {
    name
    value
    category
    cascade
  }
}`;

const WORKFLOW_EXECUTIONS_QUERY = `query RewstBuddyMcpWorkflowExecutions($orgId: ID!, $search: WorkflowExecutionSearchInput, $limit: Int) {
  workflowExecutions(where: { orgId: $orgId }, search: $search, order: [["createdAt", "DESC"]], limit: $limit) {
    id
    status
    createdAt
    workflow {
      id
    }
    numSuccessfulTasks
  }
}`;

const EXECUTIONS_WITH_IO_QUERY = `query RewstBuddyMcpExecutionsWithIO($orgId: ID!, $workflowId: ID!, $limit: Int) {
  workflowExecutions(where: { orgId: $orgId, workflowId: $workflowId }, order: [["createdAt", "DESC"]], limit: $limit) {
    id
    status
    createdAt
    numSuccessfulTasks
    conductor {
      input
      output
    }
  }
}`;

const EXECUTION_CONTEXTS_QUERY = `query RewstBuddyMcpExecutionContexts($workflowExecutionId: ID!) {
  workflowExecutionContexts(workflowExecutionId: $workflowExecutionId)
}`;

const WORKFLOW_TASKS_QUERY = `query RewstBuddyMcpWorkflowTasks($workflowId: ID!, $limit: Int) {
  workflowTasks(where: { workflowId: $workflowId }, limit: $limit, order: [["name", "ASC"]]) {
    id
    name
    actionId
    workflowId
    isMocked
    timeout
    description
  }
}`;

const WORKFLOW_PATCHES_QUERY = `query RewstBuddyMcpWorkflowPatches($workflowId: ID!, $limit: Int) {
  workflowPatches(where: { workflowId: $workflowId }, orderBy: createdAt_DESC, limit: $limit) {
    id
    patchType
    comment
    commentDescription
    workflowId
    createdAt
  }
}`;

const WORKFLOW_PATCH_QUERY = `query RewstBuddyMcpWorkflowPatch($id: ID!) {
  workflowPatch(id: $id) {
    id
    patchType
    patch
    comment
    commentDescription
    workflowId
    createdAt
  }
}`;

const LATEST_WORKFLOW_EXECUTION_QUERY = `query RewstBuddyMcpLatestWorkflowExecution($orgId: ID!, $workflowId: ID!, $status: String) {
  latestWorkflowExecution(workflowId: $workflowId, orgId: $orgId, status: $status) {
    id
    status
    createdAt
    numSuccessfulTasks
    numAwaitingResponseTasks
  }
}`;

const WORKFLOW_EXECUTION_STATS_QUERY = `query RewstBuddyMcpWorkflowExecutionStats($orgId: ID!, $createdSince: String!) {
  workflowExecutionStats(orgId: $orgId, createdSince: $createdSince) {
    succeeded
    failed
    running
    pending
    paused
    delayed
    humanSecondsSaved
  }
}`;

const FIND_ACTION_QUERY = `query RewstBuddyMcpFindAction($orgId: ID!, $filter: String) {
  searchInstalledPackActions(orgId: $orgId, actionFilter: $filter) {
    id
    name
    ref
    actions {
      id
      name
      ref
      description
    }
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

const RESOLVE_REFERENCE_QUERY = `query RewstBuddyMcpResolveReference($orgId: ID!, $modelName: LocalReferenceModel!, $search: String, $limit: Int) {
  localReferenceOptions(modelName: $modelName, orgId: $orgId, search: $search, limit: $limit) {
    label
    value
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
		lines.push(`…(${templates.length - capped.length} more not shown; refine in Rewst or use buddy_graphql_query)`);
	}
	return lines.join('\n');
}

async function runGetTemplate(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const templateId = requireString(input, 'templateId');
	const template = await ctx.session.getTemplate(templateId);
	// A session can manage several orgs, so a bare id lookup can cross org
	// boundaries; enforce the requested orgId against the returned resource.
	// Fail closed: reject when orgId is absent as well as when it mismatches.
	const templateOrgId = (template as { orgId?: unknown }).orgId;
	if (typeof templateOrgId !== 'string' || templateOrgId !== orgId) {
		throw new Error(`Template ${templateId} is not in org ${orgId}.`);
	}
	return JSON.stringify(template, null, 2);
}

async function runListWorkflows(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const search = asString(input, 'search');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_WORKFLOW_LIMIT, MAX_WORKFLOW_LIMIT);
	const variables: Record<string, unknown> = { orgId, limit };
	if (search) variables.search = { name: { _ilike: `%${search}%` } };
	const data = await rawGraphqlOrThrow(ctx.session, WORKFLOWS_QUERY, variables);
	const workflows = ((data as { workflows?: unknown[] } | undefined)?.workflows ?? []) as {
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

async function runListOrgVariables(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const search = asString(input, 'search');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_ORG_VARIABLE_LIMIT, MAX_ORG_VARIABLE_LIMIT);
	const variables: Record<string, unknown> = { orgId, limit };
	if (search) variables.search = { name: { _ilike: `%${search}%` } };
	const data = await rawGraphqlOrThrow(ctx.session, ORG_VARIABLES_QUERY, variables);
	const orgVariables = ((data as { orgVariables?: unknown[] } | undefined)?.orgVariables ?? []) as {
		name?: string;
		value?: unknown;
		category?: string;
		cascade?: boolean;
	}[];
	if (orgVariables.length === 0) return 'No configuration variables found for this organization.';
	return orgVariables
		.map(variable => {
			const category = variable.category ?? 'unknown';
			return `${variable.name ?? '(unnamed)'} = ${variable.value ?? ''}  [${category}${variable.cascade ? ', cascade' : ''}]`;
		})
		.join('\n');
}

async function runListWorkflowExecutions(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_EXECUTION_LIMIT, MAX_EXECUTION_LIMIT);
	const status = asString(input, 'status');
	const variables: Record<string, unknown> = { orgId, limit };
	if (status) variables.search = { status: { _eq: status } };
	const data = await rawGraphqlOrThrow(ctx.session, WORKFLOW_EXECUTIONS_QUERY, variables);
	const executions = ((data as { workflowExecutions?: unknown[] } | undefined)?.workflowExecutions ?? []) as {
		id?: string;
		status?: string;
		createdAt?: string;
		workflow?: { id?: string };
		numSuccessfulTasks?: number;
	}[];
	if (executions.length === 0) return 'No workflow executions found for this organization.';
	return executions
		.map(
			execution =>
				`${execution.status ?? '(unknown status)'} — ${execution.id} (workflow ${execution.workflow?.id ?? '?'}, ${
					execution.numSuccessfulTasks ?? 0
				} ok, created ${execution.createdAt})`,
		)
		.join('\n');
}

type ExecutionVariableKind = 'input' | 'output' | 'context';

function renderVariableValue(value: unknown): string {
	if (value === null || value === undefined) return String(value);
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function flattenExecutionContextFrames(frames: unknown): Record<string, unknown> {
	const flat: Record<string, unknown> = {};
	if (!Array.isArray(frames)) return flat;
	for (const frame of frames) {
		if (frame && typeof frame === 'object') {
			for (const [key, value] of Object.entries(frame as Record<string, unknown>)) flat[key] = value;
		}
	}
	return flat;
}

function matchExecutionVariables(
	vars: Record<string, unknown>,
	nameNeedle: string,
	valueNeedle: string | undefined,
): string[] {
	const matches: string[] = [];
	for (const [key, value] of Object.entries(vars)) {
		if (!key.toLowerCase().includes(nameNeedle)) continue;
		const rendered = renderVariableValue(value);
		if (valueNeedle && !rendered.toLowerCase().includes(valueNeedle)) continue;
		const shown = rendered.length > 80 ? `${rendered.slice(0, 80)}...` : rendered;
		matches.push(`${key}=${shown}`);
	}
	return matches;
}

async function runFindExecutionsByVariable(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const workflowId = requireString(input, 'workflowId');
	const rawName = requireString(input, 'name');
	const nameNeedle = rawName.toLowerCase();
	const valueArg = asString(input, 'value');
	const valueNeedle = valueArg ? valueArg.toLowerCase() : undefined;
	const rawKind = asString(input, 'kind') ?? 'input';
	const kind: ExecutionVariableKind = rawKind === 'output' || rawKind === 'context' ? rawKind : 'input';
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_EXECUTION_LIMIT, MAX_EXECUTION_LIMIT);

	const data = await rawGraphqlOrThrow(ctx.session, EXECUTIONS_WITH_IO_QUERY, { orgId, workflowId, limit });
	const executions = ((data as { workflowExecutions?: unknown[] } | undefined)?.workflowExecutions ?? []) as {
		id?: string;
		status?: string;
		createdAt?: string;
		conductor?: { input?: unknown; output?: unknown };
	}[];

	let skipped = 0;
	const varsByExecution = await mapWithConcurrency(executions, 10, async execution => {
		if (kind === 'input' || kind === 'output') {
			const raw = execution.conductor?.[kind];
			return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
		}
		try {
			const data = await rawGraphqlOrThrow(ctx.session, EXECUTION_CONTEXTS_QUERY, {
				workflowExecutionId: execution.id,
			});
			return flattenExecutionContextFrames(
				(data as { workflowExecutionContexts?: unknown } | undefined)?.workflowExecutionContexts,
			);
		} catch {
			skipped += 1;
			return {};
		}
	});

	const lines: string[] = [];
	executions.forEach((execution, index) => {
		const matches = matchExecutionVariables(varsByExecution[index], nameNeedle, valueNeedle);
		if (matches.length > 0) {
			lines.push(
				`${execution.status ?? '(unknown status)'} — ${execution.id} (created ${execution.createdAt}) — ${kind}: ${matches.join(', ')}`,
			);
		}
	});

	let result: string;
	if (lines.length === 0) {
		const valuePart = valueArg ? ` with value containing "${valueArg}"` : '';
		result = `No executions of this workflow (scanned ${executions.length}) had a ${kind} variable matching "${rawName}"${valuePart}.`;
	} else {
		result = lines.join('\n');
	}
	if (skipped > 0) result += `\n\n(${skipped} execution context fetch(es) failed and were skipped.)`;
	if (executions.length >= limit) {
		result += `\n\n(Scanned the ${limit} most-recent executions; raise limit — max ${MAX_EXECUTION_LIMIT} — to scan more.)`;
	}
	return result;
}

// orgId is validated to select the session; result scoping is enforced server-side by the session's org access, so the query filters by workflow id alone.
async function runListWorkflowTasks(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	requireString(input, 'orgId');
	const workflowId = requireString(input, 'workflowId');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_TASK_LIMIT, MAX_TASK_LIMIT);
	const data = await rawGraphqlOrThrow(ctx.session, WORKFLOW_TASKS_QUERY, { workflowId, limit });
	const workflowTasks = ((data as { workflowTasks?: unknown[] } | undefined)?.workflowTasks ?? []) as {
		id?: string;
		name?: string;
		actionId?: string | null;
		workflowId?: string;
		isMocked?: boolean;
		timeout?: number | null;
		description?: string | null;
	}[];
	if (workflowTasks.length === 0) return `No workflow tasks found for workflow ${workflowId}.`;
	return workflowTasks
		.map(
			task =>
				`${task.name ?? '(unnamed)'} (${task.id})${task.actionId ? ` — action ${task.actionId}` : ''}${
					task.isMocked === true ? ' [mocked]' : ''
				}${task.timeout != null ? ` — timeout ${task.timeout}` : ''}${task.description ? ` — ${task.description}` : ''}`,
		)
		.join('\n');
}

// orgId is validated to select the session; result scoping is enforced server-side by the session's org access, so the query filters by workflow id alone.
async function runListWorkflowPatches(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	requireString(input, 'orgId');
	const workflowId = requireString(input, 'workflowId');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_PATCH_LIMIT, MAX_PATCH_LIMIT);
	const data = await rawGraphqlOrThrow(ctx.session, WORKFLOW_PATCHES_QUERY, { workflowId, limit });
	const workflowPatches = ((data as { workflowPatches?: unknown[] } | undefined)?.workflowPatches ?? []) as {
		id?: string;
		patchType?: string;
		comment?: string | null;
		commentDescription?: string | null;
		workflowId?: string;
		createdAt?: string;
	}[];
	if (workflowPatches.length === 0) return `No workflow patches found for workflow ${workflowId}.`;
	return workflowPatches
		.map(
			patch =>
				`${patch.patchType ?? '(unknown patch type)'} — ${patch.id}${patch.comment ? `: ${patch.comment}` : ''} (created ${
					patch.createdAt
				})`,
		)
		.join('\n');
}

// orgId is validated to select the session; result scoping is enforced server-side by the session's org access, so the query filters by patch id alone.
async function runGetWorkflowPatch(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	requireString(input, 'orgId');
	const patchId = requireString(input, 'patchId');
	const data = await rawGraphqlOrThrow(ctx.session, WORKFLOW_PATCH_QUERY, { id: patchId });
	const workflowPatch = (data as { workflowPatch?: unknown | null } | undefined)?.workflowPatch;
	if (!workflowPatch) return `No workflow patch found for patch id ${patchId}.`;
	return JSON.stringify(workflowPatch, null, 2);
}

async function runLatestWorkflowExecution(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const workflowId = requireString(input, 'workflowId');
	const status = asString(input, 'status');
	const variables: Record<string, unknown> = { orgId, workflowId };
	if (status) variables.status = status;
	const data = await rawGraphqlOrThrow(ctx.session, LATEST_WORKFLOW_EXECUTION_QUERY, variables);
	const execution = (
		data as
			| {
					latestWorkflowExecution?: {
						id?: string;
						status?: string;
						createdAt?: string;
						numSuccessfulTasks?: number;
						numAwaitingResponseTasks?: number;
					} | null;
			  }
			| undefined
	)?.latestWorkflowExecution;
	if (!execution) return `No execution found for workflow ${workflowId}.`;
	return `${execution.status ?? '(unknown status)'} — ${execution.id} (created ${
		execution.createdAt
	}, ${execution.numSuccessfulTasks ?? 0} ok, ${execution.numAwaitingResponseTasks ?? 0} awaiting response)`;
}

async function runGetWorkflowExecutionStats(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const createdSince = requireString(input, 'createdSince');
	if (/^\d+$/.test(createdSince)) {
		throw new Error('createdSince must be an ISO-8601 date string; epoch milliseconds are not supported.');
	}
	const variables = { orgId, createdSince };
	const data = await rawGraphqlOrThrow(ctx.session, WORKFLOW_EXECUTION_STATS_QUERY, variables);
	const stats = (
		data as
			| {
					workflowExecutionStats?: {
						succeeded?: number;
						failed?: number;
						running?: number;
						pending?: number;
						paused?: number;
						delayed?: number;
						humanSecondsSaved?: number;
					} | null;
			  }
			| undefined
	)?.workflowExecutionStats;
	if (!stats) return `No workflow execution stats found since ${createdSince}.`;
	return [
		`succeeded: ${stats.succeeded ?? 0}`,
		`failed: ${stats.failed ?? 0}`,
		`running: ${stats.running ?? 0}`,
		`pending: ${stats.pending ?? 0}`,
		`paused: ${stats.paused ?? 0}`,
		`delayed: ${stats.delayed ?? 0}`,
		`humanSecondsSaved: ${stats.humanSecondsSaved ?? 0}`,
	].join('\n');
}

async function runFindAction(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const filter = asString(input, 'filter');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_ACTION_LIMIT, MAX_ACTION_LIMIT);
	const variables: Record<string, unknown> = { orgId };
	if (filter) variables.filter = filter;
	const data = await rawGraphqlOrThrow(ctx.session, FIND_ACTION_QUERY, variables);
	const packs = ((data as { searchInstalledPackActions?: unknown[] } | undefined)?.searchInstalledPackActions ??
		[]) as {
		id?: string;
		name?: string;
		ref?: string;
		actions?: {
			id?: string;
			name?: string;
			ref?: string | null;
			description?: string | null;
		}[];
	}[];
	const flattened: {
		action: { id?: string; name?: string; ref?: string | null; description?: string | null };
		packName: string;
	}[] = [];
	for (const pack of packs) {
		const packName = pack.name ?? pack.ref ?? pack.id ?? '(unknown pack)';
		for (const action of pack.actions ?? []) {
			flattened.push({ action, packName });
		}
	}
	if (flattened.length === 0) {
		return `No actions found${filter ? ` matching "${filter}"` : ''} in this organization.`;
	}
	const capped = flattened.slice(0, limit);
	const lines = capped.map(
		({ action, packName }) =>
			`${action.ref ?? action.name ?? '(unnamed)'} (${action.id}) — ${packName}${
				action.description ? `: ${action.description}` : ''
			}`,
	);
	if (flattened.length > limit) {
		lines.push(`…(${flattened.length - limit} more not shown; refine the filter)`);
	}
	return lines.join('\n');
}

async function runResolveReference(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const modelType = requireString(input, 'modelType');
	if (!LOCAL_REFERENCE_MODELS.includes(modelType as (typeof LOCAL_REFERENCE_MODELS)[number])) {
		throw new Error(
			`Invalid modelType "${modelType}". Valid modelType values: ${LOCAL_REFERENCE_MODELS.join(', ')}`,
		);
	}
	const search = asString(input, 'search');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_REFERENCE_LIMIT, MAX_REFERENCE_LIMIT);
	const variables: Record<string, unknown> = { orgId, modelName: modelType, limit };
	if (search) variables.search = search;
	const data = await rawGraphqlOrThrow(ctx.session, RESOLVE_REFERENCE_QUERY, variables);
	const options = ((data as { localReferenceOptions?: unknown[] } | undefined)?.localReferenceOptions ?? []) as {
		label?: string;
		value?: string;
	}[];
	if (options.length === 0) {
		return `No matches found for ${modelType}${search ? ` matching "${search}"` : ''} in this organization.`;
	}
	return options.map(option => `${option.label} (${option.value})`).join('\n');
}

async function runGetWorkflow(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const workflowId = requireString(input, 'workflowId');
	const data = await rawGraphqlOrThrow(ctx.session, WORKFLOW_QUERY, { id: workflowId });
	const workflow = (data as { workflow?: { orgId?: unknown } } | undefined)?.workflow;
	if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
	// workflow(where:{id}) ignores org, so enforce the requested orgId here.
	// Fail closed: reject when orgId is absent as well as when it mismatches.
	if (typeof workflow.orgId !== 'string' || workflow.orgId !== orgId) {
		throw new Error(`Workflow ${workflowId} is not in org ${orgId}.`);
	}
	return JSON.stringify(workflow, null, 2);
}

async function runGraphqlQuery(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const query = requireString(input, 'query');
	const rawVariables = input.variables;
	if (
		rawVariables !== undefined &&
		(typeof rawVariables !== 'object' || rawVariables === null || Array.isArray(rawVariables))
	) {
		throw new Error('"variables" must be a JSON object when provided.');
	}
	const variables = (rawVariables as Record<string, unknown> | undefined) ?? {};
	// Bind the declared org boundary: a raw query must not silently target a
	// different org than the caller named. Reject a conflicting orgId variable and
	// pass the requested orgId through for queries that take an $orgId.
	if (variables.orgId !== undefined && variables.orgId !== orgId) {
		throw new Error('"variables.orgId" must match the requested "orgId".');
	}
	return runReadonlyGraphql(query, { ...variables, orgId }, (q, v) => ctx.session.rawGraphql(q, v));
}

export const READ_CAPABILITIES: Capability[] = [
	readCapability(listOrgsSpec, runListOrgs, { requiresOrg: false }),
	readCapability(listTemplatesSpec, runListTemplates),
	readCapability(getTemplateSpec, runGetTemplate),
	readCapability(listWorkflowsSpec, runListWorkflows),
	readCapability(listOrgVariablesSpec, runListOrgVariables),
	readCapability(listWorkflowExecutionsSpec, runListWorkflowExecutions),
	readCapability(findExecutionsByVariableSpec, runFindExecutionsByVariable),
	readCapability(listWorkflowTasksSpec, runListWorkflowTasks),
	readCapability(listWorkflowPatchesSpec, runListWorkflowPatches),
	readCapability(getWorkflowPatchSpec, runGetWorkflowPatch),
	readCapability(latestWorkflowExecutionSpec, runLatestWorkflowExecution),
	readCapability(getWorkflowExecutionStatsSpec, runGetWorkflowExecutionStats),
	readCapability(findActionSpec, runFindAction),
	readCapability(resolveReferenceSpec, runResolveReference),
	readCapability(getWorkflowSpec, runGetWorkflow),
	readCapability(graphqlQuerySpec, runGraphqlQuery),
];
