import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveSession } from './resolveSession';
import {
	listTemplatesSchema,
	getTemplateSchema,
	createTemplateSchema,
	updateTemplateBodySchema,
	updateTemplateNameSchema,
	deleteTemplateSchema,
} from './schemas';

export function registerTemplateTools(server: McpServer): void {
	server.registerTool(
		'rewst_list_templates',
		{
			title: 'List Templates',
			description: 'List all templates for a Rewst organization',
			inputSchema: listTemplatesSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ orgId }) => {
			const session = resolveSession(orgId);
			const targetOrgId = orgId ?? session.profile.org.id;
			const result = await session.sdk!.listTemplates({ orgId: targetOrgId });

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result.templates, null, 2) }],
			};
		},
	);

	server.registerTool(
		'rewst_get_template',
		{
			title: 'Get Template',
			description: 'Get a template with its full body content',
			inputSchema: getTemplateSchema,
			annotations: { readOnlyHint: true },
		},
		async ({ templateId, orgId }) => {
			const session = resolveSession(orgId);
			const result = await session.sdk!.getTemplate({ id: templateId });

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result.template, null, 2) }],
			};
		},
	);

	server.registerTool(
		'rewst_create_template',
		{
			title: 'Create Template',
			description: 'Create a new template in a Rewst organization. This is a WRITE operation.',
			inputSchema: createTemplateSchema,
			annotations: { readOnlyHint: false },
		},
		async ({ name, orgId, body }) => {
			const session = resolveSession(orgId);
			const result = await session.sdk!.createTemplateMinimal({ name, orgId, body });

			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(result.template, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		'rewst_update_template_body',
		{
			title: 'Update Template Body',
			description: 'Update the body content of an existing template. This is a WRITE operation.',
			inputSchema: updateTemplateBodySchema,
			annotations: { readOnlyHint: false },
		},
		async ({ templateId, body, orgId }) => {
			const session = resolveSession(orgId);
			const result = await session.sdk!.updateTemplateBody({ id: templateId, body });

			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(result.template, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		'rewst_update_template_name',
		{
			title: 'Update Template Name',
			description: 'Update the name of an existing template. This is a WRITE operation.',
			inputSchema: updateTemplateNameSchema,
			annotations: { readOnlyHint: false },
		},
		async ({ templateId, name, orgId }) => {
			const session = resolveSession(orgId);
			const result = await session.sdk!.updateTemplateName({ id: templateId, name });

			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(result.template, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		'rewst_delete_template',
		{
			title: 'Delete Template',
			description:
				'Permanently delete a template. This is an IRREVERSIBLE WRITE operation. The template cannot be recovered.',
			inputSchema: deleteTemplateSchema,
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async ({ templateId, orgId }) => {
			const session = resolveSession(orgId);
			const result = await session.sdk!.deleteTemplate({ id: templateId });

			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ deleted: result.deleteTemplate }, null, 2),
					},
				],
			};
		},
	);
}
