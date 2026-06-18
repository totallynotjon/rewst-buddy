import { randomUUID } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';

const MAX_INLINE_OUTPUT_CHARS = 8_000;
const ARTIFACT_DIR = '.rewst-buddy/tool-results';

export interface ToolOutputArtifactDeps {
	createDirectory(uri: vscode.Uri): Thenable<void>;
	writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>;
	workspaceFolders(): readonly vscode.WorkspaceFolder[];
	now(): Date;
	randomId(): string;
	tmpDir(): string;
}

export const defaultToolOutputArtifactDeps: ToolOutputArtifactDeps = {
	createDirectory: uri => vscode.workspace.fs.createDirectory(uri),
	writeFile: (uri, content) => vscode.workspace.fs.writeFile(uri, content),
	workspaceFolders: () => vscode.workspace.workspaceFolders ?? [],
	now: () => new Date(),
	randomId: () => randomUUID().slice(0, 8),
	tmpDir: () => os.tmpdir(),
};

export async function formatToolOutput(
	toolName: string,
	text: string,
	deps: ToolOutputArtifactDeps = defaultToolOutputArtifactDeps,
): Promise<string> {
	if (text.length <= MAX_INLINE_OUTPUT_CHARS) return text;
	const preview = text.slice(0, MAX_INLINE_OUTPUT_CHARS);
	try {
		const artifactUri = artifactFileUri(toolName, deps);
		await deps.createDirectory(parentUri(artifactUri));
		await deps.writeFile(artifactUri, Buffer.from(text, 'utf8'));
		return [
			`Tool output was ${formatBytes(Buffer.byteLength(text, 'utf8'))} (${text.length} characters), so Rewst Buddy saved the full result.`,
			'Full output saved:',
			artifactUri.fsPath,
			'',
			'Use read_file on that path to inspect more, or VS Code search tools to search within it.',
			'',
			'Preview:',
			preview,
			'...(preview truncated)',
		].join('\n');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `${preview}\n...(output truncated; failed to save full output: ${message})`;
	}
}

function artifactFileUri(toolName: string, deps: ToolOutputArtifactDeps): vscode.Uri {
	const now = deps.now();
	const day = now.toISOString().slice(0, 10);
	const time = now.toISOString().slice(11, 19).replace(/:/g, '');
	const filename = `${time}-${safeName(toolName)}-${deps.randomId()}.txt`;
	const workspaceRoot = deps.workspaceFolders().find(folder => folder.uri.scheme === 'file')?.uri;
	if (workspaceRoot) {
		return vscode.Uri.joinPath(workspaceRoot, ...ARTIFACT_DIR.split('/'), day, filename);
	}
	return vscode.Uri.file(path.join(deps.tmpDir(), 'rewst-buddy', 'tool-results', day, filename));
}

function parentUri(uri: vscode.Uri): vscode.Uri {
	return vscode.Uri.file(path.dirname(uri.fsPath));
}

function safeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'tool-output';
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
