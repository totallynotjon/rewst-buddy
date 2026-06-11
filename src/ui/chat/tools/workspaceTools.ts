import { extPrefix } from '@global';
import { LinkManager, type TemplateLink } from '@models';
import { log } from '@utils';
import vscode from 'vscode';
import {
	asNumberArg,
	asStringArg,
	describeRequest,
	type ToolFileChange,
	type ToolRequest,
	type ToolResult,
	type ToolSpec,
} from './toolProtocol';
import { isCommandTool, runCommandTool } from './commandTool';
import { isWebTool, runWebTool } from './webTools';

/**
 * Local workspace tools the Rewst AI assistant can request through the
 * rewst-tool protocol (toolProtocol.ts). Read tools are workspace-scoped and
 * output-capped. Edit tools (gated by rewst-buddy.ai.enableEditTools) apply
 * changes to the buffer but leave the file unsaved, so the user reviews them
 * in the editor and sync-on-save can't fire until they save.
 */

const DEFAULT_EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.vscode-test/**}';
const LIST_CAP = 200;
const SEARCH_FILE_CAP = 300;
const SEARCH_MATCH_CAP = 50;
const SEARCH_LINE_CHAR_CAP = 240;
const SEARCH_FILE_SIZE_CAP = 512_000;
const DIAGNOSTIC_CAP = 50;
const SYMBOL_CAP = 30;
const OUTLINE_CAP = 100;
// Per-read caps, kept under the protocol's per-result budget so the
// continue-hint survives formatToolResults untruncated.
const READ_LINE_CAP = 250;
const READ_CHAR_CAP = 7_500;

/** Seams for unit testing; production code uses defaultDeps. */
export interface WorkspaceToolDeps {
	findFiles(include: string, exclude: string, maxResults: number): Thenable<vscode.Uri[]>;
	readFile(uri: vscode.Uri): Promise<string>;
	readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
	workspaceFolders(): readonly vscode.WorkspaceFolder[];
	asRelativePath(uri: vscode.Uri): string;
	openTabUris(): vscode.Uri[];
	activeUri(): vscode.Uri | undefined;
	getDiagnostics(): readonly [vscode.Uri, readonly vscode.Diagnostic[]][];
	templateLinks(): TemplateLink[];
	workspaceSymbols(query: string): Thenable<vscode.SymbolInformation[] | undefined>;
	documentSymbols(uri: vscode.Uri): Thenable<(vscode.SymbolInformation | vscode.DocumentSymbol)[] | undefined>;
	editToolsEnabled(): boolean;
	getDocument(uri: vscode.Uri): Thenable<vscode.TextDocument>;
	applyEdit(edit: vscode.WorkspaceEdit): Thenable<boolean>;
	openInEditor(uri: vscode.Uri): Thenable<unknown>;
	createFile(uri: vscode.Uri, content: string): Thenable<void>;
	fileExists(uri: vscode.Uri): Promise<boolean>;
}

export const defaultDeps: WorkspaceToolDeps = {
	findFiles: (include, exclude, maxResults) => vscode.workspace.findFiles(include, exclude, maxResults),
	readFile: async uri => (await vscode.workspace.openTextDocument(uri)).getText(),
	readDirectory: uri => vscode.workspace.fs.readDirectory(uri),
	workspaceFolders: () => vscode.workspace.workspaceFolders ?? [],
	asRelativePath: uri => vscode.workspace.asRelativePath(uri, false),
	openTabUris: () =>
		vscode.window.tabGroups.all
			.flatMap(group => group.tabs)
			.map(tab => (tab.input instanceof vscode.TabInputText ? tab.input.uri : undefined))
			.filter((uri): uri is vscode.Uri => uri !== undefined),
	activeUri: () => vscode.window.activeTextEditor?.document.uri,
	getDiagnostics: () => vscode.languages.getDiagnostics(),
	templateLinks: () => LinkManager.getAllTemplateLinks(),
	workspaceSymbols: query =>
		vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', query),
	documentSymbols: uri =>
		vscode.commands.executeCommand<(vscode.SymbolInformation | vscode.DocumentSymbol)[]>(
			'vscode.executeDocumentSymbolProvider',
			uri,
		),
	editToolsEnabled: () => vscode.workspace.getConfiguration(`${extPrefix}.ai`).get<boolean>('enableEditTools', true),
	getDocument: uri => vscode.workspace.openTextDocument(uri),
	applyEdit: edit => vscode.workspace.applyEdit(edit),
	openInEditor: uri => vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true }),
	createFile: (uri, content) => vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content)),
	fileExists: async uri => {
		try {
			await vscode.workspace.fs.stat(uri);
			return true;
		} catch {
			return false;
		}
	},
};

