import { isMcpToolCall } from '../packages/mcp-server/src/capabilities/approvalOrigin';
import { hasRequestingEditor, requestAttachedEditor } from '../packages/mcp-server/src/editorBridge';
import { applyTemplateChanged } from './backend/editorEvents';
import { requestEditorMutationApproval, requestEditorWorkingScopeApproval } from './backend/editorHost';
import { initializeBackend, registerEditorCapabilities, subscribe as subscribeBackend } from './backend/operations';
import { CommandInitiater } from '@commands';
import { setMcpMutationApprover, setWorkingScopeApprover } from '@capabilities';
import { extPrefix, context as globalVSContext } from '@global';
import { McpDefinitionProvider, McpServerController } from '@mcp';
import {
	LinkManager,
	RewstContentProvider,
	RewstQuickDiffProvider,
	SyncManager,
	SyncOnSaveManager,
	TemplateBundleManager,
	TemplateMetadataStore,
	WorkingScopeManager,
} from '@models';
import {
	JINJA_SEMANTIC_TOKENS_LEGEND,
	JinjaFilterProvider,
	JinjaSemanticTokensProvider,
	TemplateDefinitionProvider,
	TemplateHoverProvider,
	TemplateNameCompletionProvider,
} from './providers';
import { JinjaPreviewSession } from './ui/jinja/JinjaPreviewSession';
import { JinjaRenderedContentProvider } from './ui/jinja/JinjaRenderedContentProvider';
import { Server } from '@server';
import { SessionManager } from '@sessions';
import {
	BundleTreeDataProvider,
	ContextUsageStatusBar,
	ProposedContentProvider,
	RewstViewProvider,
	RoboRewstyChatModelProvider,
	SessionTreeDataProvider,
	StatusBar,
	WorkingScopeStatusBar,
} from '@ui';
import { log } from '@utils';
import vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	globalVSContext.init(context);
	log.init();
	// Extension-host unit tests use a separate runtime and never probe the user's server.
	context.subscriptions.push(initializeBackend({ shared: context.extensionMode !== vscode.ExtensionMode.Test }));
	context.subscriptions.push(
		subscribeBackend(event => {
			const value = event as {
				type?: string;
				template?: { id: string; name: string; updatedAt?: string | null };
			};
			if (value.type === 'templateChanged' && value.template) {
				applyTemplateChanged(value.template);
			}
		}),
	);

	log.info(`Starting activation of extension ${extPrefix}`);
	setMcpMutationApprover(async (scope, operation, origin) =>
		isMcpToolCall() && !hasRequestingEditor()
			? true
			: hasRequestingEditor()
				? (await requestAttachedEditor('approval.mutation', { scope, operation, origin })) === true
				: requestEditorMutationApproval(scope, operation, origin),
	);
	setWorkingScopeApprover(async (request, origin) =>
		isMcpToolCall() && !hasRequestingEditor()
			? true
			: hasRequestingEditor()
				? (await requestAttachedEditor('approval.scope', { request, origin })) === true
				: requestEditorWorkingScopeApproval(request, origin),
	);

	// Register TreeDataProvider (self-registers for session change events)
	const sessionTreeProvider = new SessionTreeDataProvider();
	context.subscriptions.push(
		sessionTreeProvider,
		vscode.window.registerTreeDataProvider('rewst-buddy.sessionTree', sessionTreeProvider),
	);

	// Register WebviewViewProvider
	const rewstViewProvider = new RewstViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(RewstViewProvider.viewType, rewstViewProvider),
	);

	// Register commands and language providers first so they are available
	// immediately; session loading and the HTTP server start in the background.
	CommandInitiater.registerCommands();

	// Register DefinitionProvider for template({{guid}}) navigation
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider({ scheme: 'file' }, new TemplateDefinitionProvider()),
		vscode.languages.registerHoverProvider({ scheme: 'file' }, new TemplateHoverProvider()),
	);

	// Register Jinja IntelliSense providers for linked files: filter completion/hover,
	// template-name completion inside template("..."), and dialect keyword highlighting.
	const jinjaFilterProvider = new JinjaFilterProvider();
	context.subscriptions.push(
		vscode.languages.registerHoverProvider({ scheme: 'file' }, jinjaFilterProvider),
		vscode.languages.registerCompletionItemProvider({ scheme: 'file' }, jinjaFilterProvider, '|'),
		vscode.languages.registerCompletionItemProvider(
			{ scheme: 'file' },
			new TemplateNameCompletionProvider(),
			'"',
			"'",
		),
		vscode.languages.registerDocumentSemanticTokensProvider(
			{ scheme: 'file' },
			new JinjaSemanticTokensProvider(),
			JINJA_SEMANTIC_TOKENS_LEGEND,
		),
	);

	// Register managers (self-register for their respective VS Code events).
	// SessionManager.init() kicks off session loading in the background;
	// consumers react via onSessionChange when sessions arrive.
	context.subscriptions.push(LinkManager.init());
	context.subscriptions.push(SyncOnSaveManager.init());
	context.subscriptions.push(SessionManager.init());
	context.subscriptions.push(TemplateMetadataStore.init());
	context.subscriptions.push(SyncManager.init());
	// Register BundleTreeDataProvider before init so it catches the first event
	const bundleTreeProvider = new BundleTreeDataProvider();
	context.subscriptions.push(
		bundleTreeProvider,
		vscode.window.registerTreeDataProvider('rewst-buddy.bundleTree', bundleTreeProvider),
	);
	context.subscriptions.push(TemplateBundleManager.init());
	context.subscriptions.push(Server.init());
	// Register after Server.init so the controller starts the localhost server
	// (which hosts the MCP /mcp endpoint) when MCP is enabled.
	context.subscriptions.push(McpServerController.init());
	// Publish the MCP server to VS Code's native MCP surface so it shows up in the
	// editor's server list (the "Add MCP to VS Code" command toggles it on).
	context.subscriptions.push(McpDefinitionProvider.init());
	context.subscriptions.push(new RoboRewstyChatModelProvider().init());
	context.subscriptions.push(ProposedContentProvider.init());
	context.subscriptions.push(RewstContentProvider.init());
	context.subscriptions.push(JinjaRenderedContentProvider.init());
	context.subscriptions.push(JinjaPreviewSession.init());
	// Best-effort: quick-diff gutter decorations for linked files against the
	// remote baseline. Registration/disposal is required; visible gutter
	// decorations from a non-primary SourceControl are not guaranteed by VS Code.
	context.subscriptions.push(RewstQuickDiffProvider.init());
	context.subscriptions.push(WorkingScopeManager.init());
	void registerEditorCapabilities()
		.then(disposable => context.subscriptions.push(disposable))
		.catch(error => log.error('Failed to register editor MCP tools', error));
	context.subscriptions.push(new StatusBar());
	context.subscriptions.push(new WorkingScopeStatusBar());
	context.subscriptions.push(new ContextUsageStatusBar());

	log.info(`Finished activation of extension ${extPrefix}`);
}

export function deactivate() {
	log.info('Deactivating rewst-buddy extension');
	// Server.dispose() is called automatically via context.subscriptions
}
