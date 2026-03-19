import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { IncomingMessage, ServerResponse } from 'http';
import { mcpServer } from './McpServer';
import { log } from '@utils';

export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
	log.trace('handleMcpRequest: incoming', { method: req.method, url: req.url });

	try {
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		await mcpServer.server.connect(transport);

		if (req.method === 'POST') {
			const body = await readBody(req);
			let parsed: unknown;
			try {
				parsed = JSON.parse(body);
			} catch {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Invalid JSON' }));
				return;
			}
			await transport.handleRequest(req, res, parsed);
		} else if (req.method === 'GET' || req.method === 'DELETE') {
			await transport.handleRequest(req, res);
		} else {
			res.writeHead(405, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Method not allowed' }));
		}
	} catch (error) {
		log.error('handleMcpRequest: error', error instanceof Error ? error : undefined);
		if (!res.headersSent) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Internal server error' }));
		}
	}
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (chunk: Buffer) => (data += chunk.toString()));
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}
