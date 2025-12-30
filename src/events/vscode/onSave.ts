import { extPrefix } from '@global';
import { log } from '@utils';
import { TemplateLinkManager, TemplateSyncManager } from '@models';
import vscode from 'vscode';

export default async function SaveHandler(document: vscode.TextDocument) {
	log.trace('Handling save', document);
	//check if we are set to do something on save

	const config = vscode.workspace.getConfiguration(extPrefix);
	const enabled = config.get<boolean>('enableSyncOnSave', false);

	if (!enabled) return;

	if (!TemplateLinkManager.isLinked(document.uri)) return;

	try {
		await TemplateSyncManager.syncTemplate(document);
		log.notifyInfo('SUCCESS: Synced template');
	} catch (e) {
		log.notifyError('Failed to sync template:', e);
	}
}
