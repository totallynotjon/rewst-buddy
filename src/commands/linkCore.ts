import { LinkManager } from '@models';
import { log } from '@utils';
import type { Uri } from 'vscode';

export async function removeLinkForUri(uri: Uri, missingMessage: string, successMessage: string): Promise<void> {
	if (!LinkManager.isLinked(uri)) {
		throw log.error(missingMessage);
	}

	await LinkManager.removeLink(uri.toString());
	log.notifyInfo(successMessage);
}
