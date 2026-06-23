/**
 * Shared input-coercion helpers for read capabilities. Mirrors the private
 * helpers in rewstReadCapabilities.ts so additional capability modules can share
 * one consistent argument-parsing contract.
 */

import type { FullTemplateFragment, Session } from '@sessions';

/** Pretty-prints a value as the JSON string capabilities return to callers. */
export function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

/**
 * Fetches a template by id from whichever active session can resolve it,
 * returning the resolving session too. A requiresOrg:false tool has no
 * org-targeted session and one machine can manage several orgs, so try each
 * session rather than assuming the first. Returns undefined when no session
 * resolves the id.
 */
export async function getTemplateFromAnySession(
	sessions: readonly Session[],
	getTemplate: (session: Session, templateId: string) => Promise<FullTemplateFragment>,
	templateId: string,
): Promise<{ template: FullTemplateFragment; session: Session } | undefined> {
	for (const session of sessions) {
		try {
			return { template: await getTemplate(session, templateId), session };
		} catch {
			// Try the next session.
		}
	}
	return undefined;
}

export function asString(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function requireString(input: Record<string, unknown>, key: string): string {
	const value = asString(input, key);
	if (!value) throw new Error(`Missing required string argument "${key}".`);
	return value;
}

export function asPositiveInt(input: Record<string, unknown>, key: string): number | undefined {
	const value = input[key];
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
	const normalized = Math.floor(value);
	return normalized > 0 ? normalized : undefined;
}

export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (!Number.isInteger(limit) || limit <= 0) {
		throw new Error('"limit" must be a positive integer.');
	}
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

/** Standard orgId property block for capability inputSchemas. */
export const ORG_ID_PROP = {
	orgId: { type: 'string', description: 'Rewst organization id the operation runs against (from list_orgs).' },
} as const;
