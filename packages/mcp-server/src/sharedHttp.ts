import { randomBytes, randomUUID } from 'node:crypto';
import {
	createServer as createNodeServer,
	type IncomingMessage,
	type Server as NodeServer,
	type ServerResponse,
} from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpServer } from './mcpServer';
import { MCP_RESULT_CACHE_TTL_MS, McpResultCache } from './capabilities/resultReadCapability';
import {
	defaultDiscoveryDir,
	publishSharedServer,
	sharedServerProof,
	withdrawSharedServer,
	type SharedServerDescriptor,
} from './sharedDiscovery';

const MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_VERSION = '0.1.0';

export interface SharedHttpOptions {
	port: number;
	discoveryDir?: string;
	publicToken?: string;
	publicEnabled?: () => boolean;
	createEditorServer: () => Server;
	handleBrowserAction?: (body: Record<string, unknown>) => Promise<unknown>;
	version?: string;
	/** Optional gate for runtime/session initialization. Discovery remains available while it is pending. */
	ready?: Promise<void>;
}

export interface SharedHttpHandle {
	descriptor: SharedServerDescriptor;
	setPublicToken(token: string): Promise<void>;
	close(): Promise<void>;
}

type Pair =
	| { server: Server; transport: StreamableHTTPServerTransport; kind: 'mcp'; sessionId: string }
	| { server: Server; transport: StreamableHTTPServerTransport; kind: 'editor'; sessionId: string };

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function hostAllowed(value: string | string[] | undefined, port: number): boolean {
	const host = first(value)?.toLowerCase();
	return host === `localhost:${port}` || host === `127.0.0.1:${port}` || host === `[::1]:${port}`;
}

function loopbackOrigin(value: string | string[] | undefined, port: number): boolean {
	const origin = first(value);
	if (!origin) return true;
	try {
		const url = new URL(origin);
		return (
			(url.protocol === 'http:' || url.protocol === 'https:') &&
			(url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') &&
			url.port === String(port)
		);
	} catch {
		return false;
	}
}

function extensionOrigin(value: string | string[] | undefined): boolean {
	const origin = first(value);
	if (!origin) return true;
	try {
		const url = new URL(origin);
		return (
			(url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') &&
			/^[A-Za-z0-9._-]{8,128}$/.test(url.hostname) &&
			(url.pathname === '' || url.pathname === '/')
		);
	} catch {
		return false;
	}
}

function forwarded(req: IncomingMessage): boolean {
	return Boolean(
		req.headers['forwarded'] ||
		req.headers['x-forwarded-host'] ||
		req.headers['x-forwarded-for'] ||
		req.headers['x-forwarded-proto'],
	);
}

function jsonContentType(req: IncomingMessage): boolean {
	const contentType = first(req.headers['content-type']);
	return typeof contentType === 'string' && /^application\/json(?:\s*;|\s*$)/i.test(contentType);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		size += buffer.length;
		if (size > MAX_JSON_BYTES) throw new Error('JSON request exceeds 1 MiB limit');
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString('utf8');
	const parsed: unknown = JSON.parse(text || '{}');
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
		throw new Error('JSON request must be an object');
	return parsed as Record<string, unknown>;
}

function writeJson(res: ServerResponse, status: number, body: unknown, origin?: string): void {
	const headers: Record<string, string> = {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	};
	if (origin) {
		headers['access-control-allow-origin'] = origin;
		headers.vary = 'Origin';
	}
	res.writeHead(status, headers);
	res.end(JSON.stringify(body));
}

function safeError(error: unknown, fallback: string): { error: string } {
	// Do not echo request data: browser requests contain session cookies.
	return { error: fallback };
}

function bearer(value: string | string[] | undefined): string | undefined {
	const match = /^Bearer[ \t]+(\S+)$/i.exec(first(value)?.trim() || '');
	return match?.[1];
}

function corsOptions(
	req: IncomingMessage,
	res: ServerResponse,
	allowed: (origin: string | undefined) => boolean,
): boolean {
	if (req.method !== 'OPTIONS') return false;
	const origin = first(req.headers.origin);
	if (origin && allowed(origin)) {
		res.writeHead(204, {
			'access-control-allow-origin': origin,
			'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
			'access-control-allow-headers': 'Authorization, Content-Type, MCP-Session-Id',
			'access-control-max-age': '600',
			vary: 'Origin',
		});
		res.end();
	} else {
		res.writeHead(403, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: 'origin not allowed' }));
	}
	return true;
}

