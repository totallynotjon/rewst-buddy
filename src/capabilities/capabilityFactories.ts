import { withGeneratedArgs, type ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';

/**
 * Factories for the common capability shapes so definitions stay one-liners:
 * the spec, the handler, and only the options that differ from the defaults
 * (org-scoped, not dangerous). Every capability is exposed over MCP and
 * mirrored by Cage-Free Rewsty's in-process Buddy path.
 */

type CapabilityRun = (input: Record<string, unknown>, ctx: CapabilityContext) => Promise<string>;

/** Options shared by both read and write capabilities. */
export interface CapabilityOptions {
	/** See {@link Capability.requiresOrg}. */
	requiresOrg?: boolean;
	/** See {@link Capability.scopedSessions}. */
	scopedSessions?: boolean;
}

/**
 * Options for write capabilities. Extends {@link CapabilityOptions} with
 * write-only fields. Use this type with {@link writeCapability} — passing it
 * to {@link readCapability} is a type error, which enforces the constraint that
 * `dangerous` is only meaningful on mutating operations.
 */
export interface WriteCapabilityOptions extends CapabilityOptions {
	/** See {@link Capability.dangerous}. */
	dangerous?: boolean;
}

export function readCapability(spec: ToolSpecDefinition, run: CapabilityRun, opts: CapabilityOptions = {}): Capability {
	return { spec: withGeneratedArgs(spec), access: 'read', run, ...opts };
}

export function writeCapability(
	spec: ToolSpecDefinition,
	run: CapabilityRun,
	opts: WriteCapabilityOptions = {},
): Capability {
	return { spec: withGeneratedArgs(spec), access: 'write', run, ...opts };
}
