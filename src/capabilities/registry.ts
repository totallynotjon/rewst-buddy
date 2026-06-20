import type { Capability, CapabilitySettings } from './Capability';
import { GRAPHQL_CAPABILITIES } from './graphqlCapabilities';
import { graphqlMutateCapability } from './graphqlMutateCapability';
import { READ_CAPABILITIES } from './rewstReadCapabilities';

/**
 * The single source of truth for Rewst capabilities. Surfaces (chat, MCP) filter
 * this list by their own gates; adding a capability here surfaces it everywhere
 * it opts into. Names must be unique across the registry.
 */
export const CAPABILITY_REGISTRY: Capability[] = [
	...GRAPHQL_CAPABILITIES,
	...READ_CAPABILITIES,
	graphqlMutateCapability,
];

const BY_NAME = new Map(CAPABILITY_REGISTRY.map(capability => [capability.spec.name, capability]));

if (BY_NAME.size !== CAPABILITY_REGISTRY.length) {
	throw new Error('CAPABILITY_REGISTRY contains duplicate capability names');
}

/** A capability by tool name, or undefined if no capability owns that name. */
export function getCapability(name: string): Capability | undefined {
	return BY_NAME.get(name);
}

/** Capabilities exposed on the Cage-Free Rewsty chat surface. */
export function chatCapabilities(): Capability[] {
	return CAPABILITY_REGISTRY.filter(capability => capability.chat);
}

/** Capabilities exposed on the MCP server surface. */
export function mcpCapabilities(): Capability[] {
	return CAPABILITY_REGISTRY.filter(capability => capability.mcp);
}

/** MCP capabilities whose intrinsic feature gate the given settings satisfy. */
export function enabledMcpCapabilities(settings: CapabilitySettings): Capability[] {
	return mcpCapabilities().filter(capability => capability.enabled(settings));
}
