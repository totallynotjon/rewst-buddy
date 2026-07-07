/**
 * Shared input-coercion and GraphQL plumbing helpers for capabilities, so every
 * capability module shares one consistent argument-parsing and error-handling
 * contract.
 */

import type { FullTemplateFragment, Session } from '@sessions';
import { z } from 'zod';

/** Pretty-prints a value as the JSON string capabilities return to callers. */
export function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function throwOnGraphqlErrors(errors: unknown): void {
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
}

/**
 * Runs a raw GraphQL operation and throws with the serialized errors when the
 * response carries any, so a failure is never silently treated as empty data.
 */
export async function rawGraphqlOrThrow(
	session: Session,
	query: string,
	variables?: Record<string, unknown>,
): Promise<unknown> {
	const { data, errors } = await session.rawGraphql(query, variables);
	throwOnGraphqlErrors(errors);
	return data;
}

/**
 * Fetches a resource by id and fails closed unless it belongs to the requested
 * org. A session can manage several orgs and by-id mutations target the resource
 * alone, so this re-verification is what actually confines a by-id write to the
 * requested org. `fetch` returns the resource row (or undefined when the id is
 * unknown); `inOrg` overrides the default `row.orgId === orgId` membership check.
 */
export async function requireResourceInOrg<T>(opts: {
	label: string;
	id: string;
	orgId: string;
	fetch: () => Promise<T | undefined>;
	inOrg?: (row: T) => boolean;
}): Promise<T> {
	const row = await opts.fetch();
	const inOrg = opts.inOrg ?? ((candidate: T) => (candidate as { orgId?: unknown }).orgId === opts.orgId);
	if (row == null || !inOrg(row)) {
		throw new Error(`${opts.label} ${opts.id} is not in org ${opts.orgId}.`);
	}
	return row;
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
	// A session that does not manage the template's org throws a "not found"
	// error — expected, so try the next session. But an auth/network/SDK failure
	// must not be silently swallowed into a "not found" outcome; remember it and,
	// if no session resolves the id, surface it rather than masking an outage.
	let operationalError: unknown;
	for (const session of sessions) {
		try {
			return { template: await getTemplate(session, templateId), session };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/not found/i.test(message)) operationalError = error;
		}
	}
	if (operationalError !== undefined) throw operationalError;
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

/**
 * Like requireString but accepts an empty string as a valid value.
 * Throws only when the key is absent or the value is not a string.
 */
export function requireStringAllowEmpty(input: Record<string, unknown>, key: string): string {
	if (!(key in input) || typeof input[key] !== 'string') {
		throw new Error(`Missing required string argument "${key}".`);
	}
	return input[key] as string;
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
	orgId: { type: 'string', description: 'Rewst organization id the operation runs against (from buddy_list_orgs).' },
} as const;

// ---------------------------------------------------------------------------
// Zod-based helpers (C2 migration)
// ---------------------------------------------------------------------------

/**
 * Parses input through a capability's Zod schema, throwing a single clean
 * message (the first validation issue) instead of ZodError's default
 * JSON-dump message.
 */
export function parseCapabilityInput<T>(schema: z.ZodType<T>, input: Record<string, unknown>): T {
	const result = schema.safeParse(input);
	if (result.success) return result.data;
	throw new Error(result.error.issues[0]?.message ?? 'Invalid input.');
}

const JSON_SCHEMA_TARGET = 'draft-07';

/**
 * Derives an MCP inputSchema from a Zod object schema, stripping the
 * `$schema` meta key `z.toJSONSchema` always adds (noise for our purposes).
 */
export function toInputSchema(schema: z.ZodObject<z.ZodRawShape>): object {
	const { $schema: _schema, ...rest } = z.toJSONSchema(schema, { target: JSON_SCHEMA_TARGET }) as Record<
		string,
		unknown
	>;
	return rest;
}

/**
 * Zod counterpart to requireString: required, trimmed, non-empty string.
 * Missing key, wrong type, and empty-after-trim all produce the same
 * message, matching requireString's behavior exactly.
 */
export function requiredStringField(key: string): z.ZodString {
	const message = `Missing required string argument "${key}".`;
	return z.string({ error: message }).trim().min(1, { error: message });
}

/**
 * Zod counterpart to asString: optional, trimmed string. Missing key, wrong
 * type, and empty-after-trim all silently resolve to undefined — never
 * throws — matching asString's behavior exactly.
 */
export function optionalStringField(): z.ZodType<string | undefined> {
	return z
		.preprocess(raw => (typeof raw === 'string' ? raw.trim() : raw), z.string().min(1).optional())
		.catch(undefined);
}

/**
 * Zod counterpart to `Math.min(asPositiveInt(input, key) ?? DEFAULT, MAX)`.
 * Reproduces asPositiveInt exactly: non-number, non-finite, <= 0, and
 * floor-to-<=0 inputs all silently resolve to undefined (never throw); a
 * valid value is floored then clamped to `max`. Callers still apply
 * `?? DEFAULT` after parsing, exactly as today.
 */
export function optionalClampedInt(max: number): z.ZodType<number | undefined> {
	return z.preprocess(raw => {
		if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
		const floored = Math.floor(raw);
		return floored > 0 ? Math.min(floored, max) : undefined;
	}, z.number().positive().max(max).optional());
}

/**
 * Zod counterpart to requireStringAllowEmpty: required string that may be
 * empty (e.g. template body, org-variable value). Missing key or non-string
 * type throws; empty string is accepted.
 */
export function requiredStringAllowEmptyField(key: string): z.ZodString {
	const message = `Missing required string argument "${key}".`;
	return z.string({ error: message });
}

/**
 * Optional boolean field that rejects non-boolean values with a clear message.
 * Missing key resolves to undefined; wrong type throws.
 */
export function optionalBooleanField(key: string): z.ZodType<boolean | undefined> {
	return z.preprocess(
		raw => (raw === undefined ? undefined : raw),
		z
			.boolean({
				error: `"${key}" must be a boolean.`,
			})
			.optional(),
	);
}

/**
 * Shared orgId field for read-capability schemas; description text matches
 * the existing ORG_ID_PROP so the two stay in sync until every capability
 * migrates.
 */
export const ORG_ID_FIELD: z.ZodString = requiredStringField('orgId').describe(ORG_ID_PROP.orgId.description);