export const WORKSPACE_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'list_files',
		args: '{"glob"?: string, "maxResults"?: number}',
		description: 'List workspace files (glob like "src/**/*.jinja"; defaults to all files).',
	},
	{
		name: 'read_file',
		args: '{"path": string, "startLine"?: number, "endLine"?: number}',
		description: 'Read a workspace file by relative path (1-based inclusive line range).',
	},
	{
		name: 'search_files',
		args: '{"query": string, "glob"?: string}',
		description: 'Case-insensitive text search across workspace files; returns path:line matches.',
	},
	{
		name: 'list_open_files',
		args: '{}',
		description: 'List files open in the editor, marking the active one.',
	},
	{
		name: 'open_file',
		args: '{"path": string}',
		description: "Open a workspace file in the user's editor.",
	},
	{
		name: 'get_diagnostics',
		args: '{"path"?: string}',
		description: 'List errors/warnings VS Code currently reports, optionally for one file.',
	},
	{
		name: 'find_symbols',
		args: '{"query": string}',
		description: 'Search code symbols (functions, classes, variables) across the workspace by name.',
	},
	{
		name: 'get_file_outline',
		args: '{"path": string}',
		description: 'Get the symbol outline (functions, classes, sections) of one file.',
	},
	{
		name: 'list_template_links',
		args: '{}',
		description: 'List local files linked to Rewst templates (path, template name, template id, org).',
	},
];

export const EDIT_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'edit_file',
		args: '{"path": string, "find": string, "replace": string}',
		description:
			'Replace one exact occurrence of "find" with "replace" in a workspace file. Fails if the text is missing or ambiguous — include enough surrounding context to match uniquely. The change is left unsaved for the user to review.',
	},
	{
		name: 'write_file',
		args: '{"path": string, "content": string}',
		description:
			'Create a new workspace file, or replace the full contents of an existing one (replacement is left unsaved for the user to review). Prefer edit_file for small changes.',
	},
];

/**
 * Resolves an assistant-supplied relative path to a workspace file, rejecting
 * absolute paths and anything that escapes the workspace folders.
 */
export function resolveWorkspaceUri(path: string, folders: readonly vscode.WorkspaceFolder[]): vscode.Uri | undefined {
	if (path.length === 0 || path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) {
		return undefined;
	}
	const segments = path.split(/[\\/]+/);
	if (segments.includes('..')) return undefined;

	for (const folder of folders) {
		const candidate = vscode.Uri.joinPath(folder.uri, ...segments);
		if (candidate.path.startsWith(folder.uri.path + '/')) return candidate;
	}
	return undefined;
}

function requireWorkspaceUri(args: Record<string, unknown>, tool: string, deps: WorkspaceToolDeps): vscode.Uri {
	const path = asStringArg(args, 'path');
	if (!path) throw new Error(`${tool} requires a "path" argument.`);
	const uri = resolveWorkspaceUri(path, deps.workspaceFolders());
	if (!uri) throw new Error(`Path is not inside the workspace: ${path}`);
	return uri;
}

async function listFiles(args: Record<string, unknown>, deps: WorkspaceToolDeps): Promise<string> {
	const glob = asStringArg(args, 'glob') ?? '**/*';
	const cap = Math.min(Math.max(asNumberArg(args, 'maxResults') ?? LIST_CAP, 1), 500);
	const uris = await deps.findFiles(glob, DEFAULT_EXCLUDE, cap);
	if (uris.length === 0) return `No files match ${glob}.`;
	const lines = uris.map(uri => deps.asRelativePath(uri)).sort();
	const capped = uris.length >= cap ? `\n…(showing first ${cap}; narrow the glob for more)` : '';
	return lines.join('\n') + capped;
}

/** What one tool produced: text for the assistant plus UI metadata for the chat. */
interface ToolOutcome {
	output: string;
	fileUriStrings?: string[];
	change?: ToolFileChange;
}

/**
 * Chunked file reads: output is capped by lines and characters, and when a
 * file is cut off the result says exactly which lines were shown and how to
 * request the rest. Without this the per-result budget truncated silently and
 * the assistant would re-request the same file forever.
 */
