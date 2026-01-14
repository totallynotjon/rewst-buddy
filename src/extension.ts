import { CommandInitiater } from '@commands';
import { extPrefix, context as globalVSContext } from '@global';
import { LinkManager, SyncManager, SyncOnSaveManager } from '@models';
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
	context.subscriptions.push(SyncManager.init());
	context.subscriptions.push(await Server.init());
	context.subscriptions.push(new StatusBar());

	CommandInitiater.registerCommands();

	log.info(`Finished activation of extension ${extPrefix}`);
}

export function deactivate() {
	log.info('Deactivating rewst-buddy extension');
	// Server.dispose() is called automatically via context.subscriptions
}
