import { SessionManager } from '@client';
import { CommandInitiater } from '@commands';
import { context as globalVSContext } from '@global';
import { log } from '@log';
import { activateButtons } from '@buttons';
import vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	globalVSContext.init(context);
	log.init(context);

	log.info('Congratulations, your extension "rewst-buddy" is now active!');

	await activateButtons();

	await SessionManager.init();

	CommandInitiater.registerCommands();

	log.info('Done loading');
}

export function deactivate() {
	log.info('Deactivating rewst-buddy extension');
}