async function readFileTool(args: Record<string, unknown>, deps: WorkspaceToolDeps): Promise<ToolOutcome> {
	const uri = requireWorkspaceUri(args, 'read_file', deps);
	const text = await deps.readFile(uri);
	const fileUriStrings = [uri.toString()];

	const lines = text.split('\n');
	const start = Math.max((asNumberArg(args, 'startLine') ?? 1) - 1, 0);
	const end = Math.min(asNumberArg(args, 'endLine') ?? lines.length, lines.length);

	let count = 0;
	let chars = 0;
	while (start + count < end && count < READ_LINE_CAP && chars <= READ_CHAR_CAP) {
		chars += lines[start + count].length + 1;
		count++;
	}
	const shownEnd = start + count;
	let output = lines.slice(start, shownEnd).join('\n');
	if (shownEnd < end) {
		const path = asStringArg(args, 'path');
		output +=
			`\n…(showing lines ${start + 1}-${shownEnd} of ${lines.length}; ` +
			`continue with {"path": "${path}", "startLine": ${shownEnd + 1}})`;
	}
	return { output, fileUriStrings };
}

async function searchFiles(args: Record<string, unknown>, deps: WorkspaceToolDeps): Promise<ToolOutcome> {
	const query = asStringArg(args, 'query');
	if (!query) throw new Error('search_files requires a "query" argument.');
	const glob = asStringArg(args, 'glob') ?? '**/*';
	const needle = query.toLowerCase();

	const uris = await deps.findFiles(glob, DEFAULT_EXCLUDE, SEARCH_FILE_CAP);
	const matches: string[] = [];
	const matchedFiles = new Set<string>();
	for (const uri of uris) {
		let text: string;
		try {
			text = await deps.readFile(uri);
		} catch {
			continue; // binary or unreadable
		}
		// Skip oversized and binary-looking (NUL-containing) files.
		if (text.length > SEARCH_FILE_SIZE_CAP || text.includes('\u0000')) continue;

		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			if (!lines[i].toLowerCase().includes(needle)) continue;
			matches.push(`${deps.asRelativePath(uri)}:${i + 1}: ${lines[i].trim().slice(0, SEARCH_LINE_CHAR_CAP)}`);
			if (matchedFiles.size < 10) matchedFiles.add(uri.toString());
			if (matches.length >= SEARCH_MATCH_CAP) {
				return {
					output: matches.join('\n') + `\n…(first ${SEARCH_MATCH_CAP} matches; refine the query for more)`,
					fileUriStrings: [...matchedFiles],
				};
			}
		}
	}
	return {
		output: matches.length > 0 ? matches.join('\n') : `No matches for "${query}" in ${glob}.`,
		fileUriStrings: [...matchedFiles],
	};
}

function listOpenFiles(deps: WorkspaceToolDeps): string {
	const active = deps.activeUri()?.toString();
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const uri of deps.openTabUris()) {
		if (seen.has(uri.toString())) continue;
		seen.add(uri.toString());
		lines.push(`${deps.asRelativePath(uri)}${uri.toString() === active ? ' (active)' : ''}`);
	}
	return lines.length > 0 ? lines.join('\n') : 'No files are open in the editor.';
}

async function openFileTool(args: Record<string, unknown>, deps: WorkspaceToolDeps): Promise<ToolOutcome> {
	const uri = requireWorkspaceUri(args, 'open_file', deps);
	if (!(await deps.fileExists(uri))) throw new Error(`File does not exist: ${asStringArg(args, 'path')}`);
	await deps.openInEditor(uri);
	return { output: `Opened ${deps.asRelativePath(uri)} in the editor.`, fileUriStrings: [uri.toString()] };
}

function getDiagnosticsTool(args: Record<string, unknown>, deps: WorkspaceToolDeps): string {
	const path = asStringArg(args, 'path');
	const severityNames = ['error', 'warning', 'info', 'hint'];
	const lines: string[] = [];
	for (const [uri, diagnostics] of deps.getDiagnostics()) {
		const relative = deps.asRelativePath(uri);
		if (path && relative !== path) continue;
		for (const diagnostic of diagnostics) {
			lines.push(
				`${relative}:${diagnostic.range.start.line + 1} [${severityNames[diagnostic.severity] ?? 'unknown'}] ${diagnostic.message}`,
			);
			if (lines.length >= DIAGNOSTIC_CAP) {
				return lines.join('\n') + `\n…(first ${DIAGNOSTIC_CAP} diagnostics)`;
			}
		}
	}
	return lines.length > 0 ? lines.join('\n') : 'No diagnostics reported.';
}

