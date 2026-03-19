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
