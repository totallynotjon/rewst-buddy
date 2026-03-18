import { Session, SessionManager } from '@sessions';
import { log } from '@utils';
import { getIntrospectionQuery } from 'graphql';
import vscode from 'vscode';

export const SchemaManager = new (class SchemaManager implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private lastSchemaSessionOrgId: string | undefined;
	private hasPromptedForConfig = false;

	init(): this {
		this.disposables.push(
			SessionManager.onSessionChange(event => {
				if (event.type === 'cleared') return;
				// Only regenerate if the changed session matches our last used session
				if (!this.lastSchemaSessionOrgId) return;

				const session = event.activeProfiles
					.map(p => SessionManager.getActiveSessions().find(s => s.profile.org.id === p.org.id))
					.find(s => s?.profile.org.id === this.lastSchemaSessionOrgId);

				if (session) {
					this.generateSchema(session).catch(err =>
						log.debug('SchemaManager: background schema regen failed', err),
					);
				}
			}),
		);
		return this;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}

	async generateSchema(session: Session): Promise<void> {
		log.info('SchemaManager: generating schema via introspection');
		try {
			const result = await session.executeRawQuery(getIntrospectionQuery());
			if (!result.data) {
				log.notifyWarn('SchemaManager: introspection returned no data');
				return;
			}

			const folders = vscode.workspace.workspaceFolders;
			if (!folders?.length) {
				log.debug('SchemaManager: no workspace folder, skipping schema write');
				return;
			}

			const rewstDir = vscode.Uri.joinPath(folders[0].uri, '.rewst');
			await vscode.workspace.fs.createDirectory(rewstDir);

			const schemaUri = vscode.Uri.joinPath(rewstDir, 'schema.json');
			const content = new TextEncoder().encode(JSON.stringify(result.data, null, 2));
			await vscode.workspace.fs.writeFile(schemaUri, content);

			this.lastSchemaSessionOrgId = session.profile.org.id;
			log.info('SchemaManager: schema written to .rewst/schema.json');

			if (!this.hasPromptedForConfig) {
				this.hasPromptedForConfig = true;
				this.generateGraphQLConfig().catch(err => log.debug('SchemaManager: config generation failed', err));
			}
		} catch (err) {
			log.notifyWarn(`SchemaManager: introspection failed: ${err}`);
		}
	}

	async generateGraphQLConfig(): Promise<void> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders?.length) return;

		const configUri = vscode.Uri.joinPath(folders[0].uri, '.graphqlrc.yml');

		try {
			await vscode.workspace.fs.stat(configUri);
			log.debug('SchemaManager: .graphqlrc.yml already exists, skipping');
			return;
		} catch {
			// File doesn't exist — proceed
		}

		const answer = await vscode.window.showInformationMessage(
			'Generate .graphqlrc.yml for GraphQL editor completions?',
			'Yes',
			'No',
		);

		if (answer !== 'Yes') return;

		const content = new TextEncoder().encode('schema: .rewst/schema.json\n');
		await vscode.workspace.fs.writeFile(configUri, content);
		log.info('SchemaManager: .graphqlrc.yml created');
	}
})();
