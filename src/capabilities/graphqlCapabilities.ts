import { createGraphqlDeps, GRAPHQL_TOOL_SPECS, runGraphqlTool } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability } from './Capability';

/**
 * Exposes the schema helper over MCP. The combined buddy_graphql chat tool is
 * retired: MCP uses the dedicated rewst_graphql_query and rewst_graphql_mutate
 * primitives instead.
 */

function specByName(name: string): ToolSpec {
	const spec = GRAPHQL_TOOL_SPECS.find(entry => entry.name === name);
	if (!spec) throw new Error(`graphqlCapabilities: missing tool spec "${name}"`);
	return spec;
}

export const graphqlSchemaCapability: Capability = {
	spec: specByName('buddy_graphql_schema'),
	group: 'graphql',
	access: 'read',
	chat: false,
	mcp: true,
	requiresOrg: false,
	enabled: settings => settings.enableGraphqlTool,
	run: (input, ctx) => runGraphqlTool({ tool: 'buddy_graphql_schema', args: input }, createGraphqlDeps(ctx.session)),
};

export const GRAPHQL_CAPABILITIES: Capability[] = [graphqlSchemaCapability];
