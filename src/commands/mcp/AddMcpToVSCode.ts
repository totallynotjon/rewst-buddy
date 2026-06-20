import { extPrefix } from '@global';
import { McpDefinitionProvider } from '@mcp';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

/** Palette ids VS Code has used for the MCP server list, tried in order. */
const MCP_LIST_COMMANDS = ['workbench.mcp.listServer', 'workbench.action.mcp.listServer', 'mcp.listServer'];

/**
 * Registers the extension's MCP server with VS Code's native MCP surface so it
 * shows up in the editor's server list ready to start — no config to copy or
 * paste. The native provider only advertises the server while
 * `rewst-buddy.mcp.enable` is on, so this turns that on when needed, refreshes the
 * provider, then offers to open VS Code's MCP server list. VS Code injects the
 * live localhost token itself via the provider, so there is no env-var step here.
 */
export class AddMcpToVSCode extends GenericCommand {
	commandName = 'AddMcpToVSCode';

	async execute(): Promise<void> {
		const mcpConfig = vscode.workspace.getConfiguration(`${extPrefix}.mcp`);
		const wasEnabled = mcpConfig.get<boolean>('enable', false);
		if (!wasEnabled) {
			await mcpConfig.update('enable', true, vscode.ConfigurationTarget.Global);
		}
		// Re-publish so VS Code picks up the now-enabled server immediately rather
		// than on its next eager poll.
		McpDefinitionProvider.refresh();
		log.info('AddMcpToVSCode: registered Rewst Buddy MCP server with VS Code');

		const message = wasEnabled
			? 'Rewst Buddy MCP server is registered with VS Code. Open the MCP server list to start it.'
			: 'Enabled and registered the Rewst Buddy MCP server with VS Code. Open the MCP server list to start it.';
		const choice = await vscode.window.showInformationMessage(message, 'Open MCP Servers');
		if (choice === 'Open MCP Servers') {
			await openMcpServerList();
		}
	}
}

/** Opens VS Code's MCP server list, falling back to a palette hint if absent. */
async function openMcpServerList(): Promise<void> {
	const available = await vscode.commands.getCommands(true);
	const command = MCP_LIST_COMMANDS.find(id => available.includes(id));
	if (command) {
		await vscode.commands.executeCommand(command);
		return;
	}
	vscode.window.showInformationMessage(
		'Run "MCP: List Servers" from the Command Palette to manage the Rewst Buddy server.',
	);
}
