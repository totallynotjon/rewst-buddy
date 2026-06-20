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

/**
 * Formats a `host:port` authority, bracketing IPv6 literals so the result is a
 * valid URL/Host value (e.g. `::1` → `[::1]:port`). Already-bracketed and
 * hostname/IPv4 hosts pass through unchanged.
 */
export function formatHostPort(host: string, port: number): string {
	const trimmed = host.trim();
	const needsBrackets = trimmed.includes(':') && !trimmed.startsWith('[');
	return needsBrackets ? `[${trimmed}]:${port}` : `${trimmed}:${port}`;
}
