import { context } from '@global';
import { log } from '@utils';
import crypto from 'crypto';

/**
 * The MCP endpoint token: a localhost guard the client presents in the standard
 * `Authorization: Bearer <token>` header on every `/mcp` request. It is generated once and
 * persisted, so the client config the user copied keeps working across window
 * reloads (unlike a per-activation token, which would break the config on every
 * restart). It guards only localhost access — it is not a Rewst credential.
 */
const TOKEN_KEY = 'RewstMcpToken';

/**
 * In-memory copy of the active token. `globalState.update` is async, so two
 * getMcpToken() calls racing before the first write lands would otherwise each
 * read `undefined` and mint a different token — invalidating the config the user
 * already copied. Caching the value makes the token stable within the session
 * regardless of when persistence completes.
 */
let cachedToken: string | undefined;

function persist(token: string): void {
	cachedToken = token;
	Promise.resolve(context.globalState.update(TOKEN_KEY, token)).catch(error =>
		log.error('Failed to persist MCP token', error instanceof Error ? error : undefined),
	);
}

/** The stable token, creating and persisting one on first use. */
export function getMcpToken(): string {
	if (cachedToken) return cachedToken;
	const existing = context.globalState.get<string>(TOKEN_KEY);
	if (existing) {
		cachedToken = existing;
		return existing;
	}
	const token = crypto.randomBytes(32).toString('hex');
	persist(token);
	return token;
}

/** Replaces the token with a fresh one (revokes any client still using the old). */
export function rotateMcpToken(): string {
	const token = crypto.randomBytes(32).toString('hex');
	persist(token);
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

/** Exposed for tests: drops the cached token and clears the persisted one. */
export async function _resetMcpTokenForTesting(): Promise<void> {
	cachedToken = undefined;
	await context.globalState.update(TOKEN_KEY, undefined);
}
