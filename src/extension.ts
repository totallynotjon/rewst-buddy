import { CommandInitiater } from '@commands';
import { extPrefix, context as globalVSContext } from '@global';
import { LinkManager, SyncManager, SyncOnSaveManager, TemplateMetadataStore } from '@models';
import { TemplateDefinitionProvider, TemplateHoverProvider } from './providers';
import { Server } from '@server';
import { SessionManager } from '@sessions';
import { RewstViewProvider, SessionTreeDataProvider, StatusBar } from '@ui';
import { log } from '@utils';
import vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	globalVSContext.init(context);
	log.init();

	log.info(`Starting activation of extension ${extPrefix}`);

	// Register TreeDataProvider (self-registers for session change events)
	const sessionTreeProvider = new SessionTreeDataProvider();
	context.subscriptions.push(
		sessionTreeProvider,
		vscode.window.registerTreeDataProvider('rewst-buddy.sessionTree', sessionTreeProvider),
	);

	// Register WebviewViewProvider
	const rewstViewProvider = new RewstViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(RewstViewProvider.viewType, rewstViewProvider),
	);

	// Register managers (self-register for their respective VS Code events)
	// Note: SessionManager must init before SyncManager so sessions are loaded first
	context.subscriptions.push(LinkManager.init());
	context.subscriptions.push(SyncOnSaveManager.init());
	context.subscriptions.push(await SessionManager.init());
	context.subscriptions.push(TemplateMetadataStore.init());
	context.subscriptions.push(SyncManager.init());
	context.subscriptions.push(await Server.init());
	context.subscriptions.push(new StatusBar());

	CommandInitiater.registerCommands();

	// Register DefinitionProvider for template({{guid}}) navigation
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider({ scheme: 'file' }, new TemplateDefinitionProvider()),
		vscode.languages.registerHoverProvider({ scheme: 'file' }, new TemplateHoverProvider()),
	);

	// Register MCP server definition provider for VS Code Copilot
	registerMcpProvider(context);

	log.info(`Finished activation of extension ${extPrefix}`);
}

function registerMcpProvider(context: vscode.ExtensionContext): void {
	// Guard: vscode.lm.registerMcpServerDefinitionProvider may not exist in all VS Code forks
	if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function') {
		log.debug('MCP server definition provider API not available');
		return;
	}

	const emitter = new vscode.EventEmitter<void>();
	const config = vscode.workspace.getConfiguration('rewst-buddy.server');
	const host = config.get<string>('host', '127.0.0.1');
	const port = config.get<number>('port', 27121);
	const version = context.extension?.packageJSON?.version ?? '0.0.0';

	const provider = vscode.lm.registerMcpServerDefinitionProvider('rewst-buddy-mcp', {
		onDidChangeMcpServerDefinitions: emitter.event,
		provideMcpServerDefinitions() {
			const mcpEnabled = vscode.workspace.getConfiguration('rewst-buddy.mcp').get<boolean>('enabled', true);

			if (!mcpEnabled) return [];

			return [
				new vscode.McpHttpServerDefinition(
					'Rewst Buddy',
					vscode.Uri.parse(`http://${host}:${port}/mcp`),
					undefined,
					version,
				),
			];
		},
	});

	// Re-fire when relevant config changes
	const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('rewst-buddy.server') || e.affectsConfiguration('rewst-buddy.mcp')) {
			emitter.fire();
		}
	});

	context.subscriptions.push(provider, emitter, configWatcher);
}

export function deactivate() {
	log.info('Deactivating rewst-buddy extension');
	// Server.dispose() is called automatically via context.subscriptions
}
