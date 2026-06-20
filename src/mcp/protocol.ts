/**
 * Shared MCP types for the in-extension HTTP server. The MCP Streamable HTTP
 * transport runs inside the extension host (see mcpServer.ts), so there is no
 * separate bridge process and no wire envelope to maintain — these are just the
 * descriptor/result/error shapes the capability surface produces, plus the
 * localhost auth header.
 */

/** Reported as the MCP server version in the initialize handshake. */
export const MCP_PROTOCOL_VERSION = 1;

/** HTTP header carrying the per-install MCP token the client must present. */
export const MCP_TOKEN_HEADER = 'x-rewst-mcp-token';

/** Stable error codes so the agent gets actionable messages, not opaque 500s. */
export type McpErrorCode =
	| 'mcp_disabled'
	| 'bad_token'
	| 'invalid_request'
	| 'unknown_tool'
	| 'org_required'
	| 'org_not_found'
	| 'no_session'
	| 'refresh_failed'
	| 'write_disabled'
	| 'approval_required'
	| 'rate_limited'
	| 'graphql_error'
	| 'internal';

export interface McpToolDescriptor {
	name: string;
	description: string;
	inputSchema: object;
}

export interface McpResourceDescriptor {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface McpToolResult {
	/** Text content for the agent. */
	text: string;
	/** True when the tool ran but produced an error result the agent should see. */
	isError?: boolean;
}
