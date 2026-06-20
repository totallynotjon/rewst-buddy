import { createGraphqlDeps, GRAPHQL_TOOL_SPECS, runGraphqlTool } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability } from './Capability';

/**
 * Migrates the existing buddy_graphql_schema / buddy_graphql tool specs into
 * capabilities. The spec objects are reused verbatim (not copied) so the
 * package.json manifest stays in sync via packageManifest.test.ts, and the chat
 * surface keeps offering the identical two tools.
 *
 * Execution wraps runGraphqlTool with deps bound to the resolved session, the
 * same path the chat tools use. buddy_graphql_schema is read-only and can also
 * be exposed over MCP; buddy_graphql stays chat-only because it can carry both
 * reads and writes. MCP gets separate read and mutation primitives.
 */

function specByName(name: string): ToolSpec {
	const spec = GRAPHQL_TOOL_SPECS.find(entry => entry.name === name);
	if (!spec) throw new Error(`graphqlCapabilities: missing tool spec "${name}"`);
	return spec;
}

export const graphqlSchemaCapability: Capability = {
	spec: specByName('buddy_graphql_schema'),
	access: 'read',
	chat: true,
	mcp: true,
	requiresOrg: false,
	enabled: settings => settings.enableGraphqlTool,
	run: (input, ctx) => runGraphqlTool({ tool: 'buddy_graphql_schema', args: input }, createGraphqlDeps(ctx.session)),
};

export const graphqlCapability: Capability = {
	spec: specByName('buddy_graphql'),
	access: 'write',
	chat: true,
	mcp: false,
	enabled: settings => settings.enableGraphqlTool,
	run: (input, ctx) => runGraphqlTool({ tool: 'buddy_graphql', args: input }, createGraphqlDeps(ctx.session)),
};

export const GRAPHQL_CAPABILITIES: Capability[] = [graphqlSchemaCapability, graphqlCapability];
