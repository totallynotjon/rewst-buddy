import { extPrefix } from '@global';
import { SessionManager, type Session } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';
import { createGraphqlDeps, graphqlMutationConfirmation, GRAPHQL_TOOL_SPECS } from '../tools/graphqlTool';
import { enabledAiTools } from '../tools/aiToolSettings';
import { describeRequestBrief, type ToolSpec } from '../tools/toolProtocol';
import { runToolRequests, WORKSPACE_TOOL_SPECS } from '../tools/workspaceTools';
import { WEB_TOOL_SPECS } from '../tools/webTools';
import { WORKFLOW_TOOL_SPECS, workflowEditConfirmation } from '../tools/workflowTools';

/**
 * Exposes every vscode-tool protocol tool as a registered VS Code language
 * model tool, so they are invocable when the RoboRewsty chat model emits tool
 * calls (and visible to agent mode like any extension tool). The spec arrays
 * remain the single source of truth: registration iterates them, so registered
 * names always equal the text-protocol names, and packageManifest.test.ts
 * keeps the static package.json declarations in sync with the same arrays.
 */

/** Snapshot of the rewst-buddy.ai.* switches that govern tool availability. */
export interface AiToolSettings {
	enableWorkspaceTools: boolean;
	enableWebTools: boolean;
	enableGraphqlTool: boolean;
	enableWorkflowTools: boolean;
}

interface GovernedSpec {
	spec: ToolSpec;
	enabled: (settings: AiToolSettings) => boolean;
}

/** Every tool with the settings predicate that governs it. */
export const GOVERNED_TOOL_SPECS: GovernedSpec[] = [
	...WORKSPACE_TOOL_SPECS.map(spec => ({ spec, enabled: (s: AiToolSettings) => s.enableWorkspaceTools })),
	...WEB_TOOL_SPECS.map(spec => ({ spec, enabled: (s: AiToolSettings) => s.enableWebTools })),
	...WORKFLOW_TOOL_SPECS.map(spec => ({ spec, enabled: (s: AiToolSettings) => s.enableWorkflowTools })),
	...GRAPHQL_TOOL_SPECS.map(spec => ({ spec, enabled: (s: AiToolSettings) => s.enableGraphqlTool })),
];

export const ALL_TOOL_SPECS: ToolSpec[] = GOVERNED_TOOL_SPECS.map(entry => entry.spec);

const GOVERNED_BY_NAME = new Map(GOVERNED_TOOL_SPECS.map(entry => [entry.spec.name, entry]));

