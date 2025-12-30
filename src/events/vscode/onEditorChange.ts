import { updateStatusBar } from '@ui';
import vscode from 'vscode';

export async function onEditorChange(e?: vscode.TextEditor | undefined) {
	await updateStatusBar(e);
}
