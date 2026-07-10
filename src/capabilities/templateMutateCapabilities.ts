import { LinkManager, type TemplateLink } from '@models';
import { z } from 'zod';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';
import {
	ORG_ID_FIELD,
	parseCapabilityInput,
	requiredStringAllowEmptyField,
	requiredStringField,
	requireResourceInOrg,
	toInputSchema,
} from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';

/**
 * Template write capabilities. Every mutation here is org-scoped: the MCP
 * boundary resolves a session for the requested orgId, but one session can manage
 * many orgs, so a bare template-id mutation could otherwise reach a template in a
 * sibling org. Each by-id write therefore re-verifies the template's orgId before
 * mutating (requireTemplateInOrg), mirroring the read path in runGetTemplate, and
 * every mutation is gated by the same per-call VS Code approval the other write
 * tools use. Exposure is additionally gated by rewst-buddy.mcp.enableWriteTools.
 */

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
	const template = await requireResourceInOrg({
		label: 'Template',
		id: templateId,
		orgId,
		fetch: async () => {
			const t = await ctx.session.getTemplate(templateId);
			return t as { orgId?: unknown; name?: unknown };
		},
	});
	const name = (template as { name?: unknown }).name;
	return { name: typeof name === 'string' && name.length > 0 ? name : '(unnamed)' };
}

const createTemplateSchema = z.object({
	orgId: ORG_ID_FIELD,
	name: requiredStringField('name').describe('Name for the new template.'),
	body: requiredStringAllowEmptyField('body').describe(
		'Template body (Jinja/text); pass an empty string for a blank template.',
	),
});

const createTemplateSpec: ToolSpecDefinition = {
	name: 'buddy_create_template',
	description:
		'Create a new Rewst template in one organization from a name and body, returning the new template id and name. Requires write tools to be enabled and per-call approval in VS Code. Pass an empty string for body to start a blank template.',
	inputSchema: toInputSchema(createTemplateSchema),
};

async function runCreateTemplate(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, name, body } = parseCapabilityInput(createTemplateSchema, input);
	const orgName = orgDisplayName(ctx);
	// No resource id exists before creation, so the approval scope is the org; the
	// first create in an org prompts and later creates reuse that session approval.
	const scope: MutationScope = { scopeId: orgId, scopeName: `new template "${name}"`, orgId, orgName };
	const summary = `Create template "${name}" in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const response = await ctx.session.sdk?.createTemplateMinimal({ name, orgId, body });
		const template = response?.template;
		if (!template?.id) {
			throw new Error('createTemplate returned no template; the mutation may have failed.');
		}
		return JSON.stringify({ status: 'created', id: template.id, name: template.name ?? name }, null, 2);
	});
}

const updateTemplateBodySchema = z.object({
	orgId: ORG_ID_FIELD,
	templateId: requiredStringField('templateId').describe('Id of the template whose body to replace.'),
	body: requiredStringAllowEmptyField('body').describe('New template body; pass an empty string to clear it.'),
});

const updateTemplateBodySpec: ToolSpecDefinition = {
	name: 'buddy_update_template_body',
	description:
		'Replace the body of one existing Rewst template, identified by org and template id. The template must belong to the given org. Requires write tools to be enabled and per-call approval in VS Code. Pass an empty string to clear the body.',
	inputSchema: toInputSchema(updateTemplateBodySchema),
};

async function runUpdateTemplateBody(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, templateId, body } = parseCapabilityInput(updateTemplateBodySchema, input);
	const orgName = orgDisplayName(ctx);
	// Verify org ownership before prompting or mutating, so a template in a sibling
	// org the session also manages can never be reached by id.
	const { name } = await requireTemplateInOrg(ctx, templateId, orgId);
	const scope: MutationScope = { scopeId: templateId, scopeName: name, orgId, orgName };
	const summary = `Replace body of template "${name}" (${templateId}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const response = await ctx.session.sdk?.updateTemplateBody({ id: templateId, body });
		const template = response?.template;
		if (!template?.id) {
			throw new Error('updateTemplateBody returned no template; the mutation may have failed.');
		}
		return JSON.stringify({ status: 'updated', id: template.id, name: template.name ?? name }, null, 2);
	});
}

