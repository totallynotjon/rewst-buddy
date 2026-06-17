import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readDiscovery } from './discovery';
import {
	MCP_PROTOCOL_HEADER,
	MCP_PROTOCOL_VERSION,
	MCP_TOKEN_HEADER,
	type McpRequest,
	type McpResponse,
} from './protocol';

/**
 * Credential-free stdio MCP bridge. Spawned by an MCP client (Claude Desktop,
 * Claude Code, Cursor), it forwards tool calls over localhost HTTP to the
 * running Rewst Buddy extension, which holds the authenticated sessions. This
 * process never reads cookies or secrets — it discovers the live port + token
 * from ~/.rewst-buddy/mcp.json and attaches them as headers.
 */

const SERVER_INFO = { name: 'rewst-buddy', version: String(MCP_PROTOCOL_VERSION) };
const UNREACHABLE =
	'Rewst Buddy is not reachable. Open VS Code with the Rewst Buddy extension running and set rewst-buddy.mcp.enable to true.';

export class BridgeError extends Error {}

/** Whether a pid is still a live process (best-effort; pids can be reused). */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but we cannot signal it — still alive.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** Forwards one MCP request to the extension server, or throws BridgeError. */
async function callExtension(request: McpRequest): Promise<McpResponse> {
	const discovery = readDiscovery();
	if (!discovery) throw new BridgeError(UNREACHABLE);
	if (!isProcessAlive(discovery.pid)) throw new BridgeError(UNREACHABLE);

	let response: Response;
	try {
		response = await fetch(`http://${discovery.host}:${discovery.port}/`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				[MCP_TOKEN_HEADER]: discovery.token,
				[MCP_PROTOCOL_HEADER]: String(MCP_PROTOCOL_VERSION),
			},
			body: JSON.stringify(request),
		});
	} catch {
		throw new BridgeError(UNREACHABLE);
	}

	let body: McpResponse;
	try {
		body = (await response.json()) as McpResponse;
	} catch {
		throw new BridgeError(`Rewst Buddy returned an unreadable response (HTTP ${response.status}).`);
	}
	return body;
}

/** Unwraps an ok response or throws the structured error message. */
function expectOk(response: McpResponse): unknown {
	if (response.ok) return response.result;
	throw new BridgeError(response.error.message);
}

/** A function that forwards one MCP request to the extension. */
export type ExtensionCall = (request: McpRequest) => Promise<McpResponse>;

export async function handleListTools(call: ExtensionCall): Promise<{ tools: unknown[] }> {
	const result = expectOk(await call({ action: 'mcp.listTools' })) as { tools: unknown[] };
	return { tools: result.tools };
}

// orgId travels inside arguments (the tool inputSchema requires it); the
// extension reads it there. Tool-execution errors come back as ok responses with
// isError set, which we surface as isError content so the agent can read them.
export async function handleCallTool(
	call: ExtensionCall,
	params: { name: string; arguments?: Record<string, unknown> },
): Promise<{ content: { type: 'text'; text: string }[]; isError: boolean }> {
	const response = await call({
		action: 'mcp.callTool',
		name: params.name,
		arguments: params.arguments ?? {},
	});
	if (!response.ok) {
		return { content: [{ type: 'text', text: response.error.message }], isError: true };
	}
	const result = response.result as { text: string; isError?: boolean };
	return { content: [{ type: 'text', text: result.text }], isError: result.isError === true };
}

export async function handleListResources(call: ExtensionCall): Promise<{ resources: unknown[] }> {
	const result = expectOk(await call({ action: 'mcp.listResources' })) as { resources: unknown[] };
	return { resources: result.resources };
}

export async function handleReadResource(
	call: ExtensionCall,
	params: { uri: string },
): Promise<{ contents: { uri: string; mimeType?: string; text: string }[] }> {
	const result = expectOk(await call({ action: 'mcp.readResource', uri: params.uri })) as {
		uri: string;
		mimeType?: string;
		text: string;
	};
	return { contents: [{ uri: result.uri, mimeType: result.mimeType, text: result.text }] };
}

export function createBridgeServer(call: ExtensionCall = callExtension): Server {
	const server = new Server(SERVER_INFO, { capabilities: { tools: {}, resources: {} } });
	server.setRequestHandler(ListToolsRequestSchema, () => handleListTools(call));
	server.setRequestHandler(CallToolRequestSchema, request => handleCallTool(call, request.params));
	server.setRequestHandler(ListResourcesRequestSchema, () => handleListResources(call));
	server.setRequestHandler(ReadResourceRequestSchema, request => handleReadResource(call, request.params));
	return server;
}

/** Builds the bridge server and attaches it to stdio. Called by the CLI entry. */
export async function runBridge(): Promise<void> {
	const server = createBridgeServer();
	await server.connect(new StdioServerTransport());
}
