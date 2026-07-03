import type { Capability } from './Capability';
import { WORKFLOW_CHAT_CAPABILITIES, WORKSPACE_CHAT_CAPABILITIES, graphqlSchemaCapability } from './chatToolCapabilities';
import { graphqlMutateCapability } from './graphqlMutateCapability';
import { resultReadCapability } from './resultReadCapability';
import { READ_CAPABILITIES } from './rewstReadCapabilities';
import { TRIGGER_FORM_CAPABILITIES } from './triggerFormCapabilities';
import { PACK_INTEGRATION_CAPABILITIES } from './packIntegrationCapabilities';
import { ORG_USER_CAPABILITIES } from './orgUserCapabilities';
import { PAGE_TEMPLATE_CAPABILITIES } from './pageTemplateCapabilities';
import { ORG_VARIABLE_MUTATE_CAPABILITIES } from './orgVariableMutateCapabilities';
import { TAG_MUTATE_CAPABILITIES } from './tagMutateCapabilities';
import { WORKFLOW_CRUD_CAPABILITIES } from './workflowCrudCapabilities';
import { TRIGGER_MUTATE_CAPABILITIES } from './triggerMutateCapabilities';
import { TEMPLATE_MUTATE_CAPABILITIES } from './templateMutateCapabilities';
import { TEMPLATE_SYNC_CAPABILITIES } from './templateSyncCapabilities';
import { TEMPLATE_LINK_CAPABILITIES } from './templateLinkCapabilities';
import { TEMPLATE_CLONE_CAPABILITIES } from './templateCloneCapabilities';
import { WORKING_SCOPE_CAPABILITIES } from './workingScopeCapability';
import { JINJA_DOCS_CAPABILITIES } from './jinjaDocsCapabilities';

/**
 * The single source of truth for Rewst capabilities. Every capability is
 * exposed over the MCP server surface (behind the boundary's access gates) and
 * mirrored by Cage-Free Rewsty's in-process Buddy path; adding a capability
 * here surfaces it everywhere. Names must be unique across the registry.
 */
export const CAPABILITY_REGISTRY: Capability[] = [
	...WORKSPACE_CHAT_CAPABILITIES,
	...WORKFLOW_CHAT_CAPABILITIES,
	graphqlSchemaCapability,
	...READ_CAPABILITIES,
	...TRIGGER_FORM_CAPABILITIES,
	...PACK_INTEGRATION_CAPABILITIES,
	...ORG_USER_CAPABILITIES,
	...PAGE_TEMPLATE_CAPABILITIES,
	...ORG_VARIABLE_MUTATE_CAPABILITIES,
	...TAG_MUTATE_CAPABILITIES,
	...WORKFLOW_CRUD_CAPABILITIES,
	...TRIGGER_MUTATE_CAPABILITIES,
	...TEMPLATE_MUTATE_CAPABILITIES,
	...TEMPLATE_SYNC_CAPABILITIES,
	...TEMPLATE_LINK_CAPABILITIES,
	...TEMPLATE_CLONE_CAPABILITIES,
	...WORKING_SCOPE_CAPABILITIES,
	...JINJA_DOCS_CAPABILITIES,
	graphqlMutateCapability,
	resultReadCapability,
];

const BY_NAME = new Map(CAPABILITY_REGISTRY.map(capability => [capability.spec.name, capability]));

if (BY_NAME.size !== CAPABILITY_REGISTRY.length) {
	throw new Error('CAPABILITY_REGISTRY contains duplicate capability names');
}

/** A capability by tool name, or undefined if no capability owns that name. */
export function getCapability(name: string): Capability | undefined {
	return BY_NAME.get(name);
}

/** Capabilities exposed on the MCP server surface. */
export function mcpCapabilities(): Capability[] {
	return CAPABILITY_REGISTRY;
}
