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

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * True only for the loopback host forms `rewst-buddy.server.host` is allowed to
 * take (`127.0.0.1`, `localhost`, `::1`, `[::1]`, case-insensitive, surrounding
 * whitespace trimmed). Anything else — wildcards (`0.0.0.0`, `::`), LAN/public
 * addresses, or an arbitrary hostname — is not loopback and must not be bound.
 */
export function isLoopbackHost(host: string): boolean {
	return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}