export function readAiToolSettings(): AiToolSettings {
	const tools = enabledAiTools();
	return {
		// Workspace tools also need a workspace folder to be meaningful.
		enableWorkspaceTools: tools.has('workspace') && (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
		enableWebTools: tools.has('web'),
		enableGraphqlTool: tools.has('graphql'),
		enableWorkflowTools: tools.has('workflows'),
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

/**
 * The in-chat approval surface: when RoboRewsty's turn pauses for a Rewst-side
 * action, the provider emits a call to this tool instead of popping a modal.
 * VS Code renders the confirmation inline in the chat (prepareInvocation
 * confirmationMessages); confirming allow-lists the tool(s) and the provider
 * resumes the original request, then reverts the allow-listing after the turn.
 */
export const APPROVAL_TOOL_NAME = 'buddy_approval';

export const APPROVAL_TOOL_SPEC: ToolSpec = {
	name: APPROVAL_TOOL_NAME,
	description:
		'Internal: approves a Rewst-side action Cage-Free Rewsty paused for. Emitted by the Cage-Free Rewsty chat model itself — never request this tool.',
	args: '{"toolNames": string[], "argsPreview"?: string, "orgId": string, "resume": string}',
	inputSchema: {
		type: 'object',
		properties: {
			toolNames: {
				type: 'array',
				items: { type: 'string' },
				description: 'Rewst tool names awaiting approval.',
			},
			argsPreview: { type: 'string', description: 'Human-readable preview of the tool arguments.' },
			orgId: { type: 'string', description: 'Organization the approval applies to.' },
			resume: { type: 'string', description: 'The original request to re-send once approved.' },
		},
		required: ['toolNames', 'orgId', 'resume'],
	},
};

export interface ApprovalToolInput {
	toolNames: string[];
	argsPreview?: string;
	orgId: string;
	resume: string;
}

// Tools approved through the in-chat confirmation, awaiting revert once the
// resumed turn completes (approve-once semantics; the provider drains this).
const onceApprovals = new Map<string, Set<string>>();

export function addOnceApprovals(orgId: string, toolNames: readonly string[]): void {
	const existing = onceApprovals.get(orgId) ?? new Set<string>();
	for (const name of toolNames) existing.add(name);
	onceApprovals.set(orgId, existing);
}

export function takeOnceApprovals(orgId: string): string[] {
	const names = onceApprovals.get(orgId);
	onceApprovals.delete(orgId);
	return names ? [...names] : [];
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
 * The extension's own approval surface for a Rewst-changing tool call: a
 * notification with Allow / Cancel buttons the user must answer every time.
 * Shown from inside the tool's invoke (not VS Code's tool-confirmation
 * affordance), so tool auto-approval — including another agent's — cannot bypass
 * it (#44). Returns true only when the user clicks Allow; Cancel or dismissing
 * the notification declines.
 */
async function confirmRewstToolCall(message: string): Promise<boolean> {
	const allow = 'Allow';
	const choice = await vscode.window.showWarningMessage(message, { modal: false }, allow, 'Cancel');
	return choice === allow;
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
		// The approval surface is not settings-gated — it is the extension's own
		// confirmation channel, not a capability handed to the assistant.
		enabled.add(APPROVAL_TOOL_NAME);
		for (const [name, registration] of this.registrations) {
			if (!enabled.has(name)) {
				registration.dispose();
				this.registrations.delete(name);
			}
		}
		for (const name of enabled) {
			if (this.registrations.has(name)) continue;
			try {
				const registration =
					name === APPROVAL_TOOL_NAME
						? vscode.lm.registerTool(name, this.makeApprovalTool())
						: vscode.lm.registerTool(name, this.makeTool(name));
				this.registrations.set(name, registration);
			} catch (error) {
				// Registration can only fail for names missing from package.json
				// languageModelTools; surface loudly instead of silently dropping.
				log.error(`LmToolRegistry: could not register "${name}": ${error}`);
			}
		}
		log.debug('LmToolRegistry: synced', [...this.registrations.keys()]);
	}

	private makeApprovalTool(): vscode.LanguageModelTool<ApprovalToolInput> {
		return {
			prepareInvocation: async options => {
				const names = options.input.toolNames.map(name => `\`${name}\``).join(', ');
				const preview = options.input.argsPreview ? `\n\n\`\`\`json\n${options.input.argsPreview}\n\`\`\`` : '';
				return {
					invocationMessage: 'Approving Rewst action…',
					confirmationMessages: {
						title: 'Cage-Free Rewsty needs your approval to run a Rewst action',
						message: new vscode.MarkdownString(`${names}${preview}`),
					},
				};
			},
			invoke: async options => {
				const { toolNames, orgId } = options.input;
				const session = SessionManager.getSessionForOrg(orgId);
				for (const toolName of toolNames) {
					await session.sdk?.addAllowedTool({ toolName });
				}
				addOnceApprovals(orgId, toolNames);
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Approved — continuing the request.'),
				]);
			},
		};
	}

	private makeTool(name: string): vscode.LanguageModelTool<Record<string, unknown>> {
		return {
			// Surface what the tool is accessing (its args) in the chat's running
			// indicator instead of just the bare tool name (#22).
			prepareInvocation: async options => ({
				invocationMessage: describeRequestBrief({ tool: name, args: options.input ?? {} }),
			}),
			invoke: async (options, _token) => {
				const input = options.input ?? {};
				// Rewst-changing tools (GraphQL mutations, workflow edit/autolayout/run)
				// must be confirmed EVERY time. We pop our own Allow / Cancel
				// notification from inside invoke — not VS Code's tool-confirmation
				// affordance — so it cannot be auto-approved or allow-listed away, even
				// when another agent (e.g. Copilot agent mode) drives the tool (#44).
				const confirmation = graphqlMutationConfirmation(name, input) ?? workflowEditConfirmation(name, input);
				if (confirmation && !(await confirmRewstToolCall(confirmation))) {
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							'The user declined this action. Do not retry it; ask what they would prefer.',
						),
					]);
				}
				const session = resolveGraphqlSession();
				const [result] = await runToolRequests(
					[{ tool: name, args: input }],
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
