import { log } from '@utils';
import http, { IncomingMessage, ServerResponse } from 'http';
import vscode from 'vscode';
import { getServerConfig } from './config';
import { handleAddSession, validateRequest } from './handlers';
import { AddSessionRequest, Response, ServerConfig } from './types';

export const Server = new (class _ implements vscode.Disposable {
	private server: http.Server | null = null;
	private isRunning = false;
	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('rewst-buddy.server')) {
					this.handleConfigChange();
				}
			}),
		);
	}
	async init(): Promise<_> {
		// Start server if enabled
		await this.startIfEnabled();
		return this;
	}

	dispose(): void {
		this.stop();
		this.disposables.forEach(d => d.dispose());
	}

	private async handleConfigChange(): Promise<void> {
		const config = getServerConfig();
		if (config.enabled && !this.isRunning) {
			await this.start();
		} else if (!config.enabled && this.isRunning) {
			await this.stop();
		}
	}

	async startIfEnabled(): Promise<void> {
		const config = getServerConfig();
		if (config.enabled) {
			await this.start();
		}
	}

	async start(): Promise<boolean> {
		if (this.isRunning) {
			log.warn('Server is already running');
			return true;
		}

		const config = getServerConfig();

		try {
			this.server = http.createServer(this.handleRequest.bind(this));

			return new Promise(resolve => {
				this.server!.listen(config.port, config.host, () => {
					this.isRunning = true;
					log.info(`Server listening on ${config.host}:${config.port}`);
					resolve(true);
				});

				this.server!.on('error', (err: NodeJS.ErrnoException) => {
					this.handleServerError(err, config);
					resolve(false);
				});
			});
		} catch (e) {
			log.error('Failed to create Server', e instanceof Error ? e : undefined);
			return false;
		}
	}

	async stop(): Promise<void> {
		if (!this.server || !this.isRunning) {
			log.debug('Server is not running');
			return;
		}

		return new Promise(resolve => {
			this.server!.close(() => {
				this.isRunning = false;
				this.server = null;
				log.info('Server stopped');
				resolve();
			});
		});
	}

	getStatus(): boolean {
		return this.isRunning;
	}

	private handleRequest(req: IncomingMessage, res: ServerResponse): void {
		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		if (req.method !== 'POST') {
			this.sendResponse(res, 405, { success: false, error: 'Method not allowed. Use POST.' });
			return;
		}

		let rawBody = '';
		req.on('data', chunk => (rawBody += chunk));
		req.on('end', () => this.processRequest(rawBody, res));
		req.on('error', err => {
			log.error('Request error', err);
			this.sendResponse(res, 500, { success: false, error: 'Request error' });
		});
	}

	private async processRequest(rawBody: string, res: ServerResponse): Promise<void> {
		log.debug('Server received request');

		if (!rawBody) {
			this.sendResponse(res, 400, { success: false, error: 'Empty request body' });
			return;
		}

		let request: AddSessionRequest;
		try {
			request = JSON.parse(rawBody);
		} catch {
			log.warn('Invalid JSON in request');
			this.sendResponse(res, 400, { success: false, error: 'Invalid JSON format' });
			return;
		}

		const validationError = validateRequest(request);
		if (validationError) {
			this.sendResponse(res, 400, { success: false, error: validationError });
			return;
		}

		if (request.action === 'addSession') {
			await handleAddSession(request, res, this.sendResponse.bind(this));
		} else {
			this.sendResponse(res, 400, {
				success: false,
				error: `Unknown action: ${(request as { action: string }).action}`,
			});
		}
	}

	private sendResponse(res: ServerResponse, statusCode: number, body: Response): void {
		res.writeHead(statusCode);
		res.end(JSON.stringify(body));
	}

	private handleServerError(err: NodeJS.ErrnoException, config: ServerConfig): void {
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
	}
})();
