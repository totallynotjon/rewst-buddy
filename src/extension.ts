import { CommandInitiater } from '@commands';
import { extPrefix, context as globalVSContext } from '@global';
import { LinkManager, SyncManager, SyncOnSaveManager, TemplateBundleManager, TemplateMetadataStore } from '@models';
import { TemplateDefinitionProvider, TemplateHoverProvider } from './providers';
import { Server } from '@server';
import { SessionManager } from '@sessions';
import {
	BundleTreeDataProvider,
	ContextUsageStatusBar,
	LmToolRegistry,
	ProposedContentProvider,
	RewstViewProvider,
	RoboRewstyChatModelProvider,
	SessionTreeDataProvider,
	StatusBar,
} from '@ui';
import { log } from '@utils';
import vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	globalVSContext.init(context);
	log.init();

	log.info(`Starting activation of extension ${extPrefix}`);

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
	context.subscriptions.push(new RoboRewstyChatModelProvider().init());
	context.subscriptions.push(LmToolRegistry.init());
	context.subscriptions.push(ProposedContentProvider.init());
	context.subscriptions.push(new StatusBar());
	context.subscriptions.push(new ContextUsageStatusBar());

	log.info(`Finished activation of extension ${extPrefix}`);
}

export function deactivate() {
	log.info('Deactivating rewst-buddy extension');
	// Server.dispose() is called automatically via context.subscriptions
}
