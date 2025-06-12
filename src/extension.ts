// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import RewstView from '@fs/RewstView.js';
import { CommandContext } from '@commands/models/GenericCommand.js';
import CommandInitiater from '@commands/models/CommandInitiater.js';
import RewstClient from 'rewst-client/RewstClient.js';
import PersistentStorage from 'PersistentStorage/RewstOrgData.js';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "rewst-buddy" is now active!');

	const view = new RewstView(context);
	// view.addSampleData();

	const ctx: CommandContext =
	{
		"commandPrefix": "rewst-buddy",
		"context": context,
		"view": view,
		"fs": view.rewstfs,
		"storage": new PersistentStorage(context)
	}

	CommandInitiater.registerCommands(ctx);

	RewstClient.LoadClients(context).then(clients =>
		clients.forEach(client =>
			view.initializeClient(client)
		)
	);

	console.log('Done loading');

	vscode.commands.executeCommand('rewst-buddy.ReadTest');
	vscode.commands.executeCommand('rewst-buddy.SaveTest');


}

// This method is called when your extension is deactivated
export function deactivate() { }
