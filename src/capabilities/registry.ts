import type { Capability, CapabilityGroup } from './Capability';
import { WORKFLOW_CHAT_CAPABILITIES, WORKSPACE_CHAT_CAPABILITIES } from './chatToolCapabilities';
import { GRAPHQL_CAPABILITIES } from './graphqlCapabilities';
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
 * The single source of truth for Rewst capabilities. Surfaces (chat, MCP) filter
 * this list by their own gates; adding a capability here surfaces it everywhere
 * it opts into. Names must be unique across the registry.
 */
export const CAPABILITY_REGISTRY: Capability[] = [
	...WORKSPACE_CHAT_CAPABILITIES,
	...WORKFLOW_CHAT_CAPABILITIES,
	...GRAPHQL_CAPABILITIES,
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
const EMPTY_CHAT_CAPABILITY_NAMES = new Set<string>();
const CHAT_NAMES_BY_GROUP = new Map<CapabilityGroup, Set<string>>();

if (BY_NAME.size !== CAPABILITY_REGISTRY.length) {
	throw new Error('CAPABILITY_REGISTRY contains duplicate capability names');
}

for (const capability of CAPABILITY_REGISTRY) {
	if (!capability.chat || capability.group === undefined) continue;
	const names = CHAT_NAMES_BY_GROUP.get(capability.group) ?? new Set<string>();
	names.add(capability.spec.name);
	CHAT_NAMES_BY_GROUP.set(capability.group, names);
}

/** A capability by tool name, or undefined if no capability owns that name. */
export function getCapability(name: string): Capability | undefined {
	return BY_NAME.get(name);
}

/** Capabilities exposed on the Cage-Free Rewsty chat surface. */
export function chatCapabilities(): Capability[] {
	return CAPABILITY_REGISTRY.filter(capability => capability.chat);
}

/** Chat-exposed capability names in a tool family. */
export function chatCapabilityNames(group: CapabilityGroup): ReadonlySet<string> {
	return CHAT_NAMES_BY_GROUP.get(group) ?? EMPTY_CHAT_CAPABILITY_NAMES;
}

/** Whether a provided tool-name set includes any chat capability in a tool family. */
export function hasChatCapability(group: CapabilityGroup, names: ReadonlySet<string>): boolean {
	const groupNames = chatCapabilityNames(group);
	for (const name of names) {
		if (groupNames.has(name)) return true;
	}
	return false;
}

/** Capabilities exposed on the MCP server surface. */
export function mcpCapabilities(): Capability[] {
	return CAPABILITY_REGISTRY.filter(capability => capability.mcp);
}

/** MCP capabilities; exposure gates are applied by the MCP boundary. */
export function enabledMcpCapabilities(): Capability[] {
	return mcpCapabilities();
}
