import { extPrefix } from '@global';
import { formatHostPort, getServerConfig } from '@server';
import { log } from '@utils';
import vscode from 'vscode';
import { mcpAuthorizationHeader } from './protocol';
import { getMcpToken } from './runtime';
import { readMcpSettings } from './settings';

/** Human-readable name shown in VS Code's MCP server list. */
const SERVER_LABEL = 'Rewst Buddy';

/**
 * Provider id wiring the runtime registration to the
 * `contributes.mcpServerDefinitionProviders` entry in package.json. VS Code
 * matches the two by this id, so they must stay in sync.
 */
export const MCP_DEFINITION_PROVIDER_ID = 'rewst-buddy.mcpServer';

/**
 * Publishes the in-extension MCP server to VS Code's own MCP surface so the user
 * gets it in the editor's MCP server list without copying any config. The server
 * is advertised only while `rewst-buddy.mcp.enable` is on, so a disabled endpoint
 * never shows up as a broken entry. VS Code is the client here, so the live
 * localhost token is injected straight into the `Authorization: Bearer` header —
 * there is no need for the credential-free env-var indirection the external-client
 * config uses, and the token is never written to a config file (the provider is
 * re-queried on demand).
 */
export const McpDefinitionProvider = new (class _ implements vscode.McpServerDefinitionProvider, vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	/** VS Code re-reads the definitions whenever this fires. */
	readonly onDidChangeMcpServerDefinitions = this.changeEmitter.event;

	init(): vscode.Disposable {
		this.disposables.push(
			this.changeEmitter,
			vscode.workspace.onDidChangeConfiguration(event => {
				if (
					event.affectsConfiguration(`${extPrefix}.mcp`) ||
					event.affectsConfiguration(`${extPrefix}.server`)
				) {
					this.refresh();
				}
			}),
		);
		// engines.vscode floors at 1.122, but guard so a host without the provider
		// API degrades to "no native registration" instead of crashing activation.
		if (typeof vscode.lm?.registerMcpServerDefinitionProvider === 'function') {
			this.disposables.push(vscode.lm.registerMcpServerDefinitionProvider(MCP_DEFINITION_PROVIDER_ID, this));
		} else {
			log.warn('McpDefinitionProvider: VS Code MCP provider API unavailable; skipping native registration');
		}
		return this;
	}

	/** Re-publish after the enable switch, port, host, or token changes. */
	refresh(): void {
		this.changeEmitter.fire();
	}

	provideMcpServerDefinitions(): vscode.McpServerDefinition[] {
		const settings = readMcpSettings();
		if (!settings.enable) return [];
		const { host, port } = getServerConfig();
		const uri = vscode.Uri.parse(`http://${formatHostPort(host, port)}/mcp`);
		const headers = { Authorization: mcpAuthorizationHeader(getMcpToken()) };
		// The version tells VS Code when to restart its connection to the server and
		// re-fetch the tool list. Tie it to the endpoint AND the exposure toggles so
		// flipping the write/dangerous switches changes the advertised tool set in
		// chat without a manual reconnect. The token stays out so it is never
		// surfaced where the version is shown or logged.
		const exposure = `w${settings.enableWriteTools ? 1 : 0}d${settings.enableDangerousGraphqlMutation ? 1 : 0}`;
		const version = `${host}:${port}:${exposure}`;
		return [new vscode.McpHttpServerDefinition(SERVER_LABEL, uri, headers, version)];
	}

	dispose(): void {
		this.disposables.forEach(disposable => disposable.dispose());
		this.disposables = [];
	}
})();
