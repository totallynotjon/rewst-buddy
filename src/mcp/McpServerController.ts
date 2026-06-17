import { context, extPrefix } from '@global';
import { Server } from '@server';
import { log } from '@utils';
import vscode from 'vscode';
import { removeDiscovery, writeDiscovery } from './discovery';
import { MCP_PROTOCOL_VERSION } from './protocol';
import { clearMcpToken, getMcpToken, rotateMcpToken } from './runtime';
import { readMcpSettings } from './settings';

/**
 * Owns the MCP server's runtime lifecycle in this extension host: rotates the
 * per-activation token, and keeps the ~/.rewst-buddy/mcp.json discovery file in
 * step with whether this window actually owns the localhost port.
 *
 * Multiple VS Code windows each run their own host but share one discovery file.
 * Only the window that successfully bound the port (Server.getStatus() === true)
 * writes the file, and a window only removes a file it wrote, so a window that
 * lost the bind (EADDRINUSE) never clobbers the real owner's entry.
 */
export const McpServerController = new (class _ implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private wroteDiscovery = false;

	init(): this {
		rotateMcpToken();
		this.disposables.push(
			Server.onDidChangeStatus(running => this.onServerStatus(running)),
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
		if (this.wroteDiscovery) {
			try {
				removeDiscovery();
			} catch (error) {
				log.debug('McpServerController.dispose: removeDiscovery failed', error);
			}
			this.wroteDiscovery = false;
		}
		clearMcpToken();
		this.disposables.forEach(disposable => disposable.dispose());
		this.disposables = [];
	}

	/** Reconciles the discovery file with the current settings + server state. */
	private async sync(): Promise<void> {
		const settings = readMcpSettings();
		if (!settings.enable) {
			this.clearDiscovery();
			return;
		}
		// MCP reuses the localhost server; start it if the user enabled MCP but the
		// server is not already running. The status event writes discovery on bind.
		if (!Server.getStatus()) {
			await Server.start();
			return;
		}
		this.writeDiscoveryNow();
	}

	private onServerStatus(running: boolean): void {
		if (running) {
			if (readMcpSettings().enable) this.writeDiscoveryNow();
		} else {
			this.clearDiscovery();
		}
	}

	private writeDiscoveryNow(): void {
		const address = Server.getBoundAddress();
		const token = getMcpToken();
		if (!address || !token) return;
		try {
			writeDiscovery({
				port: address.port,
				host: address.host,
				token,
				pid: process.pid,
				extensionVersion: this.extensionVersion(),
				protocolVersion: MCP_PROTOCOL_VERSION,
				writtenAt: new Date().toISOString(),
			});
			this.wroteDiscovery = true;
			log.info(`MCP discovery written for ${address.host}:${address.port}`);
		} catch (error) {
			log.error('McpServerController: failed to write discovery file', error);
		}
	}

	private clearDiscovery(): void {
		if (!this.wroteDiscovery) return;
		try {
			removeDiscovery();
		} catch (error) {
			log.debug('McpServerController: removeDiscovery failed', error);
		}
		this.wroteDiscovery = false;
	}

	private extensionVersion(): string {
		try {
			return (context.extension?.packageJSON?.version as string) ?? '0.0.0';
		} catch {
			return '0.0.0';
		}
	}
})();
