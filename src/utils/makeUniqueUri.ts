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
	// Sanitize filename: replace characters invalid on Windows/Linux filesystems
	filename = filename.trim().replace(/[<>:"/\\|?* ]/g, '_');

	const dotIndex = filename.lastIndexOf('.');
	const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
	const ext = dotIndex > 0 ? filename.slice(dotIndex) : '';

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
