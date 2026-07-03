import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';

/**
 * Factories for the common capability shapes so definitions stay one-liners:
 * the spec, the handler, and only the options that differ from the defaults
 * (org-scoped, not dangerous). Every capability is exposed over MCP and
 * mirrored by Cage-Free Rewsty's in-process Buddy path.
 */

type CapabilityRun = (input: Record<string, unknown>, ctx: CapabilityContext) => Promise<string>;

export interface CapabilityOptions {
	/** See {@link Capability.requiresOrg}. */
	requiresOrg?: boolean;
	/** See {@link Capability.scopedSessions}. */
	scopedSessions?: boolean;
	/** See {@link Capability.dangerous}. Only meaningful on write capabilities. */
	dangerous?: boolean;
}

export function readCapability(spec: ToolSpec, run: CapabilityRun, opts: CapabilityOptions = {}): Capability {
	return { spec, access: 'read', run, ...opts };
}

export function writeCapability(spec: ToolSpec, run: CapabilityRun, opts: CapabilityOptions = {}): Capability {
	return { spec, access: 'write', run, ...opts };
}
