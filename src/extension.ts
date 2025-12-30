import { SessionManager } from '@client';
import { CommandInitiater } from '@commands';
import { extPrefix, context as globalVSContext } from '@global';
import { log } from '@log';
import { RenameHandler, SaveHandler } from '@models';
import { Server } from '@server';
import { LinkChangeHandler, StatusBarIcon } from '@ui';
import vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	globalVSContext.init(context);

	log.init(context);

	log.info(`Starting activation of extension ${extPrefix}`);

	SessionManager.loadSessions();

	CommandInitiater.registerCommands();

	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(SaveHandler));

	context.subscriptions.push(vscode.workspace.onDidRenameFiles(RenameHandler));

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(LinkChangeHandler));

	context.subscriptions.push(StatusBarIcon);

	await LinkChangeHandler();

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
