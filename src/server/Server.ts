import { log } from '@utils';
import http, { IncomingMessage, ServerResponse } from 'http';
import vscode from 'vscode';
import { handleMcpHttp } from '../mcp/mcpServer';
import { readMcpSettings } from '../mcp/settings';
import { handleAnthropicHttp, isAnthropicProxyEnabled } from './anthropic/anthropicProxy';
import { getServerConfig, isLoopbackHost } from './config';
import { handleAddSession, handleOpenTemplate, validateRequest } from './handlers';
import { evaluateRequestGuard, requestGuardInputFromRequest } from './requestGuard';
import { BrowserRequest, Response, ServerConfig } from './types';

export const Server = new (class _ implements vscode.Disposable {
	private server: http.Server | null = null;
	private isRunning = false;
	/** In-flight bind, so concurrent start() calls share one listen (no self-collision). */
	private startPromise: Promise<boolean> | null = null;
	private disposables: vscode.Disposable[] = [];
	private readonly statusEmitter = new vscode.EventEmitter<boolean>();
	/** Fires true when the server binds, false when it stops or fails to bind. */
	readonly onDidChangeStatus = this.statusEmitter.event;

	constructor() {
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (
					e.affectsConfiguration('rewst-buddy.server') ||
					e.affectsConfiguration('rewst-buddy.ai.anthropicProxy')
				) {
					this.handleConfigChange();
				}
			}),
		);
	}
	init(): _ {
		// Start server in background if enabled
		this.startIfEnabled().catch(err => log.error('Server.init: failed to start', err));
		return this;
	}

	async dispose(): Promise<void> {
		// Await the stop so its close-callback status fire lands before the emitter
		// is disposed, instead of being silently dropped as a post-dispose no-op.
		await this.stop();
		this.statusEmitter.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	private async handleConfigChange(): Promise<void> {
		const wants = this.shouldStayRunning();
		if (wants && !this.isRunning) {
			await this.start(true);
		} else if (!wants && this.isRunning) {
			await this.stop();
		}
	}

	async startIfEnabled(): Promise<void> {
		const config = getServerConfig();
		if (config.enabled) {
			await this.start(true);
		}
	}

	/** The server stays up while any driver wants it: browser-action server, MCP, or Anthropic proxy. */
	private shouldStayRunning(): boolean {
		return getServerConfig().enabled || readMcpSettings().enable || isAnthropicProxyEnabled();
	}

	/**
	 * @param auto true for config/controller-driven starts, which self-correct if
	 * every driver was disabled mid-bind; false for an explicit user StartServer.
	 */
	async start(auto = false): Promise<boolean> {
		if (this.isRunning) {
			log.warn('Server.start: already running');
			return true;
		}
		// Activation calls start() twice in quick succession (Server.init and
		// McpServerController.init), both before isRunning flips true. Without this
		// guard each opens its own listen on the same port; the second loses with
		// EADDRINUSE and its error handler tears down the server the first just
		// bound. Sharing one in-flight promise makes the second caller await the
		// first bind instead of racing it.
		if (this.startPromise) {
			log.trace('Server.start: bind already in progress; awaiting it');
			return this.startPromise;
		}
		this.startPromise = this.bind();
		try {
			const started = await this.startPromise;
			// A disable toggled while the bind was in flight is skipped by
			// handleConfigChange (isRunning was still false), so re-check the final
			// config here and stop a server no driver wants anymore.
			if (started && auto && !this.shouldStayRunning()) {
				log.debug('Server.start: all drivers disabled during bind; stopping immediately');
				await this.stop();
				return false;
			}
			return started;
		} finally {
			this.startPromise = null;
		}
	}

	private async bind(): Promise<boolean> {
		log.trace('Server.start: starting');

		const config = getServerConfig();
		log.debug('Server.start: config', { host: config.host, port: config.port });

		if (!isLoopbackHost(config.host)) {
			log.notifyError(
				`Refusing to start the Rewst Buddy server: '${config.host}' is not a loopback host. ` +
					`Only localhost bindings are allowed (rewst-buddy.server.host).`,
			);
			return false;
		}

		try {
			this.server = http.createServer(this.handleRequest.bind(this));

			return await new Promise<boolean>(resolve => {
				this.server!.listen(config.port, config.host, () => {
					this.isRunning = true;
					log.info(`Server.start: listening on ${config.host}:${config.port}`);
					this.statusEmitter.fire(true);
					resolve(true);
				});

				this.server!.on('error', (err: NodeJS.ErrnoException) => {
					this.handleServerError(err, config);
					resolve(false);
				});
			});
		} catch (e) {
			log.error('Server.start: failed to create', e instanceof Error ? e : undefined);
			return false;
		}
	}

	async stop(): Promise<void> {
		log.trace('Server.stop: stopping');

		if (!this.server || !this.isRunning) {
			log.debug('Server.stop: not running');
			return;
		}

		return new Promise(resolve => {
			this.server!.close(() => {
				this.isRunning = false;
				this.server = null;
				log.info('Server.stop: stopped');
				this.statusEmitter.fire(false);
				resolve();
			});
		});
	}

	getStatus(): boolean {
		return this.isRunning;
	}

	private handleRequest(req: IncomingMessage, res: ServerResponse): void {
		log.trace('Server.handleRequest: incoming', { method: req.method, url: req.url });

		// The MCP Streamable HTTP transport owns the /mcp path: it reads the body
		// and writes its own headers/stream, so route it before the browser-action
		// handling sets any headers or consumes the request body.
		const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '');
		if (path === '/mcp') {
			void handleMcpHttp(req, res);
			return;
		}
		if (path === '/v1/messages' || path === '/v1/messages/count_tokens') {
			void handleAnthropicHttp(req, res);
			return;
		}

		res.setHeader('Content-Type', 'application/json');

		// Localhost-only control plane: reject before reading any body or
		// setting any CORS header, so a non-loopback Host/forwarded-host/web
		// origin can't ingest credentials or trigger actions. See the
		// credential-server spec's "Reject non-local HTTP requests" requirement.
		const guard = evaluateRequestGuard(requestGuardInputFromRequest(req));
		if (!guard.allowed) {
			log.warn('Server.handleRequest: rejected by request guard', { reason: guard.reason });
			this.sendResponse(res, 400, { success: false, error: 'Request rejected: not a local request' });
			return;
		}

		// Echo the caller's own Origin back instead of a wildcard, and only ever
		// after the guard above has validated it. No Origin header (e.g. the
		// browser extension's background/service-worker context) means no
		// browser is enforcing CORS for this response, so it's fine to omit.
		if (guard.allowedOrigin) {
			res.setHeader('Access-Control-Allow-Origin', guard.allowedOrigin);
		}
		res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			log.trace('Server.handleRequest: OPTIONS preflight');
			res.writeHead(204);
			res.end();
			return;
		}

		if (req.method !== 'POST') {
			log.debug('Server.handleRequest: method not allowed', req.method);
			this.sendResponse(res, 405, { success: false, error: 'Method not allowed. Use POST.' });
			return;
		}

		const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		let rejected = false;
		req.on('data', (chunk: Buffer) => {
			if (rejected) return;
			totalBytes += chunk.length;
			if (totalBytes > MAX_BODY_BYTES) {
				rejected = true;
				log.warn('Server.handleRequest: request body too large', { totalBytes });
				this.sendResponse(res, 413, { success: false, error: 'Request body too large' });
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			if (rejected) return;
			this.processRequest(Buffer.concat(chunks).toString('utf-8'), res);
		});
		req.on('error', err => {
			log.error('Server.handleRequest: request error', err);
			this.sendResponse(res, 500, { success: false, error: 'Request error' });
		});
	}

	private async processRequest(rawBody: string, res: ServerResponse): Promise<void> {
		log.trace('Server.processRequest: processing', { bodyLength: rawBody.length });

		if (!rawBody) {
			log.debug('Server.processRequest: empty body');
			this.sendResponse(res, 400, { success: false, error: 'Empty request body' });
			return;
		}

		let request: BrowserRequest;
		try {
			request = JSON.parse(rawBody);
			log.trace('Server.processRequest: parsed JSON', { action: request.action });
		} catch {
			log.warn('Server.processRequest: invalid JSON');
			this.sendResponse(res, 400, { success: false, error: 'Invalid JSON format' });
			return;
		}

		const validationError = validateRequest(request);
		if (validationError) {
			log.debug('Server.processRequest: validation failed', validationError);
			this.sendResponse(res, 400, { success: false, error: validationError });
			return;
		}

		switch (request.action) {
			case 'addSession':
				log.debug('Server.processRequest: handling addSession');
				await handleAddSession(request, res, this.sendResponse.bind(this));
				break;
			case 'openTemplate':
				log.debug('Server.processRequest: handling openTemplate');
				await handleOpenTemplate(request, res, this.sendResponse.bind(this));
				break;
			default:
				log.debug('Server.processRequest: unknown action', (request as { action: string }).action);
				this.sendResponse(res, 400, {
					success: false,
					error: `Unknown action: ${(request as { action: string }).action}`,
				});
		}
	}

	private sendResponse(res: ServerResponse, statusCode: number, body: Response): void {
		log.trace('Server.sendResponse', { statusCode, success: body.success });
		res.writeHead(statusCode);
		res.end(JSON.stringify(body));
	}

	private handleServerError(err: NodeJS.ErrnoException, config: ServerConfig): void {
		log.debug('Server.handleServerError', { code: err.code, message: err.message });

		if (err.code === 'EADDRINUSE') {
			log.notifyError(
				`Port ${config.port} is already in use. ` +
					`Are multiple VSCode windows open? ` +
					`Try changing the port in settings: rewst-buddy.server.port`,
			);
		} else if (err.code === 'EACCES') {
			log.notifyError(`Permission denied for port ${config.port}. Try using a port above 1024.`);
		} else {
			log.notifyError(`Server error: ${err.message}`);
		}
		this.isRunning = false;
		this.server = null;
		this.statusEmitter.fire(false);
	}
})();
