import { approveMutationScope, isMutationScopeApproved, type MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { requestMcpMutationApproval } from './graphqlMutateCapability';
import { ORG_ID_PROP, requireString } from './inputHelpers';

/**
 * Template write capabilities. Every mutation here is org-scoped: the MCP
 * boundary resolves a session for the requested orgId, but one session can manage
 * many orgs, so a bare template-id mutation could otherwise reach a template in a
 * sibling org. Each by-id write therefore re-verifies the template's orgId before
 * mutating (requireTemplateInOrg), mirroring the read path in runGetTemplate, and
 * every mutation is gated by the same per-call VS Code approval the other write
 * tools use. Exposure is additionally gated by rewst-buddy.mcp.enableWriteTools.
 */

function approvalRequiredResult(): string {
	return JSON.stringify({
		status: 'approval_required',
		message:
			'The mutation was not run; it needs approval in the VS Code window running Rewst Buddy. Focus that window to respond to the prompt, then retry. The prompt does not appear in the MCP client and cannot be approved if no VS Code window is open.',
	});
}

/**
 * The name of the org being mutated, resolved against the requested orgId rather
 * than the session's primary org (a session can manage several orgs, so
 * profile.org is not necessarily the requested one). Used only for the approval
 * modal text; org scoping itself is by the authoritative orgId.
 */
function orgDisplayName(ctx: CapabilityContext): string {
	const { profile } = ctx.session;
	if (profile.org.id === ctx.orgId) return profile.org.name;
	const managed = profile.allManagedOrgs.find(org => org.id === ctx.orgId);
	return managed?.name ?? ctx.orgId;
}

/** Requires a string argument that may be empty (e.g. a blank template body). */
function requireStringAllowEmpty(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== 'string') {
		throw new Error(`Missing required string argument "${key}".`);
	}
	return value;
}

/**
 * Fetches a template by id and fails closed unless it belongs to the requested
 * org. A session can manage several orgs and the SDK mutations target a template
 * by id alone, so this re-verification is what actually confines a by-id write to
 * the requested org (mirrors the read path in runGetTemplate). Returns the
 * template's name for the approval scope. getTemplate throws if the id is unknown.
 */
async function requireTemplateInOrg(
	ctx: CapabilityContext,
	templateId: string,
	orgId: string,
): Promise<{ name: string }> {
	const template = await ctx.session.getTemplate(templateId);
	const templateOrgId = (template as { orgId?: unknown }).orgId;
	if (typeof templateOrgId !== 'string' || templateOrgId !== orgId) {
		throw new Error(`Template ${templateId} is not in org ${orgId}.`);
	}
	const name = (template as { name?: unknown }).name;
	return { name: typeof name === 'string' && name.length > 0 ? name : '(unnamed)' };
}

/** Runs a mutation behind the shared per-call approval flow. */
async function withTemplateApproval(
	scope: MutationScope,
	operationSummary: string,
	run: () => Promise<string>,
): Promise<string> {
	if (!isMutationScopeApproved(scope)) {
		if (!(await requestMcpMutationApproval(scope, operationSummary))) {
			return approvalRequiredResult();
		}
		approveMutationScope(scope);
	}
	return run();
}

const createTemplateSpec: ToolSpec = {
	name: 'buddy_create_template',
	args: '{"orgId": string, "name": string, "body": string}',
	description:
		'Create a new Rewst template in one organization from a name and body, returning the new template id and name. Requires write tools to be enabled and per-call approval in VS Code. Pass an empty string for body to start a blank template.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			name: { type: 'string', description: 'Name for the new template.' },
			body: {
				type: 'string',
				description: 'Template body (Jinja/text); pass an empty string for a blank template.',
			},
		},
		required: ['orgId', 'name', 'body'],
	},
};

async function runCreateTemplate(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const name = requireString(input, 'name');
	const body = requireStringAllowEmpty(input, 'body');
	const orgName = orgDisplayName(ctx);
	// No resource id exists before creation, so the approval scope is the org; the
	// first create in an org prompts and later creates reuse that session approval.
	const scope: MutationScope = { scopeId: orgId, scopeName: `new template "${name}"`, orgId, orgName };
	const summary = `Create template "${name}" in org "${orgName}" (${orgId})`;
	return withTemplateApproval(scope, summary, async () => {
		const response = await ctx.session.sdk?.createTemplateMinimal({ name, orgId, body });
		const template = response?.template;
		if (!template?.id) {
			throw new Error('createTemplate returned no template; the mutation may have failed.');
		}
		return JSON.stringify({ status: 'created', id: template.id, name: template.name ?? name }, null, 2);
	});
}

