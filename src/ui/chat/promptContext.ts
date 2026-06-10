import { log } from '@utils';
import vscode from 'vscode';

/**
 * Resolves VS Code chat prompt references (attached files, editor selections,
 * pasted text) into a context block appended to the message sent to the Rewst
 * AI assistant, which otherwise only sees the raw prompt text.
 */

// Rough budget: ~24k chars ≈ 6k tokens — well inside the assistant's context
// window (it reports context_usage server-side and summarizes when pressed).
export const MAX_REFERENCE_CHARS = 8_000;
export const MAX_TOTAL_REFERENCE_CHARS = 24_000;

export interface ResolvedReference {
	label: string;
	content: string;
	truncated: boolean;
}

export type ReferenceFileReader = (uri: vscode.Uri, range?: vscode.Range) => Promise<string>;

export async function readDocumentText(uri: vscode.Uri, range?: vscode.Range): Promise<string> {
	const document = await vscode.workspace.openTextDocument(uri);
	return range ? document.getText(range) : document.getText();
}

function labelFor(uri: vscode.Uri, range?: vscode.Range): string {
	const path = vscode.workspace.asRelativePath(uri, false);
	if (!range) return path;
	const start = range.start.line + 1;
	const end = range.end.line + 1;
	return start === end ? `${path} (line ${start})` : `${path} (lines ${start}-${end})`;
}

export async function resolveReferences(
	references: readonly vscode.ChatPromptReference[],
	readFile: ReferenceFileReader = readDocumentText,
): Promise<ResolvedReference[]> {
	const resolved: ResolvedReference[] = [];
	let total = 0;

	for (const reference of references) {
		if (total >= MAX_TOTAL_REFERENCE_CHARS) break;

		let label: string;
		let content: string;
		try {
			const value = reference.value;
			if (typeof value === 'string') {
				label = reference.modelDescription ?? 'Attached text';
				content = value;
			} else if (value instanceof vscode.Location) {
				label = labelFor(value.uri, value.range);
				content = await readFile(value.uri, value.range);
			} else if (value instanceof vscode.Uri) {
				label = labelFor(value);
				content = await readFile(value);
			} else {
				continue; // binary data / unknown reference kinds
			}
		} catch (error) {
			log.debug('resolveReferences: skipping unreadable reference', error);
			continue;
		}

		if (content.length === 0) continue;

		const budget = Math.min(MAX_REFERENCE_CHARS, MAX_TOTAL_REFERENCE_CHARS - total);
		const truncated = content.length > budget;
		if (truncated) content = content.slice(0, budget);
		total += content.length;

		resolved.push({ label, content, truncated });
	}

	return resolved;
}

/**
 * Prepends the user's standing instructions to a message. Not a real system
 * prompt — RoboRewsty's system prompt is server-side and immutable — but the
 * assistant honors per-message preambles in practice.
 */
export function prependInstructions(message: string, instructions: string | undefined): string {
	const trimmed = instructions?.trim();
	if (!trimmed) return message;
	return `User's standing instructions: ${trimmed}\n\n---\n\n${message}`;
}

/** First file-backed reference (attachment or selection), if any. */
export function firstReferencedFileUri(references: readonly vscode.ChatPromptReference[]): vscode.Uri | undefined {
	for (const reference of references) {
		const value = reference.value;
		if (value instanceof vscode.Location) return value.uri;
		if (value instanceof vscode.Uri) return value;
	}
	return undefined;
}

export function formatPromptWithReferences(prompt: string, references: ResolvedReference[]): string {
	if (references.length === 0) return prompt;

	const blocks = references.map(ref => {
		const note = ref.truncated ? ' (truncated)' : '';
		return `### ${ref.label}${note}\n\`\`\`\n${ref.content}\n\`\`\``;
	});

	return `${prompt}\n\nThe user attached the following context from their editor:\n\n${blocks.join('\n\n')}`;
}
