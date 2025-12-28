import vscode from 'vscode';
import { ServerConfig } from './types';

export function getServerConfig(): ServerConfig {
	const config = vscode.workspace.getConfiguration('rewst-buddy.server');
	return {
		enabled: config.get<boolean>('enabled', false),
		port: config.get<number>('port', 27121),
		host: config.get<string>('host', '127.0.0.1'),
	};
}