const updateTemplateBodySpec: ToolSpec = {
	name: 'buddy_update_template_body',
	args: '{"orgId": string, "templateId": string, "body": string}',
	description:
		'Replace the body of one existing Rewst template, identified by org and template id. The template must belong to the given org. Requires write tools to be enabled and per-call approval in VS Code. Pass an empty string to clear the body.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			templateId: { type: 'string', description: 'Id of the template whose body to replace.' },
			body: { type: 'string', description: 'New template body; pass an empty string to clear it.' },
		},
		required: ['orgId', 'templateId', 'body'],
	},
};

async function runUpdateTemplateBody(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const templateId = requireString(input, 'templateId');
	const body = requireStringAllowEmpty(input, 'body');
	const orgName = orgDisplayName(ctx);
	// Verify org ownership before prompting or mutating, so a template in a sibling
	// org the session also manages can never be reached by id.
	const { name } = await requireTemplateInOrg(ctx, templateId, orgId);
	const scope: MutationScope = { scopeId: templateId, scopeName: name, orgId, orgName };
	const summary = `Replace body of template "${name}" (${templateId}) in org "${orgName}" (${orgId})`;
	return withTemplateApproval(scope, summary, async () => {
		const response = await ctx.session.sdk?.updateTemplateBody({ id: templateId, body });
		const template = response?.template;
		if (!template?.id) {
			throw new Error('updateTemplateBody returned no template; the mutation may have failed.');
		}
		return JSON.stringify({ status: 'updated', id: template.id, name: template.name ?? name }, null, 2);
	});
}

const renameTemplateSpec: ToolSpec = {
	name: 'buddy_rename_template',
	args: '{"orgId": string, "templateId": string, "name": string}',
	description:
		'Rename one existing Rewst template, identified by org and template id. The template must belong to the given org. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			templateId: { type: 'string', description: 'Id of the template to rename.' },
			name: { type: 'string', description: 'New name for the template.' },
		},
		required: ['orgId', 'templateId', 'name'],
	},
};

async function runRenameTemplate(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const templateId = requireString(input, 'templateId');
	const name = requireString(input, 'name');
	const orgName = orgDisplayName(ctx);
	const { name: currentName } = await requireTemplateInOrg(ctx, templateId, orgId);
	const scope: MutationScope = { scopeId: templateId, scopeName: currentName, orgId, orgName };
	const summary = `Rename template "${currentName}" (${templateId}) to "${name}" in org "${orgName}" (${orgId})`;
	return withTemplateApproval(scope, summary, async () => {
		const response = await ctx.session.sdk?.updateTemplateName({ id: templateId, name });
		const template = response?.template;
		if (!template?.id) {
			throw new Error('updateTemplateName returned no template; the mutation may have failed.');
		}
		return JSON.stringify({ status: 'renamed', id: template.id, name: template.name ?? name }, null, 2);
	});
}

const deleteTemplateSpec: ToolSpec = {
	name: 'buddy_delete_template',
	args: '{"orgId": string, "templateId": string}',
	description:
		'Permanently delete one Rewst template, identified by org and template id. The template must belong to the given org. This cannot be undone. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			templateId: { type: 'string', description: 'Id of the template to delete.' },
		},
		required: ['orgId', 'templateId'],
	},
};

async function runDeleteTemplate(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const templateId = requireString(input, 'templateId');
	const orgName = orgDisplayName(ctx);
	const { name } = await requireTemplateInOrg(ctx, templateId, orgId);
	const scope: MutationScope = { scopeId: templateId, scopeName: name, orgId, orgName };
	const summary = `Delete template "${name}" (${templateId}) in org "${orgName}" (${orgId})`;
	return withTemplateApproval(scope, summary, async () => {
		const response = await ctx.session.sdk?.deleteTemplate({ id: templateId });
		const deletedId = response?.deleteTemplate;
		if (!deletedId) {
			throw new Error('deleteTemplate returned no id; the mutation may have failed.');
		}
		return JSON.stringify({ status: 'deleted', id: deletedId, name }, null, 2);
	});
}

export const TEMPLATE_MUTATE_CAPABILITIES: Capability[] = [
	{ spec: createTemplateSpec, access: 'write', chat: false, mcp: true, run: runCreateTemplate },
	{ spec: updateTemplateBodySpec, access: 'write', chat: false, mcp: true, run: runUpdateTemplateBody },
	{ spec: renameTemplateSpec, access: 'write', chat: false, mcp: true, run: runRenameTemplate },
	{ spec: deleteTemplateSpec, access: 'write', chat: false, mcp: true, run: runDeleteTemplate },
];
