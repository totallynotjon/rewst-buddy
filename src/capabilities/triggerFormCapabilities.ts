import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { asString, requireString, asPositiveInt, ORG_ID_PROP } from './inputHelpers';

const DEFAULT_TRIGGER_LIMIT = 50;
const MAX_TRIGGER_LIMIT = 200;
const DEFAULT_FORM_LIMIT = 50;
const MAX_FORM_LIMIT = 200;
const DEFAULT_TAG_LIMIT = 100;
const MAX_TAG_LIMIT = 500;
const DEFAULT_ORG_TRIGGER_INSTANCE_LIMIT = 50;
const MAX_ORG_TRIGGER_INSTANCE_LIMIT = 200;

const LIST_TRIGGERS_QUERY = `query($orgId: ID!, $limit: Int){ triggers(where:{ orgId:$orgId }, limit:$limit, order:[["name","ASC"]]){ id name enabled triggerTypeId workflowId } }`;
const LIST_FORMS_QUERY = `query($orgId: ID!, $limit: Int){ forms(where:{ orgId:$orgId }, limit:$limit){ id name updatedAt } }`;
const LIST_TAGS_QUERY = `query($orgId: ID!, $limit: Int){ tags(where:{ orgId:$orgId }, limit:$limit, order:[["name","asc"]]){ id name color } }`;
const LIST_ORG_TRIGGER_INSTANCES_QUERY = `query($orgId: ID!, $limit: Int){ orgTriggerInstances(where:{ orgId:$orgId }, limit:$limit){ id triggerId nextFireTime isManualActivation } }`;
const GET_TRIGGER_ERROR_STATUS_QUERY = `query($triggerIds: [ID!]){ getTriggerErrorStatus(triggerIds:$triggerIds) }`;

const listTriggersSpec: ToolSpec = {
	name: 'buddy_list_triggers',
	args: '{"orgId": string, "limit"?: number}',
	description:
		'List the triggers in one Rewst organization (id, name, enabled, triggerTypeId, workflowId). Triggers are how workflows are invoked.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			limit: {
				type: 'number',
				description: `Max triggers to return (default ${DEFAULT_TRIGGER_LIMIT}, max ${MAX_TRIGGER_LIMIT}).`,
			},
		},
		required: ['orgId'],
	},
};

const listFormsSpec: ToolSpec = {
	name: 'buddy_list_forms',
	args: '{"orgId": string, "limit"?: number}',
	description: 'List the forms in one Rewst organization (id, name, updatedAt).',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			limit: {
				type: 'number',
				description: `Max forms to return (default ${DEFAULT_FORM_LIMIT}, max ${MAX_FORM_LIMIT}).`,
			},
		},
		required: ['orgId'],
	},
};

const listTagsSpec: ToolSpec = {
	name: 'buddy_list_tags',
	args: '{"orgId": string, "limit"?: number}',
	description:
		'List the tags in one Rewst organization (id, name, color). Use the ids for tag filters on other tools.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			limit: {
				type: 'number',
				description: `Max tags to return (default ${DEFAULT_TAG_LIMIT}, max ${MAX_TAG_LIMIT}).`,
			},
		},
		required: ['orgId'],
	},
};

const listOrgTriggerInstancesSpec: ToolSpec = {
	name: 'buddy_list_org_trigger_instances',
	args: '{"orgId": string, "limit"?: number}',
	description:
		'List trigger activation instances for one Rewst organization (id, triggerId, nextFireTime, isManualActivation). nextFireTime is an epoch-millisecond string.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			limit: {
				type: 'number',
				description: `Max trigger activation instances to return (default ${DEFAULT_ORG_TRIGGER_INSTANCE_LIMIT}, max ${MAX_ORG_TRIGGER_INSTANCE_LIMIT}).`,
			},
		},
		required: ['orgId'],
	},
};

const getTriggerErrorStatusSpec: ToolSpec = {
	name: 'buddy_get_trigger_error_status',
	args: '{"orgId": string, "triggerIds": string[]}',
	description:
		'Batch health check for triggers: given trigger ids, returns whether each currently has errors (true = has errors).',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			triggerIds: { type: 'array', items: { type: 'string' }, description: 'Trigger ids to check.' },
		},
		required: ['orgId', 'triggerIds'],
	},
};

function requireStringArray(input: Record<string, unknown>, key: string): string[] {
	const value = input[key];
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`Missing required non-empty string array argument "${key}".`);
	}
	const strings = value.map((_, index) => asString({ value: value[index] }, 'value'));
	if (strings.some(value => !value)) {
		throw new Error(`Missing required non-empty string array argument "${key}".`);
	}
	return strings as string[];
}

