import { SessionManager, Session } from '@sessions';
import { log } from '@utils';
import vscode from 'vscode';

export class PlaygroundController implements vscode.Disposable {
	private readonly controller: vscode.NotebookController;

	constructor() {
		this.controller = vscode.notebooks.createNotebookController(
			'rewst-playground-executor',
			'rewst-playground',
			'Rewst GraphQL',
		);
		this.controller.supportedLanguages = ['graphql'];
		this.controller.supportsExecutionOrder = false;
		this.controller.executeHandler = this.execute.bind(this);
	}

	dispose(): void {
		this.controller.dispose();
	}

	private async execute(
		cells: vscode.NotebookCell[],
		notebook: vscode.NotebookDocument,
		controller: vscode.NotebookController,
	): Promise<void> {
		for (const cell of cells) {
			await this.executeCell(cell, notebook);
		}
	}

	private async executeCell(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument): Promise<void> {
		const execution = this.controller.createNotebookCellExecution(cell);
		execution.start(Date.now());

		try {
			const query = cell.document.getText();
			if (!query.trim()) {
				execution.replaceOutput([
					new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text('Empty query', 'text/plain')]),
				]);
				execution.end(false, Date.now());
				return;
			}

			// Parse variables from adjacent cell
			const variables = this.getVariablesFromNextCell(cell, notebook);

			// Resolve session
			const session = await this.resolveSession(notebook);
			if (!session) {
				execution.replaceOutput([
					new vscode.NotebookCellOutput([
						vscode.NotebookCellOutputItem.text('No active session. Add a session first.', 'text/plain'),
					]),
				]);
				execution.end(false, Date.now());
				return;
			}

			// Execute query
			const result = await session.executeRawQuery(query, variables);

			const outputItems: vscode.NotebookCellOutputItem[] = [];
			const sessionLabel = session.profile.label;

			if (result.data) {
				outputItems.push(
					vscode.NotebookCellOutputItem.json({
						_session: sessionLabel,
						...((result.data as object) ?? {}),
					}),
				);
			}

			if (result.errors && result.errors.length > 0) {
				outputItems.push(
					vscode.NotebookCellOutputItem.json(
						{ _session: sessionLabel, errors: result.errors },
						'application/vnd.code.notebook.error',
					),
				);
			}

			if (outputItems.length === 0) {
				outputItems.push(vscode.NotebookCellOutputItem.json({ _session: sessionLabel, data: null }));
			}

			execution.replaceOutput([new vscode.NotebookCellOutput(outputItems)]);
			execution.end(!result.errors?.length, Date.now());
		} catch (err: any) {
			log.debug('PlaygroundController: execution error', err);

			const errorMessage = err?.response?.errors
				? JSON.stringify(err.response.errors, null, 2)
				: (err?.message ?? String(err));

			execution.replaceOutput([
				new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(new Error(errorMessage))]),
			]);
			execution.end(false, Date.now());
		}
	}

	private getVariablesFromNextCell(
		cell: vscode.NotebookCell,
		notebook: vscode.NotebookDocument,
	): Record<string, unknown> {
		const nextIndex = cell.index + 1;
		if (nextIndex >= notebook.cellCount) return {};

		const nextCell = notebook.cellAt(nextIndex);
		if (nextCell.document.languageId !== 'json') return {};

		try {
			return JSON.parse(nextCell.document.getText());
		} catch {
			return {};
		}
	}

	private async resolveSession(notebook: vscode.NotebookDocument): Promise<Session | undefined> {
		const sessions = SessionManager.getActiveSessions();
		if (sessions.length === 0) {
			log.notifyWarn('No sessions available. Add a session first.');
			return undefined;
		}

		// Check cached session in notebook metadata
		const cachedOrgId = notebook.metadata?.playgroundSessionOrgId;
		if (cachedOrgId) {
			const cached = sessions.find(s => s.profile.org.id === cachedOrgId);
			if (cached) return cached;
			// Cached session no longer valid — fall through to re-prompt
		}

		// Single session: use automatically
		if (sessions.length === 1) {
			await this.cacheSessionInNotebook(notebook, sessions[0]);
			return sessions[0];
		}

		// Multiple sessions: prompt user
		const items = sessions.map(session => ({
			label: session.profile.label,
			description: session.profile.org.id,
			session,
		}));

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a session for this playground',
		});

		if (!picked) return undefined;

		await this.cacheSessionInNotebook(notebook, picked.session);
		return picked.session;
	}

	private async cacheSessionInNotebook(notebook: vscode.NotebookDocument, session: Session): Promise<void> {
		const edit = new vscode.WorkspaceEdit();
		const metadata = { ...(notebook.metadata ?? {}), playgroundSessionOrgId: session.profile.org.id };
		edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(metadata)]);
		await vscode.workspace.applyEdit(edit);
	}
}
