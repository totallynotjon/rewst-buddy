import vscode from 'vscode';
import path from 'path';

export function isDescendant(parent: vscode.Uri, candidate: vscode.Uri): boolean {
	if (parent.scheme !== candidate.scheme || parent.authority !== candidate.authority) {
		return false;
	}
	const serializedCandidate = `${candidate.toString()} ${candidate.toString(true)} ${candidate.path}`;
	let decodedCandidate = serializedCandidate;
	let hasEncodedSeparator = false;
	for (let i = 0; i < 3; i++) {
		if (/%2f|%5c/i.test(decodedCandidate)) {
			hasEncodedSeparator = true;
			break;
		}
		try {
			const next = decodeURIComponent(decodedCandidate);
			if (next === decodedCandidate) break;
			decodedCandidate = next;
		} catch {
			break;
		}
	}
	if (hasEncodedSeparator) {
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
