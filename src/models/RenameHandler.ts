import { log } from '@log';
import vscode from 'vscode';
import { TemplateLinkManager } from './TemplateLinkManager';

function isDescendant(parent: vscode.Uri, candidate: vscode.Uri): boolean {
	if (parent.scheme !== candidate.scheme || parent.authority !== candidate.authority) {
		return false;
	}

	const parentPath = parent.path.endsWith('/') ? parent.path : parent.path + '/';
	const childPath = candidate.path;

	return childPath === parent.path || childPath.startsWith(parentPath);
}

export default async function RenameHandler(e: vscode.FileRenameEvent) {
	try {
		const manager = TemplateLinkManager;

		for (const file of e.files) {
			const stat = await vscode.workspace.fs.stat(file.newUri);
			const isFile = (stat.type & vscode.FileType.File) !== 0;
			const isDir = (stat.type & vscode.FileType.Directory) !== 0;

			if (!isFile && !isDir) continue;

			if (isDir) {
				const uris = manager.getAllUriStrings();
				const oldPrefix = file.oldUri.toString();
				const newPrefix = file.newUri.toString();

				for (const child of uris) {
					if (isDescendant(file.oldUri, vscode.Uri.parse(child))) {
						const newUri = newPrefix + child.slice(oldPrefix.length);
						try {
							manager.moveLink(child, newUri);
						} catch (e) {
							log.notifyError(`Failed to handle rename`, e);
						}
					}
				}
			} else if (isFile) {
				try {
					manager.moveLink(file.oldUri.toString(), file.newUri.toString());
				} catch (e) {
					log.notifyError(`Failed to handle rename`, e);
				}
			}
		}

		await manager.save();
	} catch (error) {
		log.error('Failed to handle rename event', error);
	}
}
