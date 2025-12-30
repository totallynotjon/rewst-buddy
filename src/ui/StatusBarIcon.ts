import vscode from 'vscode';

export const StatusBarIcon: vscode.StatusBarItem = vscode.window.createStatusBarItem(
	vscode.StatusBarAlignment.Left,
	100,
);
StatusBarIcon.show();
