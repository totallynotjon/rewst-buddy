import vscode from 'vscode';

export function isDescendant(parent: vscode.Uri, candidate: vscode.Uri): boolean {
	if (parent.scheme !== candidate.scheme || parent.authority !== candidate.authority) {
		return false;
	}

	const parentPath = parent.path.endsWith('/') ? parent.path : parent.path + '/';
	const childPath = candidate.path;

	return childPath === parent.path || childPath.startsWith(parentPath);
}
