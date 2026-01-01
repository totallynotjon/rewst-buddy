import { SessionManager } from '@client';
import { CommandInitiater } from '@commands';
import { onEditorChange, onRename, onSave } from '@events';
import { extPrefix, context as globalVSContext } from '@global';
import { Server } from '@server';
import { StatusBarIcon, RewstViewProvider, SessionTreeDataProvider } from '@ui';
import { log } from '@utils';
import vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	globalVSContext.init(context);

	log.init(context);

	log.info(`Starting activation of extension ${extPrefix}`);

	SessionManager.loadSessions();

	CommandInitiater.registerCommands();

	// Register TreeDataProvider (must be created first for RewstViewProvider to reference)
	const sessionTreeProvider = new SessionTreeDataProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('rewst-buddy.sessionTree', sessionTreeProvider),
	);

	// Register WebviewViewProvider (receives sessionTreeProvider to call refresh internally)
	const rewstViewProvider = new RewstViewProvider(context.extensionUri, sessionTreeProvider);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(RewstViewProvider.viewType, rewstViewProvider),
	);

	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(onSave));

	context.subscriptions.push(vscode.workspace.onDidRenameFiles(onRename));

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(onEditorChange));

	context.subscriptions.push(StatusBarIcon);

	await onEditorChange();

	// Start server if enabled
	await Server.startIfEnabled();

	// Listen for configuration changes to auto start/stop server
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration('rewst-buddy.server')) {
				await handleServerConfigChange();
			}
		}),
	);

	log.info(`Finished activation of extension ${extPrefix}`);
}

async function handleServerConfigChange(): Promise<void> {
	const config = vscode.workspace.getConfiguration('rewst-buddy.server');
	const enabled = config.get<boolean>('enabled', false);

	if (enabled && !Server.getStatus()) {
		await Server.start();
	} else if (!enabled && Server.getStatus()) {
		await Server.stop();
	}
}

export async function deactivate() {
	log.info('Deactivating rewst-buddy extension');
	await Server.stop();
}
