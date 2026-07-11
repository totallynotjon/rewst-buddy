import vscode from 'vscode';
import { uriExists } from './uriExists';

/**
 * Generate a unique URI for a file within a folder.
 * If the filename already exists, appends (1), (2), etc. before the extension.
 *
 * @param folderUri - The parent folder URI
 * @param filename - The desired filename (with or without extension)
 * @param reservedUris - Optional set of URIs already allocated (for batch operations)
 * @returns A URI that does not conflict with existing files or reserved URIs
 *
 * @example
 * // If "report.txt" exists, returns URI for "report(1).txt"
 * const uri = await makeUniqueUri(folderUri, "report.txt");
 */
export async function makeUniqueUri(
	folderUri: vscode.Uri,
	filename: string,
	reservedUris?: Set<string>,
): Promise<vscode.Uri> {
	// Keep remote names as a single, portable filesystem component. Control
	// characters and Windows-reserved device names are unsafe even on POSIX,
	// because workspaces may later be opened on another platform.
	filename = filename
		.trim()
		.replace(/[<>:"/\\|?*]/g, '_')
		.split('')
		.map(character => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127 ? '_' : character;
		})
		.join('')
		.replace(/[ .]+$/, '');

	if (!filename || filename === '.' || filename === '..') {
		filename = 'untitled';
	}

	const dotIndex = filename.lastIndexOf('.');
	let base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
	let ext = dotIndex > 0 ? filename.slice(dotIndex) : '';

	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) {
		base = `_${base}`;
	}

	// Most filesystems cap a single component at 255 bytes. Preserve the
	// extension while bounding unusually long remote template names.
	const maxBaseBytes = Math.max(1, 255 - Buffer.byteLength(ext, 'utf8'));
	while (Buffer.byteLength(base, 'utf8') > maxBaseBytes) {
		base = base.slice(0, Math.max(1, base.length - 1));
	}
	while (Buffer.byteLength(`${base}${ext}`, 'utf8') > 255 && ext.length > 0) {
		ext = ext.slice(0, -1);
	}
	filename = `${base}${ext}`;

	let counter = 0;
	let candidateName = filename;
	let candidateUri = vscode.Uri.joinPath(folderUri, candidateName);

	while ((await uriExists(candidateUri)) || reservedUris?.has(candidateUri.toString())) {
		counter++;
		candidateName = `${base}(${counter})${ext}`;
		candidateUri = vscode.Uri.joinPath(folderUri, candidateName);
	}

	return candidateUri;
}
