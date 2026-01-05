import { CommandInitiater } from '@commands';
import { extPrefix, context as globalVSContext } from '@global';
import { LinkManager, SyncOnSaveManager, TemplateSyncManager } from '@models';
import { Server } from '@server';
import { SessionManager } from '@sessions';
import { RewstViewProvider, SessionTreeDataProvider, StatusBar } from '@ui';
import { log } from '@utils';
import vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	globalVSContext.init(context);

	log.init(context);

	log.info(`Starting activation of extension ${extPrefix}`);

	CommandInitiater.registerCommands();

	// Register managers (self-register for their respective VS Code events)
	context.subscriptions.push(LinkManager.init());
	context.subscriptions.push(TemplateSyncManager);
	context.subscriptions.push(Server);
	context.subscriptions.push(await SyncOnSaveManager.init());

	// SyncOnSaveManager.init();

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

	// StatusBar self-registers for link and editor change events
	const statusBar = new StatusBar();
	context.subscriptions.push(statusBar);

	// Start server if enabled
	await Server.startIfEnabled();

	await SessionManager.loadSessions();

	const refresh = async () => {
		await SessionManager.refreshActiveSessions();
	};

	const interval = setInterval(refresh, 15 * 60 * 1000); // Refresh all sessions every 15 minutes

	context.subscriptions.push({
		dispose: () => clearInterval(interval), // Stop on deactivate
	});

	log.info(`Finished activation of extension ${extPrefix}`);
}

export function deactivate() {
	log.info('Deactivating rewst-buddy extension');
	// Server.dispose() is called automatically via context.subscriptions
}
