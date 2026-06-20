import { extPrefix } from '@global';
import { Server, getServerConfig } from '@server';
import { log } from '@utils';
import vscode from 'vscode';
import { readMcpSettings } from './settings';

/**
 * Keeps the localhost server running whenever the MCP server is enabled. The MCP
 * Streamable HTTP transport is mounted on that server at /mcp (see mcpServer.ts),
 * so MCP needs the server bound even if the browser-extension server
 * (rewst-buddy.server.enabled) is off. The token is persisted (runtime.ts) and
 * the client config carries the live URL, so there is no discovery file to keep
 * in step.
 */
export const McpServerController = new (class _ implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];

	init(): this {
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration(event => {
				if (
					event.affectsConfiguration(`${extPrefix}.mcp`) ||
					event.affectsConfiguration(`${extPrefix}.server`)
				) {
					this.sync().catch(error => log.error('McpServerController.sync failed', error));
				}
			}),
		);
		this.sync().catch(error => log.error('McpServerController.init sync failed', error));
		return this;
	}

	dispose(): void {
		this.disposables.forEach(disposable => disposable.dispose());
		this.disposables = [];
	}

	/**
	 * Reconciles the localhost server with the MCP switch: starts it when MCP is
	 * enabled, and stops a server that was running only for MCP once MCP is turned
	 * off and the browser-action server does not want it either.
	 */
	private async sync(): Promise<void> {
		if (!readMcpSettings().enable) {
			if (Server.getStatus() && !getServerConfig().enabled) await Server.stop();
			return;
		}
		if (!Server.getStatus()) await Server.start(true);
	}
})();
