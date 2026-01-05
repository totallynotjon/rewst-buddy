import { log } from '@utils';
import vscode from 'vscode';

export function parseArgsUri(...args: any[]): vscode.Uri {
	try {
		let uri = args;
		while (true) {
			if (uri instanceof vscode.Uri) return uri;
			uri = uri[0];
		}
	} catch (e) {
		//
	}
	throw log.notifyError('Could not parse folder uri, command may have been run from the wrong context.');
}
