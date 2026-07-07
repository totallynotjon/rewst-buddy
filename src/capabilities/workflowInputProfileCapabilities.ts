import { z } from 'zod';
import { WorkflowInputProfileStore } from '../models/WorkflowInputProfileStore';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import { ORG_ID_FIELD, parseCapabilityInput, requiredStringField, toInputSchema } from './inputHelpers';

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------

const baseProfileSchema = z.object({
	orgId: ORG_ID_FIELD,
	workflowId: requiredStringField('workflowId').describe('The workflow this profile belongs to.'),
	name: requiredStringField('name').describe('The profile name (case-sensitive).'),
});

// ---------------------------------------------------------------------------
// buddy_save_workflow_input_profile
// ---------------------------------------------------------------------------

const saveInputSchema = baseProfileSchema.extend({
	input: z
		.record(z.string(), z.unknown())
		.describe('The input payload to save (a JSON object mapping input names to values).'),
});

const saveSpec: ToolSpecDefinition = {
	name: 'buddy_save_workflow_input_profile',
	description:
		'Save a named input payload for a workflow so it can be reused with buddy_workflow_run. ' +
		'Creates or overwrites the profile. Profiles are stored locally in VS Code and are ' +
		'scoped to the org and workflow.',
	inputSchema: toInputSchema(saveInputSchema),
};

async function runSave(input: Record<string, unknown>, _ctx: CapabilityContext): Promise<string> {
	const { orgId, workflowId, name, input: payload } = parseCapabilityInput(saveInputSchema, input);
	const profile = WorkflowInputProfileStore.save(orgId, workflowId, name, payload);
	return `Saved profile "${profile.name}" for workflow ${workflowId} (org ${orgId}). Updated at ${profile.updatedAt}.`;
}

export const saveWorkflowInputProfileCapability: Capability = readCapability(saveSpec, runSave);

// ---------------------------------------------------------------------------
// buddy_list_workflow_input_profiles
// ---------------------------------------------------------------------------

const listInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	workflowId: requiredStringField('workflowId').describe('The workflow whose profiles to list.'),
});

const listSpec: ToolSpecDefinition = {
	name: 'buddy_list_workflow_input_profiles',
	description: 'List the saved input profiles for a workflow. Returns profile names and their stored input payloads.',
	inputSchema: toInputSchema(listInputSchema),
};

async function runList(input: Record<string, unknown>, _ctx: CapabilityContext): Promise<string> {
	const { orgId, workflowId } = parseCapabilityInput(listInputSchema, input);
	const profiles = WorkflowInputProfileStore.list(orgId, workflowId);
	if (profiles.length === 0) {
		return `No saved input profiles for workflow ${workflowId} (org ${orgId}).`;
	}
	const lines = profiles.map(p => `- "${p.name}" (updated ${p.updatedAt}): ${JSON.stringify(p.input)}`);
	return `${profiles.length} profile(s) for workflow ${workflowId}:\n${lines.join('\n')}`;
}

export const listWorkflowInputProfilesCapability: Capability = readCapability(listSpec, runList);

// ---------------------------------------------------------------------------
// buddy_delete_workflow_input_profile
// ---------------------------------------------------------------------------

const deleteInputSchema = baseProfileSchema;

const deleteSpec: ToolSpecDefinition = {
	name: 'buddy_delete_workflow_input_profile',
	description: 'Delete a saved input profile for a workflow.',
	inputSchema: toInputSchema(deleteInputSchema),
};

async function runDelete(input: Record<string, unknown>, _ctx: CapabilityContext): Promise<string> {
	const { orgId, workflowId, name } = parseCapabilityInput(deleteInputSchema, input);
	const deleted = WorkflowInputProfileStore.delete(orgId, workflowId, name);
	if (!deleted) {
		return `No profile named "${name}" found for workflow ${workflowId} (org ${orgId}).`;
	}
	return `Deleted profile "${name}" for workflow ${workflowId} (org ${orgId}).`;
}

export const deleteWorkflowInputProfileCapability: Capability = readCapability(deleteSpec, runDelete);