async function findSymbols(args: Record<string, unknown>, deps: WorkspaceToolDeps): Promise<string> {
	const query = asStringArg(args, 'query');
	if (!query) throw new Error('find_symbols requires a "query" argument.');
	const symbols = (await deps.workspaceSymbols(query)) ?? [];
	if (symbols.length === 0) return `No symbols match "${query}".`;
	return symbols
		.slice(0, SYMBOL_CAP)
		.map(
			symbol =>
				`${symbol.name} [${vscode.SymbolKind[symbol.kind]}] — ${deps.asRelativePath(symbol.location.uri)}:${symbol.location.range.start.line + 1}`,
		)
		.join('\n');
}

function isDocumentSymbol(symbol: vscode.SymbolInformation | vscode.DocumentSymbol): symbol is vscode.DocumentSymbol {
	return 'children' in symbol;
}

async function getFileOutline(args: Record<string, unknown>, deps: WorkspaceToolDeps): Promise<ToolOutcome> {
	const uri = requireWorkspaceUri(args, 'get_file_outline', deps);
	const symbols = (await deps.documentSymbols(uri)) ?? [];
	const fileUriStrings = [uri.toString()];
	if (symbols.length === 0) {
		return { output: 'No symbols found (the file may have no language support installed).', fileUriStrings };
	}

	const lines: string[] = [];
	const visit = (symbol: vscode.SymbolInformation | vscode.DocumentSymbol, depth: number): void => {
		if (lines.length >= OUTLINE_CAP) return;
		const line = isDocumentSymbol(symbol) ? symbol.range.start.line + 1 : symbol.location.range.start.line + 1;
		lines.push(`${'  '.repeat(depth)}${symbol.name} [${vscode.SymbolKind[symbol.kind]}] (line ${line})`);
		if (isDocumentSymbol(symbol)) symbol.children.forEach(child => visit(child, depth + 1));
	};
	symbols.forEach(symbol => visit(symbol, 0));
	if (lines.length >= OUTLINE_CAP) lines.push(`…(first ${OUTLINE_CAP} symbols)`);
	return { output: lines.join('\n'), fileUriStrings };
}

function listTemplateLinks(deps: WorkspaceToolDeps): string {
	const links = deps.templateLinks();
	if (links.length === 0) return 'No files are linked to Rewst templates.';
	const lines = links.map(link => {
		const relative = deps.asRelativePath(vscode.Uri.parse(link.uriString));
		return `${relative} ← "${link.template.name}" (template ${link.template.id}, org ${link.org.name})`;
	});
	return lines.join('\n');
}

function requireEditTools(deps: WorkspaceToolDeps): void {
	if (!deps.editToolsEnabled()) {
		throw new Error(
			'Edit tools are disabled. The user can enable them with the rewst-buddy.ai.enableEditTools setting.',
		);
	}
}

async function editFileTool(args: Record<string, unknown>, deps: WorkspaceToolDeps): Promise<ToolOutcome> {
	requireEditTools(deps);
	const uri = requireWorkspaceUri(args, 'edit_file', deps);
	const find = asStringArg(args, 'find');
	const replace = args.replace;
	if (!find) throw new Error('edit_file requires a non-empty "find" argument.');
	if (typeof replace !== 'string') throw new Error('edit_file requires a "replace" argument (string, may be empty).');

	const document = await deps.getDocument(uri);
	const text = document.getText();
	const first = text.indexOf(find);
	if (first < 0)
		throw new Error(`"find" text not found in ${deps.asRelativePath(uri)}. Read the file and match exactly.`);
	if (text.indexOf(find, first + 1) >= 0) {
		throw new Error(
			`"find" text matches more than once in ${deps.asRelativePath(uri)}. Include more surrounding context.`,
		);
	}

	const edit = new vscode.WorkspaceEdit();
	edit.replace(uri, new vscode.Range(document.positionAt(first), document.positionAt(first + find.length)), replace);
	if (!(await deps.applyEdit(edit))) throw new Error('VS Code rejected the edit.');
	await deps.openInEditor(uri);
	const line = document.positionAt(first).line + 1;
	return {
		output: `Edited ${deps.asRelativePath(uri)} at line ${line}. The change is unsaved — the user will review and save it.`,
		fileUriStrings: [uri.toString()],
		change: {
			uriString: uri.toString(),
			before: text,
			after: text.slice(0, first) + replace + text.slice(first + find.length),
		},
	};
}

