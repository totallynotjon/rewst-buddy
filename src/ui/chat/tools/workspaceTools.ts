import { LinkManager, type TemplateLink } from '@models';
import { log } from '@utils';
import vscode from 'vscode';
import { describeRequest, type ToolRequest, type ToolResult, type ToolSpec } from './toolProtocol';
import { GRAPHQL_TOOL_SPECS, isGraphqlTool, runGraphqlTool, type GraphqlToolDeps } from './graphqlTool';
import { isWorkflowTool, runWorkflowTool, WORKFLOW_TOOL_SPECS } from './workflowTools';

/**
 * Domain workspace context for the Rewst AI assistant: the list of files
 * linked to Rewst templates, plus the first-message workspace overview.
 * Generic file/search/edit/terminal work is NOT provided here — VS Code's
 * chat (agent mode) passes its built-in tools through options.tools and the
 * provider advertises them via the vscode-tool protocol.
 */

/** Seams for unit testing; production code uses defaultDeps. */
export interface WorkspaceToolDeps {
	readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
	workspaceFolders(): readonly vscode.WorkspaceFolder[];
	asRelativePath(uri: vscode.Uri): string;
	templateLinks(): TemplateLink[];
}

export const defaultDeps: WorkspaceToolDeps = {
	readDirectory: uri => vscode.workspace.fs.readDirectory(uri),
	workspaceFolders: () => vscode.workspace.workspaceFolders ?? [],
	asRelativePath: uri => vscode.workspace.asRelativePath(uri, false),
	templateLinks: () => LinkManager.getAllTemplateLinks(),
};

const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;

export const WORKSPACE_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'search_template_links',
		args: '{"query"?: string, "limit"?: number}',
		description:
			'Search the local files linked to Rewst templates, returning a bounded list of matches (path, template name, template id, org). Pass query to filter by a case-insensitive substring of the file path, template name, template id, or org name; omit it to list the linked files (still bounded). Results are capped at limit (default 20, max 50) with a note when more match. To check whether one specific file is linked, prefer buddy_template_link_status.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Optional case-insensitive substring to match against the file path, template name, template id, or org name.',
				},
				limit: {
					type: 'number',
					description: `Maximum number of matches to return (default ${SEARCH_DEFAULT_LIMIT}, max ${SEARCH_MAX_LIMIT}).`,
				},
			},
		},
	},
];

/** What one tool produced: text for the assistant. */
interface ToolOutcome {
	output: string;
}

/** Positive integer in [1, max], else the fallback (MCP inputs are unvalidated). */
function coercePositiveLimit(value: unknown, fallback: number, max: number): number {
	if (typeof value === 'number' && Number.isInteger(value) && value > 0) return Math.min(value, max);
	return fallback;
}