async function runListTriggers(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_TRIGGER_LIMIT, MAX_TRIGGER_LIMIT);
	const variables = { orgId, limit };
	const { data, errors } = await ctx.session.rawGraphql(LIST_TRIGGERS_QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const triggers = ((data as { triggers?: unknown[] } | undefined)?.triggers ?? []) as {
		id?: string;
		name?: string;
		enabled?: boolean;
		triggerTypeId?: string;
		workflowId?: string | null;
	}[];
	if (triggers.length === 0) return 'No triggers found for this organization.';
	return triggers
		.map(trigger => {
			const name = trigger.name ?? '(unnamed)';
			const id = trigger.id ?? '(unknown id)';
			return `${name} (${id})${trigger.enabled ? '' : ' [disabled]'}${
				trigger.workflowId ? ' → workflow ' + trigger.workflowId : ''
			}`;
		})
		.join('\n');
}

async function runListForms(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_FORM_LIMIT, MAX_FORM_LIMIT);
	const variables = { orgId, limit };
	const { data, errors } = await ctx.session.rawGraphql(LIST_FORMS_QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const forms = ((data as { forms?: unknown[] } | undefined)?.forms ?? []) as {
		id?: string;
		name?: string;
		updatedAt?: string | null;
	}[];
	if (forms.length === 0) return 'No forms found for this organization.';
	return forms.map(form => `${form.name ?? '(unnamed)'} (${form.id ?? '(unknown id)'})`).join('\n');
}

async function runListTags(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? DEFAULT_TAG_LIMIT, MAX_TAG_LIMIT);
	const variables = { orgId, limit };
	const { data, errors } = await ctx.session.rawGraphql(LIST_TAGS_QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const tags = ((data as { tags?: unknown[] } | undefined)?.tags ?? []) as {
		id?: string;
		name?: string;
		color?: string | null;
	}[];
	if (tags.length === 0) return 'No tags found for this organization.';
	return tags.map(tag => `${tag.name ?? '(unnamed)'} (${tag.id ?? '(unknown id)'})`).join('\n');
}

async function runListOrgTriggerInstances(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const limit = Math.min(
		asPositiveInt(input, 'limit') ?? DEFAULT_ORG_TRIGGER_INSTANCE_LIMIT,
		MAX_ORG_TRIGGER_INSTANCE_LIMIT,
	);
	const variables = { orgId, limit };
	const { data, errors } = await ctx.session.rawGraphql(LIST_ORG_TRIGGER_INSTANCES_QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const instances = ((data as { orgTriggerInstances?: unknown[] } | undefined)?.orgTriggerInstances ?? []) as {
		id?: string;
		triggerId?: string;
		nextFireTime?: string | null;
		isManualActivation?: boolean;
	}[];
	if (instances.length === 0) return 'No trigger activation instances found for this organization.';
	return instances
		.map(instance => {
			const triggerId = instance.triggerId ?? '(unknown trigger)';
			const id = instance.id ?? '(unknown id)';
			return `trigger ${triggerId} → instance ${id}${instance.nextFireTime ? ' next ' + instance.nextFireTime : ''}${
				instance.isManualActivation ? ' [manual]' : ''
			}`;
		})
		.join('\n');
}

// orgId is validated to select the session; result scoping is enforced server-side by the session's org access, so the query filters by trigger ids alone.
async function runGetTriggerErrorStatus(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	requireString(input, 'orgId');
	const triggerIds = requireStringArray(input, 'triggerIds');
	const variables = { triggerIds };
	const { data, errors } = await ctx.session.rawGraphql(GET_TRIGGER_ERROR_STATUS_QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const statuses = ((data as { getTriggerErrorStatus?: Record<string, boolean> } | undefined)
		?.getTriggerErrorStatus ?? {}) as Record<string, boolean>;
	return triggerIds
		.map(id => {
			const hasError = statuses[id];
			return `${id}: ${hasError === true ? 'ERROR' : hasError === false ? 'ok' : 'unknown'}`;
		})
		.join('\n');
}

export const TRIGGER_FORM_CAPABILITIES: Capability[] = [
	{ spec: listTriggersSpec, access: 'read', chat: false, mcp: true, run: runListTriggers },
	{ spec: listFormsSpec, access: 'read', chat: false, mcp: true, run: runListForms },
	{ spec: listTagsSpec, access: 'read', chat: false, mcp: true, run: runListTags },
	{ spec: listOrgTriggerInstancesSpec, access: 'read', chat: false, mcp: true, run: runListOrgTriggerInstances },
	{ spec: getTriggerErrorStatusSpec, access: 'read', chat: false, mcp: true, run: runGetTriggerErrorStatus },
];
