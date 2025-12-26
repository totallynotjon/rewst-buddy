import { activateButtons } from '@buttons';
import { SessionManager } from '@client';
import { CommandInitiater } from '@commands';
import { extPrefix, context as globalVSContext } from '@global';
import { log } from '@log';
import { SaveHandler } from '@models';
import vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {

	globalVSContext.init(context);

	log.init(context);

	log.info(`Starting activation of extension ${extPrefix}`);

	SessionManager.loadSessions();

	activateButtons();

	CommandInitiater.registerCommands();

	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(SaveHandler));

	log.info(`Finished activation of extension ${extPrefix}`);
}

export function deactivate() {
	log.info('Deactivating rewst-buddy extension');
}
