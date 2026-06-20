import { log } from '@utils';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { getServerConfig } from '../server/config';
import { callTool, listResources, listTools, McpError, readResource } from './McpActions';
import { MCP_PROTOCOL_VERSION, MCP_TOKEN_HEADER } from './protocol';
import { isValidMcpToken } from './runtime';
import { readMcpSettings } from './settings';

/**
 * The MCP server, served from the extension host over HTTP (no separate
 * process, no stdio bridge). An MCP SDK Server whose request handlers call the
 * capability surface (McpActions) in-process, mounted on the existing localhost
 * server at /mcp via the Streamable HTTP transport. Cookies never leave the
 * extension host; clients connect by URL and present a localhost token header.
 */

const SERVER_INFO = { name: 'rewst-buddy', version: String(MCP_PROTOCOL_VERSION) };

/** Builds an MCP SDK Server bound to the current settings. */
export function buildMcpServer(): Server {
	const settings = readMcpSettings();
	const server = new Server(SERVER_INFO, { capabilities: { tools: {}, resources: {} } });

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: listTools(settings).map(tool => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema as { type: 'object' },
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async request => {
		try {
			const result = await callTool({
				name: request.params.name,
				arguments: request.params.arguments ?? {},
			});
			return { content: [{ type: 'text' as const, text: result.text }], isError: result.isError === true };
		} catch (error) {
			// Gate failures (unknown tool, write disabled, no session, …) surface as
			// an isError result so the agent reads the reason instead of a opaque
			// JSON-RPC error.
			const message =
				error instanceof McpError ? error.message : error instanceof Error ? error.message : String(error);
			return { content: [{ type: 'text' as const, text: message }], isError: true };
		}
	});

	server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: listResources() }));

	server.setRequestHandler(ReadResourceRequestSchema, async request => {
		const content = await readResource(request.params.uri);
		return { contents: [{ uri: content.uri, mimeType: content.mimeType, text: content.text }] };
	});

	return server;
}

/** node lowercases header names; a repeated header arrives as an array. */
function firstHeader(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
	res.writeHead(statusCode, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

/**
 * Handles one request to the /mcp endpoint. Gates on the master switch and the
 * localhost token, then hands the request to a fresh stateless MCP transport
 * (one server+transport per request, the documented stateless pattern). DNS
 * rebinding protection restricts the Host header to localhost.
 */
export async function handleMcpHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const settings = readMcpSettings();
	if (!settings.enable) {
		writeJson(res, 403, {
			error: { code: 'mcp_disabled', message: 'The MCP server is disabled (rewst-buddy.mcp.enable).' },
		});
		return;
	}
	if (!isValidMcpToken(firstHeader(req.headers[MCP_TOKEN_HEADER]))) {
		writeJson(res, 401, {
			error: {
				code: 'bad_token',
				message: 'Invalid or missing MCP token. Regenerate the client config in VS Code.',
			},
		});
		return;
	}

	const { host, port } = getServerConfig();
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
		enableDnsRebindingProtection: true,
		allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, `${host}:${port}`],
	});
	const server = buildMcpServer();
	res.on('close', () => {
		void transport.close();
		void server.close();
	});
	try {
		await server.connect(transport);
		await transport.handleRequest(req, res);
	} catch (error) {
		log.error('MCP HTTP request failed', error instanceof Error ? error : undefined);
		if (!res.headersSent) {
			writeJson(res, 500, { error: { code: 'internal', message: 'MCP request failed.' } });
		}
	}
}
