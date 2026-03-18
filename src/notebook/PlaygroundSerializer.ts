import vscode from 'vscode';

interface PlaygroundCell {
	kind: 'code' | 'markup';
	language: string;
	value: string;
}

interface PlaygroundNotebookData {
	version: 1;
	cells: PlaygroundCell[];
}

export class PlaygroundSerializer implements vscode.NotebookSerializer {
	deserializeNotebook(content: Uint8Array): vscode.NotebookData {
		const text = new TextDecoder().decode(content);

		let raw: PlaygroundNotebookData;
		try {
			raw = JSON.parse(text);
		} catch {
			// Malformed JSON: return notebook with empty query cell
			return new vscode.NotebookData([new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'graphql')]);
		}

		const cells = (raw.cells ?? []).map(cell => {
			const kind = cell.kind === 'markup' ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code;
			return new vscode.NotebookCellData(kind, cell.value ?? '', cell.language ?? 'graphql');
		});

		if (cells.length === 0) {
			cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'graphql'));
		}

		return new vscode.NotebookData(cells);
	}

	serializeNotebook(data: vscode.NotebookData): Uint8Array {
		const cells: PlaygroundCell[] = data.cells.map(cell => ({
			kind: cell.kind === vscode.NotebookCellKind.Markup ? 'markup' : 'code',
			language: cell.languageId,
			value: cell.value,
		}));

		const notebook: PlaygroundNotebookData = { version: 1, cells };
		return new TextEncoder().encode(JSON.stringify(notebook, null, '\t'));
	}
}
