import { SessionManager } from '@sessions';
import { SchemaManager } from '@notebook';
import { log } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class OpenPlayground extends GenericCommand {
	commandName = 'OpenPlayground';

	async execute(): Promise<void> {
		log.info('OpenPlayground: opening playground notebook');

		const cells = [
			new vscode.NotebookCellData(
				vscode.NotebookCellKind.Markup,
				'# GraphQL Playground\nWrite queries below and press \u25b6 to execute. Session will be selected on first run.',
				'markdown',
			),
			new vscode.NotebookCellData(
				vscode.NotebookCellKind.Code,
				'{\n  user {\n    id\n    username\n  }\n}',
				'graphql',
			),
			new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '{}', 'json'),
		];

		const doc = await vscode.workspace.openNotebookDocument('rewst-playground', new vscode.NotebookData(cells));
		await vscode.window.showNotebookDocument(doc);

		// Fire-and-forget schema generation
		const sessions = SessionManager.getActiveSessions();
		if (sessions.length === 1) {
			SchemaManager.generateSchema(sessions[0]).catch(err =>
				log.debug('OpenPlayground: schema generation failed', err),
			);
		}
	}
}
