import { extPrefix } from '@global';
import { LinkManager, type TemplateLink } from '@models';
import { log } from '@utils';
import vscode from 'vscode';
import { describeRequest, type ToolRequest, type ToolResult, type ToolSpec } from './toolProtocol';
import { GRAPHQL_TOOL_SPECS, isGraphqlTool, runGraphqlTool, type GraphqlToolDeps } from './graphqlTool';
import { isWebTool, runWebTool, WEB_TOOL_SPECS } from './webTools';

/**
 * Domain workspace context for the Rewst AI assistant: the list of files
 * linked to Rewst templates, plus the first-message workspace overview.
 * Generic file/search/edit/terminal work is NOT provided here — VS Code's
 * chat (agent mode) passes its built-in tools through options.tools and the
 * provider advertises them via the rewst-tool protocol.
 */

/** Seams for unit testing; production code uses defaultDeps. */
export interface WorkspaceToolDeps {
	readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
	workspaceFolders(): readonly vscode.WorkspaceFolder[];
	asRelativePath(uri: vscode.Uri): string;
	templateLinks(): TemplateLink[];
	workspaceToolsEnabled(): boolean;
}

export const defaultDeps: WorkspaceToolDeps = {
	readDirectory: uri => vscode.workspace.fs.readDirectory(uri),
	workspaceFolders: () => vscode.workspace.workspaceFolders ?? [],
	asRelativePath: uri => vscode.workspace.asRelativePath(uri, false),
	templateLinks: () => LinkManager.getAllTemplateLinks(),
	workspaceToolsEnabled: () =>
		vscode.workspace.getConfiguration(`${extPrefix}.ai`).get<boolean>('enableWorkspaceTools', true),
};

export const WORKSPACE_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'list_template_links',
		args: '{}',
		description: 'List local files linked to Rewst templates (path, template name, template id, org).',
		inputSchema: { type: 'object', properties: {} },
	},
];

/** What one tool produced: text for the assistant. */
interface ToolOutcome {
	output: string;
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

// Enforced at execution time, not just by omitting specs from the prompt: the
// assistant is remote and may request tools it was never offered.
const LOCAL_TOOL_NAMES = new Set(WORKSPACE_TOOL_SPECS.map(spec => spec.name));

function requireWorkspaceTools(deps: WorkspaceToolDeps): void {
	if (!deps.workspaceToolsEnabled()) {
		throw new Error(
			'Workspace tools are disabled. The user can enable them with the rewst-buddy.ai.enableWorkspaceTools setting.',
		);
	}
}

/** Executes parsed tool requests sequentially; failures become error results. */
export async function runToolRequests(
	requests: ToolRequest[],
	deps: WorkspaceToolDeps = defaultDeps,
	onProgress?: (label: string) => void,
	graphqlDeps?: GraphqlToolDeps,
): Promise<ToolResult[]> {
	const results: ToolResult[] = [];
	for (const request of requests) {
		onProgress?.(`Running ${describeRequest(request)}…`);
		const argsLabel = JSON.stringify(request.args) === '{}' ? '' : JSON.stringify(request.args);
		try {
			const outcome = await runTool(request, deps, graphqlDeps);
			results.push({ tool: request.tool, argsLabel, ok: true, ...outcome });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.debug('workspaceTools: tool failed', request.tool, message);
			results.push({ tool: request.tool, argsLabel, ok: false, output: message });
		}
	}
	return results;
}

async function runTool(
	request: ToolRequest,
	deps: WorkspaceToolDeps,
	graphqlDeps?: GraphqlToolDeps,
): Promise<ToolOutcome> {
	if (LOCAL_TOOL_NAMES.has(request.tool)) requireWorkspaceTools(deps);
	switch (request.tool) {
		case 'list_template_links':
			return { output: listTemplateLinks(deps) };
		default: {
			if (isWebTool(request.tool)) return { output: await runWebTool(request) };
			if (isGraphqlTool(request.tool)) return { output: await runGraphqlTool(request, graphqlDeps) };
			const names = [...WORKSPACE_TOOL_SPECS, ...WEB_TOOL_SPECS, ...GRAPHQL_TOOL_SPECS]
				.map(s => s.name)
				.join(', ');
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

	const sections: string[] = [`Workspace root: ${folders[0].uri.fsPath}`];
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
