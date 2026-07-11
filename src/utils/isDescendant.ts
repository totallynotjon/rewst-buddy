import vscode from 'vscode';
import path from 'path';

export function isDescendant(parent: vscode.Uri, candidate: vscode.Uri): boolean {
	if (parent.scheme !== candidate.scheme || parent.authority !== candidate.authority) {
		return false;
	}

	// Reject unresolved traversal explicitly. URI paths can be supplied by
	// extensions or remote providers without filesystem normalization, so a
	// prefix check alone would incorrectly allow `parent/../secret`.
	if (/(^|\/)\.\.?($|\/)/.test(candidate.path)) {
		return false;
	}

	const normalizedParent = path.posix.normalize(parent.path);
	const normalizedCandidate = path.posix.normalize(candidate.path);
	const parentPath = normalizedParent.endsWith('/') ? normalizedParent : normalizedParent + '/';
	const childPath = normalizedCandidate;

	return childPath === normalizedParent || childPath.startsWith(parentPath);
}
