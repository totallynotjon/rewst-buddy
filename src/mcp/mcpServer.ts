import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
	CallToolRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { log } from '@utils';
import type { IncomingMessage, ServerResponse } from 'http';
import { formatHostPort, getServerConfig } from '../server/config';
import { callTool, listResources, listTools, McpError, readResource } from './McpActions';
import { buildMcpInstructions, MCP_PROMPTS, renderMcpPrompt } from './instructions';
import { MCP_PROTOCOL_VERSION, parseBearerToken } from './protocol';
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

/**
 * The MCP SDK requires every tool's inputSchema to be a JSON Schema object
 * (`{ type: 'object', … }`). Capabilities are authored that way, but guard the
 * cast so a malformed schema degrades to an empty object schema instead of
 * shipping an invalid shape to the client.
 */
function toObjectSchema(schema: object): { type: 'object' } {
	if (typeof schema === 'object' && schema !== null && (schema as { type?: unknown }).type === 'object') {
		return schema as { type: 'object' };
	}
	return { type: 'object', properties: {} } as { type: 'object' };
}

/** Builds an MCP SDK Server bound to the current settings. */
export function buildMcpServer(): Server {
	const settings = readMcpSettings();
	const server = new Server(SERVER_INFO, {
		capabilities: { tools: {}, resources: {}, prompts: {} },
		instructions: buildMcpInstructions(),
	});

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: listTools(settings).map(tool => ({
			name: tool.name,
			description: tool.description,
			inputSchema: toObjectSchema(tool.inputSchema),
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

	server.setRequestHandler(ListPromptsRequestSchema, () => ({
		prompts: MCP_PROMPTS.map(p => ({
			name: p.name,
			description: p.description,
			arguments: p.arguments,
		})),
	}));

	server.setRequestHandler(GetPromptRequestSchema, request => {
		try {
			const args = (request.params.arguments ?? {}) as Record<string, string>;
			const text = renderMcpPrompt(request.params.name, args);
			return {
				messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(message);
		}
	});

	server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: listResources() }));

	server.setRequestHandler(ReadResourceRequestSchema, async request => {
		try {
			const content = await readResource(request.params.uri);
			return { contents: [{ uri: content.uri, mimeType: content.mimeType, text: content.text }] };
		} catch (error) {
			// The MCP resource result has no isError field, so turn a gate failure
			// (unknown_tool, rate_limited, …) into a JSON-RPC error carrying the
			// readable reason instead of leaking an opaque McpError shape.
			const message =
				error instanceof McpError ? error.message : error instanceof Error ? error.message : String(error);
			throw new Error(message);
		}
	});

	return server;
}

/** node lowercases header names; a repeated header arrives as an array. */
function firstHeader(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

/**
 * Host header allowlist for DNS-rebinding protection. Always allows the loopback
 * names; the configured host is added only when it is a real bindable host, never
 * a wildcard (0.0.0.0 / ::) — accepting a wildcard Host would defeat the guard.
 */
function allowedHosts(host: string, port: number): string[] {
	const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
	const trimmed = host.trim();
	const wildcards = new Set(['0.0.0.0', '::', '[::]', '']);
	const hostWithPort = formatHostPort(trimmed, port);
	if (!wildcards.has(trimmed) && !hosts.includes(hostWithPort)) {
		hosts.push(hostWithPort);
	}
	return hosts;
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
	if (!isValidMcpToken(parseBearerToken(firstHeader(req.headers.authorization)))) {
		writeJson(res, 401, {
			error: {
				code: 'bad_token',
				message:
					'Invalid or missing MCP token in the Authorization header. Regenerate the client config in VS Code.',
			},
		});
		return;
	}

	const { host, port } = getServerConfig();
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
		enableDnsRebindingProtection: true,
		allowedHosts: allowedHosts(host, port),
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
