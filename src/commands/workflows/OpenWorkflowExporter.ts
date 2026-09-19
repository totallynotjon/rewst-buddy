import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class OpenWorkflowExporter extends GenericCommand {
	commandName = 'OpenWorkflowExporter';

	async execute(): Promise<void> {
		await vscode.commands.executeCommand('workbench.view.extension.rewst-buddy-sidebar');
		await vscode.commands.executeCommand('rewst-buddy.workflowExporter.focus');
	}
}