const renameTemplateSchema = z.object({
	orgId: ORG_ID_FIELD,
	templateId: requiredStringField('templateId').describe('Id of the template to rename.'),
	name: requiredStringField('name').describe('New name for the template.'),
});

const renameTemplateSpec: ToolSpecDefinition = {
	name: 'buddy_rename_template',
	description:
		'Rename one existing Rewst template, identified by org and template id. The template must belong to the given org. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: toInputSchema(renameTemplateSchema),
};

async function runRenameTemplate(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, templateId, name } = parseCapabilityInput(renameTemplateSchema, input);
	const orgName = orgDisplayName(ctx);
	const { name: currentName } = await requireTemplateInOrg(ctx, templateId, orgId);
	const scope: MutationScope = { scopeId: templateId, scopeName: currentName, orgId, orgName };
	const summary = `Rename template "${currentName}" (${templateId}) to "${name}" in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		const response = await ctx.session.sdk?.updateTemplateName({ id: templateId, name });
		const template = response?.template;
		if (!template?.id) {
			throw new Error('updateTemplateName returned no template; the mutation may have failed.');
		}
		const newName = template.name ?? name;
		// Keep the local link cache (and its status bar / tree label) in sync — a
		// rename otherwise leaves the cached name stale until the next sync (#176).
		// updatedAt must move forward too: leaving it stale makes the next auto-fetch
		// check see a provably-newer remote and needlessly re-fetch/re-save the
		// unchanged body.
		for (const link of LinkManager.getTemplateLinkFromId(templateId)) {
			const updated: TemplateLink = {
				...link,
				template: { ...link.template, name: newName, updatedAt: template.updatedAt ?? link.template.updatedAt },
			};
			LinkManager.addLink(updated);
		}
		return JSON.stringify({ status: 'renamed', id: template.id, name: newName }, null, 2);
	});
}

const deleteTemplateSchema = z.object({
	orgId: ORG_ID_FIELD,
	templateId: requiredStringField('templateId').describe('Id of the template to delete.'),
});

const deleteTemplateSpec: ToolSpecDefinition = {
	name: 'buddy_delete_template',
	description:
		'Permanently delete one Rewst template, identified by org and template id. The template must belong to the given org. This cannot be undone. Requires write tools to be enabled and per-call approval in VS Code.',
	inputSchema: toInputSchema(deleteTemplateSchema),
};

async function runDeleteTemplate(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, templateId } = parseCapabilityInput(deleteTemplateSchema, input);
	const orgName = orgDisplayName(ctx);
	const { name } = await requireTemplateInOrg(ctx, templateId, orgId);
	const scope: MutationScope = { scopeId: templateId, scopeName: name, orgId, orgName };
	const summary = `Delete template "${name}" (${templateId}) in org "${orgName}" (${orgId})`;
	// A delete always prompts fresh: approval scopes key only on [orgId, resourceId],
	// so without this a prior non-delete approval for this same template (rename,
	// body update) would otherwise silently pre-approve deleting it too (#177).
	return withMutationApproval(
		scope,
		summary,
		async () => {
			const response = await ctx.session.sdk?.deleteTemplate({ id: templateId });
			const deletedId = response?.deleteTemplate;
			if (!deletedId) {
				throw new Error('deleteTemplate returned no id; the mutation may have failed.');
			}
			return JSON.stringify({ status: 'deleted', id: deletedId, name }, null, 2);
		},
		{ alwaysPrompt: true },
	);
}

export const TEMPLATE_MUTATE_CAPABILITIES: Capability[] = [
	writeCapability(createTemplateSpec, runCreateTemplate),
	writeCapability(updateTemplateBodySpec, runUpdateTemplateBody),
	writeCapability(renameTemplateSpec, runRenameTemplate),
	writeCapability(deleteTemplateSpec, runDeleteTemplate),
];
