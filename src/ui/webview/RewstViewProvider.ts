import vscode from 'vscode';
import { SessionManager } from '@client';
import { log } from '@utils';
import { SessionTreeDataProvider } from './SessionTreeDataProvider';

export class RewstViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'rewst-buddy.sessionInput';
	private view?: vscode.WebviewView;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly sessionTreeProvider: SessionTreeDataProvider,
	) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};

		webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async data => {
			switch (data.type) {
				case 'submitToken':
					await this.handleTokenSubmission(data.token);
					break;
			}
		});
	}

	private async handleTokenSubmission(token: string): Promise<void> {
		if (!token || token.trim().length === 0) {
			return;
		}

		try {
			await SessionManager.createSession(token.trim());
			this.sessionTreeProvider.refresh();
		} catch (error) {
			log.error(`Failed to create session: ${error}`);
		}
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', 'main.css'),
		);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', 'main.js'),
		);

		const nonce = this.getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleUri}" rel="stylesheet">
	<title>Rewst Session</title>
</head>
<body>
	<div class="container">
		<div class="input-group">
			<input type="password" id="tokenInput" placeholder="Enter token/cookie..." />
			<button id="submitBtn" type="button">Connect</button>
		</div>
	</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	private getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
