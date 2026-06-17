import { createGraphqlDeps, GRAPHQL_TOOL_SPECS, runGraphqlTool } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability } from './Capability';

/**
 * Migrates the existing rewst_graphql_schema / rewst_graphql tool specs into
 * capabilities. The spec objects are reused verbatim (not copied) so the
 * package.json manifest stays in sync via packageManifest.test.ts, and the chat
 * surface keeps offering the identical two tools.
 *
 * Execution wraps runGraphqlTool with deps bound to the resolved session, the
 * same path the chat tools use. rewst_graphql_schema is read-only; rewst_graphql
 * is marked write because it can carry a mutation — the MCP server boundary
 * rejects writes unless write tools are enabled. A read-only GraphQL query
 * capability for MCP is added separately in a later phase.
 */

function specByName(name: string): ToolSpec {
	const spec = GRAPHQL_TOOL_SPECS.find(entry => entry.name === name);
	if (!spec) throw new Error(`graphqlCapabilities: missing tool spec "${name}"`);
	return spec;
}

export const graphqlSchemaCapability: Capability = {
	spec: specByName('rewst_graphql_schema'),
	access: 'read',
	chat: true,
	mcp: false,
	enabled: settings => settings.enableGraphqlTool,
	run: (input, ctx) => runGraphqlTool({ tool: 'rewst_graphql_schema', args: input }, createGraphqlDeps(ctx.session)),
};

export const graphqlCapability: Capability = {
	spec: specByName('rewst_graphql'),
	access: 'write',
	chat: true,
	mcp: false,
	enabled: settings => settings.enableGraphqlTool,
	run: (input, ctx) => runGraphqlTool({ tool: 'rewst_graphql', args: input }, createGraphqlDeps(ctx.session)),
};

export const GRAPHQL_CAPABILITIES: Capability[] = [graphqlSchemaCapability, graphqlCapability];