function searchTemplateLinks(deps: WorkspaceToolDeps, args: Record<string, unknown>): string {
	const links = deps.templateLinks();
	if (links.length === 0) return 'No files are linked to Rewst templates.';

	const rawQuery = typeof args.query === 'string' ? args.query.trim() : '';
	const query = rawQuery.toLowerCase();
	const limit = coercePositiveLimit(args.limit, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT);

	const rows = links
		.map(link => ({ relative: deps.asRelativePath(vscode.Uri.parse(link.uriString)), link }))
		.filter(({ relative, link }) => {
			if (query === '') return true;
			const haystack = [relative, link.template.name, link.template.id, link.org.name].join('\n').toLowerCase();
			return haystack.includes(query);
		})
		.sort((a, b) => a.relative.localeCompare(b.relative));

	if (rows.length === 0) return `No linked files match "${rawQuery}".`;

	const lines = rows
		.slice(0, limit)
		.map(
			({ relative, link }) =>
				`${relative} ← "${link.template.name}" (template ${link.template.id}, org ${link.org.name})`,
		);
	if (rows.length > lines.length) {
		lines.push(
			`… ${rows.length - lines.length} more not shown; refine with a more specific query or raise limit (max ${SEARCH_MAX_LIMIT}).`,
		);
	}
	return lines.join('\n');
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
			results.push({ tool: request.tool, argsLabel, ok: true, output: outcome.output });
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
	switch (request.tool) {
		case 'search_template_links':
			return { output: searchTemplateLinks(deps, request.args) };
		default: {
			if (isWorkflowTool(request.tool)) {
				return { output: await runWorkflowTool(request, graphqlDeps) };
			}
			if (isGraphqlTool(request.tool)) return { output: await runGraphqlTool(request, graphqlDeps) };
			const names = [...WORKSPACE_TOOL_SPECS, ...WORKFLOW_TOOL_SPECS, ...GRAPHQL_TOOL_SPECS]
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
		sections.push(`${linkCount} file(s) are linked to Rewst templates (search_template_links lists them).`);
	}
	return sections.join('\n');
}

export interface CachedWorkspaceOverview {
	/** The overview, served from cache when fresh; rebuilt on a miss/invalidation. */
	get(): Promise<string | undefined>;
	/** Marks the cached value stale so the next get() rebuilds it. */
	invalidate(): void;
}

/**
 * Wraps {@link buildWorkspaceOverview} with a cache so a multi-turn chat does
 * not re-scan the workspace (a `readDirectory` round-trip) before every backend
 * call. Freshness is event-driven — {@link wireWorkspaceOverviewInvalidation}
 * calls `invalidate()` when workspace files or template links change — and the
 * TTL is a backstop for changes no event reports (external edits, unwatched
 * paths). Concurrent callers share a single in-flight scan.
 */
export function createCachedWorkspaceOverview(
	build: () => Promise<string | undefined> = () => buildWorkspaceOverview(),
	ttlMs = 60_000,
	now: () => number = Date.now,
): CachedWorkspaceOverview {
	let cachedAt = Number.NEGATIVE_INFINITY;
	let value: string | undefined;
	let inFlight: Promise<string | undefined> | undefined;
	// Bumped on every invalidation; a scan whose generation no longer matches
	// started before the invalidation, so its result must not be (re-)cached.
	let generation = 0;
	return {
		async get() {
			if (now() - cachedAt < ttlMs) return value;
			if (inFlight) return inFlight;
			const gen = generation;
			const pending = build();
			inFlight = pending;
			try {
				const result = await pending;
				if (gen === generation) {
					value = result;
					cachedAt = now();
				}
				return result;
			} finally {
				if (inFlight === pending) inFlight = undefined;
			}
		},
		invalidate() {
			generation++;
			cachedAt = Number.NEGATIVE_INFINITY;
			value = undefined;
			inFlight = undefined;
		},
	};
}

/**
 * Event-driven invalidation for {@link createCachedWorkspaceOverview}: the
 * overview lists each workspace folder's top-level entries plus a linked-template
 * count, so it goes stale when a top-level file is created/removed/renamed, when
 * the linked-template set changes, or when workspace folders change. The handler
 * only flags the cache stale (a lazy rebuild on the next turn), so it stays cheap
 * even on busy workspaces. Returned Disposable owns every watcher/subscription.
 */
export function wireWorkspaceOverviewInvalidation(
	invalidate: () => void,
	folders: readonly vscode.WorkspaceFolder[] = vscode.workspace.workspaceFolders ?? [],
): vscode.Disposable {
	let folderWatchers: vscode.Disposable[] = [];
	// Non-recursive `*` pattern: only the folder's direct children matter, since
	// that is all the overview lists. Renames surface as delete + create.
	const registerFolderWatchers = (current: readonly vscode.WorkspaceFolder[]): void => {
		folderWatchers.forEach(d => d.dispose());
		folderWatchers = [];
		for (const folder of current.slice(0, 3)) {
			const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '*'));
			folderWatchers.push(watcher, watcher.onDidCreate(invalidate), watcher.onDidDelete(invalidate));
		}
	};
	registerFolderWatchers(folders);

	const subscriptions = [
		LinkManager.onLinksSaved(invalidate),
		// A changed folder set both alters the overview's folder list AND means the
		// old watchers point at stale folders — rebind them, then invalidate.
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			registerFolderWatchers(vscode.workspace.workspaceFolders ?? []);
			invalidate();
		}),
	];
	return {
		dispose: () => {
			folderWatchers.forEach(d => d.dispose());
			subscriptions.forEach(d => d.dispose());
		},
	};
}
