import { callTool, listTools, McpError, readMcpSettings, type McpToolDescriptor } from '@mcp';
import type { ToolSpec } from '../tools/toolProtocol';

/**
 * Bridges Cage-Free Rewsty to the Rewst (buddy) tools the MCP server exposes,
 * WITHOUT routing them through VS Code's options.tools. VS Code caps a chat
 * request at 128 tools and silently drops the overflow, so when many built-in
 * tools are enabled the buddy MCP tools never reach the provider — the backend
 * then formats Rewst operations as its native server-side tool calls instead of
 * the local vscode-tool protocol. Advertising them here, sourced from the same
 * MCP surface, keeps them available regardless of the cap.
 *
 * The list mirrors the MCP exposure exactly: it is empty unless the MCP server
 * is switched on (rewst-buddy.mcp.enable), and write tools appear only when
 * their MCP toggles are on. Execution reuses {@link callTool}, so the write
 * allowlist, throttle, approval, and audit gates are identical to the MCP path.
 */

/** Converts MCP tool descriptors into the chat text protocol's tool specs. */
export function toolSpecsFromDescriptors(descriptors: readonly McpToolDescriptor[]): ToolSpec[] {
	return descriptors.map(descriptor => ({
		name: descriptor.name,
		description: descriptor.description,
		args: JSON.stringify(descriptor.inputSchema),
		inputSchema: descriptor.inputSchema,
	}));
}

/**
 * The buddy tools currently exposed over MCP, as chat tool specs. Empty when the
 * MCP server is disabled — the user opted out, so nothing is advertised.
 */
export function buddyChatToolSpecs(): ToolSpec[] {
	if (!readMcpSettings().enable) return [];
	return toolSpecsFromDescriptors(listTools());
}

/** A buddy tool's in-process result, normalized for the chat results message. */
export interface BuddyToolResult {
	text: string;
	isError: boolean;
}

/**
 * Runs one buddy tool in-process through the MCP capability surface. A thrown
 * McpError (unknown tool, rate limit, no session, disallowed write, …) is
 * captured as an error result so the backend turn can recover and report it,
 * rather than aborting the whole chat response.
 */
export async function runBuddyChatTool(
	name: string,
	args: Record<string, unknown>,
	orgId: string,
): Promise<BuddyToolResult> {
	try {
		// origin: 'chat' so a write's approval modal names Cage-Free Rewsty rather
		// than an external MCP client.
		const result = await callTool({ name, arguments: args, orgId, origin: 'chat' });
		return { text: result.text, isError: result.isError ?? false };
	} catch (error) {
		const message = error instanceof McpError || error instanceof Error ? error.message : String(error);
		return { text: message, isError: true };
	}
}
