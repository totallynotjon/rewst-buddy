import { log } from '@utils';
import vscode from 'vscode';

export function parseArgsUri(...args: any[]): vscode.Uri {
	let current: any = args;
	for (let i = 0; i < 10; i++) {
		if (current instanceof vscode.Uri) return current;
		// Handle tree view elements that have a resourceUri property
		if (
			current &&
			typeof current === 'object' &&
			!Array.isArray(current) &&
			current.resourceUri instanceof vscode.Uri
		) {
			return current.resourceUri;
		}
		if (!Array.isArray(current) || current.length === 0) break;
		current = current[0];
	}
	throw log.error('Could not parse URI from command arguments');
}
