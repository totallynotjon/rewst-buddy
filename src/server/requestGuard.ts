import { IncomingMessage } from 'http';

/**
 * The subset of an HTTP request the guard needs to decide loopback-only
 * access. Kept as plain data (rather than `IncomingMessage`) so the decision
 * logic is unit-testable without constructing a real socket — see
 * `requestGuardInputFromRequest` for the adapter that builds this from a real
 * request.
 */
export interface RequestGuardInput {
	remoteAddress: string | undefined;
	headers: {
		host?: string;
		'x-forwarded-host'?: string;
		origin?: string;
	};
}

export interface RequestGuardResult {
	allowed: boolean;
	/** Set only when `allowed` is false, for logging. */
	reason?: string;
	/**
	 * The Origin header value to echo back as `Access-Control-Allow-Origin` when
	 * `allowed` is true and the request sent one. Undefined when there was no
	 * Origin header (no browser is enforcing CORS for that request anyway).
	 */
	allowedOrigin?: string;
}

const LOOPBACK_REMOTE_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);
const ALLOWED_EXTENSION_ORIGIN_PROTOCOLS = new Set(['chrome-extension:', 'moz-extension:']);

function isLoopbackRemoteAddress(address: string | undefined): boolean {
	return !!address && LOOPBACK_REMOTE_ADDRESSES.has(address.toLowerCase());
}

/**
 * Strips a port suffix and IPv6 brackets from a `Host`-style header value,
 * returning the bare hostname. Returns undefined for a value that can't be
 * unambiguously parsed (treated as malformed/non-loopback by callers).
 */
function hostnameOf(headerValue: string): string | undefined {
	const trimmed = headerValue.trim();
	if (!trimmed) return undefined;

	const bracketMatch = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
	if (bracketMatch) return bracketMatch[1].toLowerCase();

	const colonCount = (trimmed.match(/:/g) ?? []).length;
	if (colonCount === 0) return trimmed.toLowerCase();
	if (colonCount === 1) {
		const [host, port] = trimmed.split(':');
		return /^\d+$/.test(port) ? host.toLowerCase() : undefined;
	}
	// Multiple colons with no brackets: an unbracketed IPv6 literal (or just
	// malformed) — either way we can't safely split host from port.
	return undefined;
}

function isLoopbackHostname(hostname: string | undefined): boolean {
	return !!hostname && LOOPBACK_HOSTNAMES.has(hostname);
}

/**
 * Decides whether a non-MCP request (session ingestion, template-open) may be
 * served at all. Every check runs before any credential or action handling, so
 * a rejection happens before the request body is ever read. See the
 * credential-server spec's "Reject non-local HTTP requests" requirement.
 */
export function evaluateRequestGuard(input: RequestGuardInput): RequestGuardResult {
	if (!isLoopbackRemoteAddress(input.remoteAddress)) {
		return { allowed: false, reason: `non-loopback remote address: ${input.remoteAddress ?? '(none)'}` };
	}

	const hostHeader = input.headers.host;
	if (!hostHeader) {
		return { allowed: false, reason: 'missing Host header' };
	}
	const hostname = hostnameOf(hostHeader);
	if (!isLoopbackHostname(hostname)) {
		return { allowed: false, reason: `non-loopback or malformed Host header: ${hostHeader}` };
	}

	const forwardedHost = input.headers['x-forwarded-host'];
	if (forwardedHost && !isLoopbackHostname(hostnameOf(forwardedHost))) {
		return { allowed: false, reason: `non-loopback X-Forwarded-Host: ${forwardedHost}` };
	}

	const originHeader = input.headers.origin;
	if (originHeader) {
		let originUrl: URL;
		try {
			originUrl = new URL(originHeader);
		} catch {
			return { allowed: false, reason: `malformed Origin header: ${originHeader}` };
		}
		const isWebOrigin = originUrl.protocol === 'http:' || originUrl.protocol === 'https:';
		const isAllowedExtensionOrigin = ALLOWED_EXTENSION_ORIGIN_PROTOCOLS.has(originUrl.protocol);
		// Web origins must be loopback to be allowed. `URL.host` carries the
		// IPv6-bracketed form that hostnameOf() expects (`.hostname` strips the
		// brackets, which our bracket-aware parser wants).
		if (isWebOrigin) {
			if (!isLoopbackHostname(hostnameOf(originUrl.host))) {
				return { allowed: false, reason: `non-loopback web origin: ${originHeader}` };
			}
		} else if (!isAllowedExtensionOrigin) {
			return { allowed: false, reason: `disallowed Origin scheme: ${originHeader}` };
		}
	}

	return { allowed: true, allowedOrigin: originHeader };
}

/** node lowercases header names; a repeated header arrives as an array. */
function firstHeader(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

/** Adapts a real Node `IncomingMessage` into the guard's plain input shape. */
export function requestGuardInputFromRequest(req: IncomingMessage): RequestGuardInput {
	return {
		remoteAddress: req.socket.remoteAddress,
		headers: {
			host: firstHeader(req.headers.host),
			'x-forwarded-host': firstHeader(req.headers['x-forwarded-host']),
			origin: firstHeader(req.headers.origin),
		},
	};
}
