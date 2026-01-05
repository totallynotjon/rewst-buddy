import { log } from '@utils';
import vscode from 'vscode';

export function parseArgsUri(...args: any[]): vscode.Uri {
	let current: any = args;
	for (let i = 0; i < 10; i++) {
		if (current instanceof vscode.Uri) return current;
		if (!Array.isArray(current) || current.length === 0) break;
		current = current[0];
	}
	throw log.notifyError('Could not parse folder uri, command may have been run from the wrong context.');
}
