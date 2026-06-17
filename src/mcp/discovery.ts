import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Discovery file the extension writes on activation so the credential-free
 * bridge can find the live localhost server. The default server port is
 * configurable and falls back on EADDRINUSE, and the token rotates every
 * activation, so the bridge must read the current values here rather than
 * assume them.
 *
 * Pure node fs/os/path only (no vscode), so the standalone bridge bundle can
 * reuse the reader.
 */

export interface McpDiscovery {
	/** Port the extension's localhost server is bound to. */
	port: number;
	/** Host the server is bound to (typically 127.0.0.1). */
	host: string;
	/** Per-activation bridge token. */
	token: string;
	/** Extension host process id, so a stale file can be detected. */
	pid: number;
	/** Extension version that wrote the file, for the version handshake. */
	extensionVersion: string;
	/** Wire protocol version the running extension speaks. */
	protocolVersion: number;
	/** ISO timestamp the file was written. */
	writtenAt: string;
}

export function discoveryDir(): string {
	return path.join(os.homedir(), '.rewst-buddy');
}

export function discoveryFilePath(): string {
	return path.join(discoveryDir(), 'mcp.json');
}

/** Writes the discovery file with owner-only permissions (0600). */
export function writeDiscovery(discovery: McpDiscovery, filePath: string = discoveryFilePath()): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const body = JSON.stringify(discovery, null, 2);
	// Write then chmod so the mode is enforced even if the file already existed.
	fs.writeFileSync(filePath, body, { mode: 0o600 });
	fs.chmodSync(filePath, 0o600);
}

/** Removes the discovery file if present; ignores a missing file. */
export function removeDiscovery(filePath: string = discoveryFilePath()): void {
	try {
		fs.unlinkSync(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}

/** Reads and validates the discovery file, or returns undefined if absent/invalid. */
export function readDiscovery(filePath: string = discoveryFilePath()): McpDiscovery | undefined {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, 'utf-8');
	} catch {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null) return undefined;
	const value = parsed as Record<string, unknown>;
	if (
		typeof value.port !== 'number' ||
		typeof value.host !== 'string' ||
		typeof value.token !== 'string' ||
		typeof value.pid !== 'number' ||
		typeof value.extensionVersion !== 'string' ||
		typeof value.protocolVersion !== 'number' ||
		typeof value.writtenAt !== 'string'
	) {
		return undefined;
	}
	return value as unknown as McpDiscovery;
}
