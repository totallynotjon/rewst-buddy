import { context } from '@global';
import crypto from 'crypto';

/**
 * The MCP endpoint token: a localhost guard the client presents in the
 * `x-rewst-mcp-token` header on every `/mcp` request. It is generated once and
 * persisted, so the client config the user copied keeps working across window
 * reloads (unlike a per-activation token, which would break the config on every
 * restart). It guards only localhost access — it is not a Rewst credential.
 */
const TOKEN_KEY = 'RewstMcpToken';

/** The stable token, creating and persisting one on first use. */
export function getMcpToken(): string {
	const existing = context.globalState.get<string>(TOKEN_KEY);
	if (existing) return existing;
	const token = crypto.randomBytes(32).toString('hex');
	void context.globalState.update(TOKEN_KEY, token);
	return token;
}

/** Replaces the token with a fresh one (revokes any client still using the old). */
export function rotateMcpToken(): string {
	const token = crypto.randomBytes(32).toString('hex');
	void context.globalState.update(TOKEN_KEY, token);
	return token;
}

/** Constant-time comparison of a presented token against the active one. */
export function isValidMcpToken(presented: string | undefined): boolean {
	if (typeof presented !== 'string' || presented.length === 0) return false;
	const a = Buffer.from(getMcpToken());
	const b = Buffer.from(presented);
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}