async function writeFileTool(args: Record<string, unknown>, deps: WorkspaceToolDeps): Promise<ToolOutcome> {
	requireEditTools(deps);
	const uri = requireWorkspaceUri(args, 'write_file', deps);
	const content = args.content;
	if (typeof content !== 'string') throw new Error('write_file requires a "content" argument (string).');
	const fileUriStrings = [uri.toString()];

	if (await deps.fileExists(uri)) {
		const document = await deps.getDocument(uri);
		const before = document.getText();
		const edit = new vscode.WorkspaceEdit();
		edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(before.length)), content);
		if (!(await deps.applyEdit(edit))) throw new Error('VS Code rejected the edit.');
		await deps.openInEditor(uri);
		return {
			output: `Replaced the contents of ${deps.asRelativePath(uri)}. The change is unsaved — the user will review and save it.`,
			fileUriStrings,
			change: { uriString: uri.toString(), before, after: content },
		};
	}

	await deps.createFile(uri, content);
	await deps.openInEditor(uri);
	return {
		output: `Created ${deps.asRelativePath(uri)}.`,
		fileUriStrings,
		change: { uriString: uri.toString(), before: '', after: content },
	};
}

/** Executes parsed tool requests sequentially; failures become error results. */
export async function runToolRequests(
	requests: ToolRequest[],
	deps: WorkspaceToolDeps = defaultDeps,
	onProgress?: (label: string) => void,
): Promise<ToolResult[]> {
	const results: ToolResult[] = [];
	for (const request of requests) {
		onProgress?.(`Running ${describeRequest(request)}…`);
		const argsLabel = JSON.stringify(request.args) === '{}' ? '' : JSON.stringify(request.args);
		try {
			const outcome = await runTool(request, deps);
			results.push({ tool: request.tool, argsLabel, ok: true, ...outcome });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.debug('workspaceTools: tool failed', request.tool, message);
			results.push({ tool: request.tool, argsLabel, ok: false, output: message });
		}
	}
	return results;
}

async function runTool(request: ToolRequest, deps: WorkspaceToolDeps): Promise<ToolOutcome> {
	switch (request.tool) {
		case 'list_files':
			return { output: await listFiles(request.args, deps) };
		case 'read_file':
			return readFileTool(request.args, deps);
		case 'search_files':
			return searchFiles(request.args, deps);
		case 'list_open_files':
			return { output: listOpenFiles(deps) };
		case 'open_file':
			return openFileTool(request.args, deps);
		case 'get_diagnostics':
			return { output: getDiagnosticsTool(request.args, deps) };
		case 'find_symbols':
			return { output: await findSymbols(request.args, deps) };
		case 'get_file_outline':
			return getFileOutline(request.args, deps);
		case 'list_template_links':
			return { output: listTemplateLinks(deps) };
		case 'edit_file':
			return editFileTool(request.args, deps);
		case 'write_file':
			return writeFileTool(request.args, deps);
		default: {
			if (isWebTool(request.tool)) return { output: await runWebTool(request) };
			if (isCommandTool(request.tool)) return { output: await runCommandTool(request) };
			const names = [...WORKSPACE_TOOL_SPECS, ...EDIT_TOOL_SPECS].map(s => s.name).join(', ');
			throw new Error(`Unknown tool "${request.tool}". Available: ${names}.`);
		}
	}
}

/**
 * Compact first-message context: workspace folders, their top-level entries,
 * and how many files are linked to Rewst templates. Bounded by construction.
 */
export async function buildWorkspaceOverview(deps: WorkspaceToolDeps = defaultDeps): Promise<string | undefined> {
	const folders = deps.workspaceFolders();
	if (folders.length === 0) return undefined;

	const sections: string[] = [];
	for (const folder of folders.slice(0, 3)) {
		try {
			const entries = await deps.readDirectory(folder.uri);
			const names = entries
				.filter(([name]) => !name.startsWith('.') && name !== 'node_modules')
				.map(([name, type]) => (type === vscode.FileType.Directory ? `${name}/` : name))
				.sort()
				.slice(0, 30);
			sections.push(`Workspace folder "${folder.name}": ${names.join(', ')}`);
		} catch (error) {
			log.debug('buildWorkspaceOverview: readDirectory failed', error);
		}
	}
	if (sections.length === 0) return undefined;

	const linkCount = deps.templateLinks().length;
	if (linkCount > 0) {
		sections.push(`${linkCount} file(s) are linked to Rewst templates (list_template_links shows them).`);
	}
	return sections.join('\n');
}
