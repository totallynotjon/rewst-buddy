/**
 * Shared input-coercion helpers for read capabilities. Mirrors the private
 * helpers in rewstReadCapabilities.ts so additional capability modules can share
 * one consistent argument-parsing contract.
 */

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

/** Standard orgId property block for capability inputSchemas. */
export const ORG_ID_PROP = {
	orgId: { type: 'string', description: 'Rewst organization id the operation runs against (from list_orgs).' },
} as const;
