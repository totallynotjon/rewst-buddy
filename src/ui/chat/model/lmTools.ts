import { extPrefix } from '@global';
import { SessionManager, type Session } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { COMMAND_TOOL_SPECS } from '../tools/commandTool';
import { createGraphqlDeps, GRAPHQL_TOOL_SPECS } from '../tools/graphqlTool';
import type { ToolSpec } from '../tools/toolProtocol';
import { EDIT_TOOL_SPECS, runToolRequests, WORKSPACE_TOOL_SPECS } from '../tools/workspaceTools';
import { WEB_TOOL_SPECS } from '../tools/webTools';

/**
 * Exposes every rewst-tool protocol tool as a registered VS Code language
 * model tool, so they are invocable when the RoboRewsty chat model emits tool
 * calls (and visible to agent mode like any extension tool). The spec arrays
 * remain the single source of truth: registration iterates them, so registered
 * names always equal the text-protocol names, and packageManifest.test.ts
 * keeps the static package.json declarations in sync with the same arrays.
 */

/** Snapshot of the rewst-buddy.ai.* switches that govern tool availability. */
export interface AiToolSettings {
	enableWorkspaceTools: boolean;
	enableEditTools: boolean;
	enableWebTools: boolean;
	enableCommandTool: boolean;
	enableGraphqlTool: boolean;
}

interface GovernedSpec {
	spec: ToolSpec;
	enabled: (settings: AiToolSettings) => boolean;
}

/** Every tool with the settings predicate that governs it. */
export const GOVERNED_TOOL_SPECS: GovernedSpec[] = [
	...WORKSPACE_TOOL_SPECS.map(spec => ({ spec, enabled: (s: AiToolSettings) => s.enableWorkspaceTools })),
	...EDIT_TOOL_SPECS.map(spec => ({
		spec,
		enabled: (s: AiToolSettings) => s.enableWorkspaceTools && s.enableEditTools,
	})),
	...WEB_TOOL_SPECS.map(spec => ({ spec, enabled: (s: AiToolSettings) => s.enableWebTools })),
	...COMMAND_TOOL_SPECS.map(spec => ({ spec, enabled: (s: AiToolSettings) => s.enableCommandTool })),
	...GRAPHQL_TOOL_SPECS.map(spec => ({ spec, enabled: (s: AiToolSettings) => s.enableGraphqlTool })),
];

export const ALL_TOOL_SPECS: ToolSpec[] = GOVERNED_TOOL_SPECS.map(entry => entry.spec);

const GOVERNED_BY_NAME = new Map(GOVERNED_TOOL_SPECS.map(entry => [entry.spec.name, entry]));

export function readAiToolSettings(): AiToolSettings {
	const config = vscode.workspace.getConfiguration(`${extPrefix}.ai`);
	return {
		enableWorkspaceTools:
			config.get<boolean>('enableWorkspaceTools', true) && (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
		enableEditTools: config.get<boolean>('enableEditTools', true),
		enableWebTools: config.get<boolean>('enableWebTools', false),
		enableCommandTool: config.get<boolean>('enableCommandTool', false),
		enableGraphqlTool: config.get<boolean>('enableGraphqlTool', false),
	};
}

/** Names of the tools the current settings permit. */
export function enabledToolNames(settings: AiToolSettings): Set<string> {
	return new Set(GOVERNED_TOOL_SPECS.filter(entry => entry.enabled(settings)).map(entry => entry.spec.name));
}

/**
 * Whether the settings permit a tool. Names outside the rewst tool set are
 * not governed by rewst-buddy settings and are permitted (the chat UI owns
 * their enablement).
 */
export function isToolPermitted(name: string, settings: AiToolSettings): boolean {
	const governed = GOVERNED_BY_NAME.get(name);
	return governed ? governed.enabled(settings) : true;
}

// The chat model's tool calls are invoked by VS Code without org context, so
// the provider records which org the current/last turn targeted and the
// GraphQL tool follows it. Falls back to the single active session.
let lastActiveAiOrgId: string | undefined;

export function setActiveAiOrg(orgId: string): void {
	lastActiveAiOrgId = orgId;
}

function resolveGraphqlSession(): Session | undefined {
	if (lastActiveAiOrgId) {
		try {
			return SessionManager.getSessionForOrg(lastActiveAiOrgId);
		} catch {
			log.debug('lmTools: last active AI org has no session, falling back', lastActiveAiOrgId);
		}
	}
	const sessions = SessionManager.getActiveSessions();
	return sessions.length === 1 ? sessions[0] : undefined;
}

/**
 * Registers every settings-enabled tool with vscode.lm and keeps the
 * registrations in step with configuration changes. Execution-time setting
 * checks inside the tools themselves stay as a second enforcement layer.
 */
export const LmToolRegistry = new (class LmToolRegistry implements vscode.Disposable {
	private registrations = new Map<string, vscode.Disposable>();
	private configListener: vscode.Disposable | undefined;

	init(): this {
		this.sync();
		this.configListener = vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(`${extPrefix}.ai`)) this.sync();
		});
		return this;
	}

	dispose(): void {
		this.configListener?.dispose();
		this.configListener = undefined;
		for (const registration of this.registrations.values()) registration.dispose();
		this.registrations.clear();
	}

	/** Registered tool names, for tests and diagnostics. */
	registeredNames(): Set<string> {
		return new Set(this.registrations.keys());
	}

	private sync(): void {
		const enabled = enabledToolNames(readAiToolSettings());
		for (const [name, registration] of this.registrations) {
			if (!enabled.has(name)) {
				registration.dispose();
				this.registrations.delete(name);
			}
		}
		for (const name of enabled) {
			if (this.registrations.has(name)) continue;
			try {
				this.registrations.set(name, vscode.lm.registerTool(name, this.makeTool(name)));
			} catch (error) {
				// Registration can only fail for names missing from package.json
				// languageModelTools; surface loudly instead of silently dropping.
				log.error(`LmToolRegistry: could not register "${name}": ${error}`);
			}
		}
		log.debug('LmToolRegistry: synced', [...this.registrations.keys()]);
	}

	private makeTool(name: string): vscode.LanguageModelTool<Record<string, unknown>> {
		return {
			invoke: async (options, _token) => {
				const session = resolveGraphqlSession();
				const [result] = await runToolRequests(
					[{ tool: name, args: options.input ?? {} }],
					undefined,
					undefined,
					session ? createGraphqlDeps(session) : undefined,
				);
				const text = result.ok ? result.output : `Error: ${result.output}`;
				return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
			},
		};
	}
})();
