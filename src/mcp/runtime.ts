import crypto from 'crypto';

/**
 * Process-lifetime MCP runtime state: the per-activation bridge token. Generated
 * once on activation and rotated each time the extension host starts, so a
 * leaked token from a previous session is useless. The server validates the
 * `x-rewst-mcp-token` header against this value; the bridge reads it from the
 * discovery file the controller writes.
 */
let currentToken: string | undefined;

/** Generates and stores a fresh token, returning it. */
export function rotateMcpToken(): string {
	currentToken = crypto.randomBytes(32).toString('hex');
	return currentToken;
}

/** The active token, or undefined before the first rotation. */
export function getMcpToken(): string | undefined {
	return currentToken;
}

/** Clears the token (on dispose). */
export function clearMcpToken(): void {
	currentToken = undefined;
}

/**
 * Constant-time-ish comparison of a presented token against the active one.
 * Returns false when no token is set or lengths differ.
 */
export function isValidMcpToken(presented: string | undefined): boolean {
	if (!currentToken || typeof presented !== 'string') return false;
	const a = Buffer.from(currentToken);
	const b = Buffer.from(presented);
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}