export async function startSharedHttpServer(options: SharedHttpOptions): Promise<SharedHttpHandle> {
	if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
		throw new TypeError(`Invalid shared server port: ${options.port}`);
	let activePublicToken = options.publicToken || randomBytes(32).toString('hex');
	const editorToken = randomBytes(32).toString('hex');
	const descriptor: SharedServerDescriptor = {
		identity: 'rewst-buddy',
		protocol: 1,
		version: options.version || DEFAULT_VERSION,
		instanceId: randomUUID(),
		port: options.port,
		publicToken: activePublicToken,
		editorToken,
	};
	const pairs = new Map<string, Pair>();
	// Stateful transports retain their server. Stateless transports do not, so
	// keep results at the HTTP process boundary and partition them by the actual
	// keep-alive connection that carried the request.
	const httpResultCache = new McpResultCache();
	const httpClientIds = new WeakMap<object, string>();
	const resultClientIdFor = (req: IncomingMessage): string => {
		let id = httpClientIds.get(req.socket);
		if (!id) {
			id = randomUUID();
			httpClientIds.set(req.socket, id);
		}
		return id;
	};
	const resultCacheCleanup = setInterval(
		() => httpResultCache.pruneExpired(),
		Math.min(MCP_RESULT_CACHE_TTL_MS, 60_000),
	);
	resultCacheCleanup.unref();
	const closingPairs = new WeakSet<object>();
	const closePair = (pair: Pair): void => {
		if (closingPairs.has(pair)) return;
		closingPairs.add(pair);
		pairs.delete(`${pair.kind}:${pair.sessionId}`);
		void pair.server.close().catch(() => undefined);
	};
	const nodeServer: NodeServer = createNodeServer(async (req, res) => {
		let url: URL;
		try {
			url = new URL(req.url || '/', `http://127.0.0.1:${options.port}`);
		} catch {
			writeJson(res, 400, { error: 'invalid request URL' });
			return;
		}
		const path = url.pathname;
		if (forwarded(req) || !hostAllowed(req.headers.host, options.port)) {
			writeJson(res, 403, { error: 'localhost host required' });
			return;
		}
		if (path === '/.well-known/rewst-buddy') {
			const challenge = url.searchParams.get('challenge');
			if (!challenge || challenge.length > 512) {
				writeJson(res, 400, { error: 'challenge required' });
				return;
			}
			writeJson(res, 200, {
				identity: descriptor.identity,
				protocol: descriptor.protocol,
				version: descriptor.version,
				instanceId: descriptor.instanceId,
				proof: sharedServerProof(editorToken, challenge),
			});
			return;
		}

		if (path === '/mcp') {
			if (corsOptions(req, res, origin => loopbackOrigin(origin, options.port))) return;
			if (!loopbackOrigin(req.headers.origin, options.port)) {
				writeJson(res, 403, { error: 'localhost origin required' });
				return;
			}
			if (options.publicEnabled && !options.publicEnabled()) {
				writeJson(res, 403, { error: 'public MCP is disabled' });
				return;
			}
			if (bearer(req.headers.authorization) !== activePublicToken) {
				writeJson(res, 401, { error: 'invalid or missing bearer token' });
				return;
			}
			if (req.method === 'POST' && !jsonContentType(req)) {
				writeJson(res, 415, { error: 'application/json content type required' });
				return;
			}
			const sessionId = first(req.headers['mcp-session-id']);
			let pair = sessionId ? pairs.get(`mcp:${sessionId}`) : undefined;
			if (sessionId && (!pair || pair.kind !== 'mcp')) {
				writeJson(res, 404, { error: 'unknown MCP session' });
				return;
			}
			if (!pair) {
				try {
					await options.ready;
				} catch {
					writeJson(res, 503, { error: 'MCP request unavailable' });
					return;
				}
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					enableJsonResponse: true,
				});
				const server = createMcpServer({
					resultCache: httpResultCache,
					resultClientId: resultClientIdFor(req),
				});
				pair = { server, transport, kind: 'mcp', sessionId: '' };
				transport.onclose = () => {
					closePair(pair as Pair);
				};
				try {
					await server.connect(transport);
					const body = req.method === 'POST' ? await readJson(req) : undefined;
					await transport.handleRequest(req, res, body);
					if (transport.sessionId) {
						pair.sessionId = transport.sessionId;
						pairs.set(`mcp:${pair.sessionId}`, pair);
					} else {
						await transport.close().catch(() => undefined);
						await server.close().catch(() => undefined);
					}
				} catch (error) {
					await transport.close().catch(() => undefined);
					if (!res.headersSent)
						writeJson(
							res,
							error instanceof Error && error.message.includes('1 MiB') ? 413 : 503,
							safeError(error, 'MCP request unavailable'),
						);
				}
				return;
			}
			try {
				await options.ready;
				const body = req.method === 'POST' ? await readJson(req) : undefined;
				if (pair.kind === 'mcp') await pair.transport.handleRequest(req, res, body);
			} catch (error) {
				if (!res.headersSent)
					writeJson(
						res,
						error instanceof Error && error.message.includes('1 MiB') ? 413 : 503,
						safeError(error, 'MCP request unavailable'),
					);
			}
			return;
		}

		if (path === '/editor' || path === '/editor/messages') {
			if (first(req.headers.origin)) {
				writeJson(res, 403, { error: 'browser Origin is not allowed on editor endpoint' });
				return;
			}
			if (bearer(req.headers.authorization) !== editorToken) {
				writeJson(res, 401, { error: 'invalid or missing editor token' });
				return;
			}
			const sessionId = first(req.headers['mcp-session-id']) || url.searchParams.get('sessionId') || undefined;
			let pair = sessionId ? pairs.get(`editor:${sessionId}`) : undefined;
			if (sessionId && !pair) {
				writeJson(res, 404, { error: 'unknown editor session' });
				return;
			}
			if (req.method === 'POST' && !pair && path === '/editor') {
				if (!jsonContentType(req)) {
					writeJson(res, 415, { error: 'application/json content type required' });
					return;
				}
				let server: Server | undefined;
				let transport: StreamableHTTPServerTransport | undefined;
				try {
					await options.ready;
					server = options.createEditorServer();
					transport = new StreamableHTTPServerTransport({
						sessionIdGenerator: () => randomUUID(),
						// Conversation events use request-scoped notifications. JSON response
						// mode discards those notifications, so editor requests need SSE.
						enableJsonResponse: false,
					});
					pair = { server, transport, kind: 'editor', sessionId: '' };
					transport.onclose = () => closePair(pair as Pair);
					await server.connect(transport);
					await transport.handleRequest(req, res, await readJson(req));
					if (transport.sessionId) {
						pair.sessionId = transport.sessionId;
						pairs.set(`editor:${pair.sessionId}`, pair);
					} else {
						closingPairs.add(pair);
						await transport.close().catch(() => undefined);
						await server.close().catch(() => undefined);
					}
				} catch (error) {
					if (transport) await transport.close().catch(() => undefined);
					else await server?.close().catch(() => undefined);
					if (!res.headersSent)
						writeJson(
							res,
							error instanceof Error && error.message.includes('1 MiB') ? 413 : 503,
							safeError(error, 'Editor endpoint unavailable'),
						);
				}
				return;
			}
			if (
				(path === '/editor' || path === '/editor/messages') &&
				(req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE')
			) {
				if (req.method === 'POST' && !jsonContentType(req)) {
					writeJson(res, 415, { error: 'application/json content type required' });
					return;
				}
				if (!pair || pair.kind !== 'editor') {
					writeJson(res, 404, { error: 'unknown editor session' });
					return;
				}
				try {
					await options.ready;
					await pair.transport.handleRequest(
						req,
						res,
						req.method === 'POST' ? await readJson(req) : undefined,
					);
				} catch (error) {
					if (!res.headersSent)
						writeJson(
							res,
							error instanceof Error && error.message.includes('1 MiB') ? 413 : 503,
							safeError(error, 'Editor request unavailable'),
						);
				}
				return;
			}
			writeJson(res, 405, { error: 'method not allowed' });
			return;
		}

		if (path === '/') {
			const origin = first(req.headers.origin);
			if (corsOptions(req, res, origin => extensionOrigin(origin))) return;
			if (req.method !== 'POST') {
				writeJson(
					res,
					405,
					{ error: 'method not allowed' },
					origin && extensionOrigin(origin) ? origin : undefined,
				);
				return;
			}
			if (!extensionOrigin(origin)) {
				writeJson(res, 403, { error: 'browser extension origin required' });
				return;
			}
			if (!jsonContentType(req)) {
				writeJson(res, 415, { error: 'application/json content type required' }, origin);
				return;
			}
			if (!options.handleBrowserAction) {
				writeJson(res, 404, { error: 'browser action endpoint unavailable' }, origin);
				return;
			}
			try {
				await options.ready;
			} catch {
				writeJson(res, 503, { error: 'browser action unavailable' }, origin);
				return;
			}
			try {
				const result = await options.handleBrowserAction(await readJson(req));
				writeJson(res, 200, result ?? null, origin);
			} catch (error) {
				writeJson(
					res,
					error instanceof Error && error.message.includes('1 MiB') ? 413 : 400,
					safeError(error, 'Browser action failed'),
					origin,
				);
			}
			return;
		}
		writeJson(res, 404, { error: 'not found' });
	});

	try {
		await new Promise<void>((resolve, reject) => {
			nodeServer.once('error', reject);
			nodeServer.listen(options.port, '127.0.0.1', () => resolve());
		});
		await publishSharedServer(descriptor, options.discoveryDir || defaultDiscoveryDir());
	} catch (error) {
		clearInterval(resultCacheCleanup);
		httpResultCache.clear();
		await new Promise<void>(resolve => nodeServer.close(() => resolve())).catch(() => undefined);
		throw error;
	}

	let closed = false;
	return {
		descriptor,
		async setPublicToken(token: string): Promise<void> {
			if (typeof token !== 'string' || token.length === 0)
				throw new TypeError('Public token must be a non-empty string');
			activePublicToken = token;
			descriptor.publicToken = token;
			await publishSharedServer(descriptor, options.discoveryDir || defaultDiscoveryDir());
		},
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			clearInterval(resultCacheCleanup);
			httpResultCache.clear();
			const active = [...pairs.values()];
			pairs.clear();
			await Promise.all(
				active.map(async pair => {
					closingPairs.add(pair);
					await pair.transport.close().catch(() => undefined);
					await pair.server.close().catch(() => undefined);
				}),
			);
			await new Promise<void>(resolve => nodeServer.close(() => resolve())).catch(() => undefined);
			await withdrawSharedServer(
				descriptor.instanceId,
				descriptor.port,
				options.discoveryDir || defaultDiscoveryDir(),
			);
		},
	};
}
