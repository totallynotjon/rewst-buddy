import { z } from 'zod';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import {
	ORG_ID_FIELD,
	optionalClampedInt,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	toInputSchema,
} from './inputHelpers';

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

const listTriggersInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	limit: optionalClampedInt(MAX_TRIGGER_LIMIT).describe(
		`Max triggers to return (default ${DEFAULT_TRIGGER_LIMIT}, max ${MAX_TRIGGER_LIMIT}).`,
	),
});

const listFormsInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	limit: optionalClampedInt(MAX_FORM_LIMIT).describe(
		`Max forms to return (default ${DEFAULT_FORM_LIMIT}, max ${MAX_FORM_LIMIT}).`,
	),
});

const listTagsInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	limit: optionalClampedInt(MAX_TAG_LIMIT).describe(
		`Max tags to return (default ${DEFAULT_TAG_LIMIT}, max ${MAX_TAG_LIMIT}).`,
	),
});

const listOrgTriggerInstancesInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	limit: optionalClampedInt(MAX_ORG_TRIGGER_INSTANCE_LIMIT).describe(
		`Max trigger activation instances to return (default ${DEFAULT_ORG_TRIGGER_INSTANCE_LIMIT}, max ${MAX_ORG_TRIGGER_INSTANCE_LIMIT}).`,
	),
});

const TRIGGER_IDS_ERROR = 'Missing required non-empty string array argument "triggerIds".';

const getTriggerErrorStatusInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	triggerIds: z
		.preprocess(
			raw => (raw === undefined || raw === null ? [] : raw),
			z.array(z.string(), { error: TRIGGER_IDS_ERROR }).min(1, { error: TRIGGER_IDS_ERROR }),
		)
		.describe('Trigger ids to check.'),
});

const listTriggersSpec: ToolSpecDefinition = {
	name: 'buddy_list_triggers',
	description:
		'List the triggers in one Rewst organization (id, name, enabled, triggerTypeId, workflowId). Triggers are how workflows are invoked.',
	inputSchema: toInputSchema(listTriggersInputSchema),
};

const listFormsSpec: ToolSpecDefinition = {
	name: 'buddy_list_forms',
	description: 'List the forms in one Rewst organization (id, name, updatedAt).',
	inputSchema: toInputSchema(listFormsInputSchema),
};

const listTagsSpec: ToolSpecDefinition = {
	name: 'buddy_list_tags',
	description:
		'List the tags in one Rewst organization (id, name, color). Use the ids for tag filters on other tools.',
	inputSchema: toInputSchema(listTagsInputSchema),
};

const listOrgTriggerInstancesSpec: ToolSpecDefinition = {
	name: 'buddy_list_org_trigger_instances',
	description:
		'List trigger activation instances for one Rewst organization (id, triggerId, nextFireTime, isManualActivation). nextFireTime is an epoch-millisecond string.',
	inputSchema: toInputSchema(listOrgTriggerInstancesInputSchema),
};

const getTriggerErrorStatusSpec: ToolSpecDefinition = {
	name: 'buddy_get_trigger_error_status',
	description:
		'Batch health check for triggers: given trigger ids, returns whether each currently has errors (true = has errors).',
	inputSchema: toInputSchema(getTriggerErrorStatusInputSchema),
};

async function runListTriggers(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, limit: rawLimit } = parseCapabilityInput(listTriggersInputSchema, input);
	const limit = rawLimit ?? DEFAULT_TRIGGER_LIMIT;
	const variables = { orgId, limit };
	const data = await rawGraphqlOrThrow(ctx.session, LIST_TRIGGERS_QUERY, variables);
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
	const { orgId, limit: rawLimit } = parseCapabilityInput(listFormsInputSchema, input);
	const limit = rawLimit ?? DEFAULT_FORM_LIMIT;
	const variables = { orgId, limit };
	const data = await rawGraphqlOrThrow(ctx.session, LIST_FORMS_QUERY, variables);
	const forms = ((data as { forms?: unknown[] } | undefined)?.forms ?? []) as {
		id?: string;
		name?: string;
		updatedAt?: string | null;
	}[];
	if (forms.length === 0) return 'No forms found for this organization.';
	return forms.map(form => `${form.name ?? '(unnamed)'} (${form.id ?? '(unknown id)'})`).join('\n');
}

async function runListTags(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, limit: rawLimit } = parseCapabilityInput(listTagsInputSchema, input);
	const limit = rawLimit ?? DEFAULT_TAG_LIMIT;
	const variables = { orgId, limit };
	const data = await rawGraphqlOrThrow(ctx.session, LIST_TAGS_QUERY, variables);
	const tags = ((data as { tags?: unknown[] } | undefined)?.tags ?? []) as {
		id?: string;
		name?: string;
		color?: string | null;
	}[];
	if (tags.length === 0) return 'No tags found for this organization.';
	return tags.map(tag => `${tag.name ?? '(unnamed)'} (${tag.id ?? '(unknown id)'})`).join('\n');
}

async function runListOrgTriggerInstances(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, limit: rawLimit } = parseCapabilityInput(listOrgTriggerInstancesInputSchema, input);
	const limit = rawLimit ?? DEFAULT_ORG_TRIGGER_INSTANCE_LIMIT;
	const variables = { orgId, limit };
	const data = await rawGraphqlOrThrow(ctx.session, LIST_ORG_TRIGGER_INSTANCES_QUERY, variables);
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
	const { triggerIds } = parseCapabilityInput(getTriggerErrorStatusInputSchema, input);
	const variables = { triggerIds };
	const data = await rawGraphqlOrThrow(ctx.session, GET_TRIGGER_ERROR_STATUS_QUERY, variables);
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
	readCapability(listTriggersSpec, runListTriggers),
	readCapability(listFormsSpec, runListForms),
	readCapability(listTagsSpec, runListTags),
	readCapability(listOrgTriggerInstancesSpec, runListOrgTriggerInstances),
	readCapability(getTriggerErrorStatusSpec, runGetTriggerErrorStatus),
];
