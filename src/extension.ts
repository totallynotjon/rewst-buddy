import { CommandInitiater } from '@commands';
import { setMcpMutationApprover, setWorkingScopeApprover } from '@capabilities';
import { extPrefix, context as globalVSContext } from '@global';
import { McpDefinitionProvider, McpServerController } from '@mcp';
import {
	LinkManager,
	SyncManager,
	SyncOnSaveManager,
	TemplateBundleManager,
	TemplateMetadataStore,
	WorkingScopeManager,
} from '@models';
import { TemplateDefinitionProvider, TemplateHoverProvider } from './providers';
import { Server } from '@server';
import { SessionManager } from '@sessions';
import {
	BundleTreeDataProvider,
	ContextUsageStatusBar,
	conversationMap,
	ProposedContentProvider,
	RewstViewProvider,
	RoboRewstyChatModelProvider,
	SessionTreeDataProvider,
	StatusBar,
	WorkingScopeStatusBar,
	type PersistedConversationMap,
} from '@ui';
import { log } from '@utils';
import vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	globalVSContext.init(context);
	log.init();

	log.info(`Starting activation of extension ${extPrefix}`);
	setMcpMutationApprover(async (scope, operation, origin) => {
		const requester = origin === 'chat' ? 'Cage-Free Rewsty' : 'An external MCP client';
		const choice = await vscode.window.showWarningMessage(
			`${requester} wants to run a mutation against ${scope.scopeName} (${scope.scopeId}) in org ${scope.orgName} (${scope.orgId}).`,
			{ modal: true, detail: operation },
			'Approve',
		);
		return choice === 'Approve';
	});

	setWorkingScopeApprover(async (request, origin) => {
		const requester = origin === 'chat' ? 'Cage-Free Rewsty' : 'An external MCP client';
		const verb = request.replace ? 'set' : 'add to';
		const orgList = request.orgs.map(org => `${org.name} (${org.id})`).join(', ');
		const detailParts: string[] = [];
		if (request.orgs.length > 0) detailParts.push(`Orgs: ${orgList}`);
		if (request.workflows.length > 0) detailParts.push(`Workflows: ${request.workflows.join(', ')}`);
		const choice = await vscode.window.showWarningMessage(
			`${requester} wants to ${verb} the working scope. Tools will then be allowed to operate within it.`,
			{ modal: true, detail: detailParts.join('\n') },
			'Approve',
		);
		return choice === 'Approve';
	});

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
	// Persist chat continuity across window reloads so warm conversations are
	// reused instead of every chat re-shipping its full transcript statelessly.
	const conversationMapKey = 'RewstConversationMap';
	conversationMap.hydrate({
		load: () => context.workspaceState.get<PersistedConversationMap>(conversationMapKey),
		save: state =>
			void Promise.resolve(context.workspaceState.update(conversationMapKey, state)).catch(error =>
				log.debug('conversationMap: persist failed', error),
			),
	});
	context.subscriptions.push(new RoboRewstyChatModelProvider().init());
	context.subscriptions.push(ProposedContentProvider.init());
	context.subscriptions.push(WorkingScopeManager);
	context.subscriptions.push(new StatusBar());
	context.subscriptions.push(new WorkingScopeStatusBar());
	context.subscriptions.push(new ContextUsageStatusBar());

	log.info(`Finished activation of extension ${extPrefix}`);
}

export function deactivate() {
	log.info('Deactivating rewst-buddy extension');
	// Server.dispose() is called automatically via context.subscriptions
}
