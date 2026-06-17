/**
 * The wire contract between the stdio MCP bridge process and the extension's
 * localhost server. Intentionally dependency-free (no vscode, no node APIs) so
 * both the extension bundle and the standalone bridge bundle can import it.
 *
 * The bridge holds no credentials: it forwards tool names and arguments over
 * localhost HTTP, guarded by a per-activation token, and the extension does the
 * authenticated work with the sessions it already manages.
 */

/** Bumped when the request/response shape changes incompatibly. */
export const MCP_PROTOCOL_VERSION = 1;

/** HTTP header carrying the per-activation bridge token. */
export const MCP_TOKEN_HEADER = 'x-rewst-mcp-token';
/** HTTP header carrying the bridge's protocol version for the handshake. */
export const MCP_PROTOCOL_HEADER = 'x-rewst-mcp-protocol';

export type McpAction = 'mcp.listTools' | 'mcp.callTool' | 'mcp.listResources' | 'mcp.readResource';

export interface McpListToolsRequest {
	action: 'mcp.listTools';
}

export interface McpCallToolRequest {
	action: 'mcp.callTool';
	name: string;
	orgId?: string;
	arguments?: Record<string, unknown>;
}

export interface McpListResourcesRequest {
	action: 'mcp.listResources';
}

export interface McpReadResourceRequest {
	action: 'mcp.readResource';
	uri: string;
}

export type McpRequest = McpListToolsRequest | McpCallToolRequest | McpListResourcesRequest | McpReadResourceRequest;

/** Stable error codes so the agent gets actionable messages, not opaque 500s. */
export type McpErrorCode =
	| 'mcp_disabled'
	| 'bad_token'
	| 'version_mismatch'
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

export interface McpErrorBody {
	code: McpErrorCode;
	message: string;
}

export type McpResponse =
	| { ok: true; protocolVersion: number; result: unknown }
	| { ok: false; protocolVersion: number; error: McpErrorBody };

/** True when the action string is one the MCP surface owns. */
export function isMcpAction(action: string): action is McpAction {
	return (
		action === 'mcp.listTools' ||
		action === 'mcp.callTool' ||
		action === 'mcp.listResources' ||
		action === 'mcp.readResource'
	);
}
