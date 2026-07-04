/**
 * Shared raw wire types and cross-cutting utilities for the workflow module.
 * These are consumed by graphMutations, layout, searchIndex, executions, and
 * the thin workflowTools adapter — kept here to avoid circular imports.
 */

// ---------------------------------------------------------------------------
// Raw read shapes (what the typed GraphQL query returns)
// ---------------------------------------------------------------------------

export interface RawTransition {
	id?: string | null;
	from?: string | null;
	to?: string | null;
	when?: string | null;
	label?: string | null;
	do?: string[] | null;
	publish?: unknown[] | null;
	top?: number | null;
	left?: number | null;
	orientation?: string | null;
	targetHandles?: unknown;
}

// A task's integration override: pins which pack config (integration connection)
// the action runs against instead of the org default. packId is required; the
// rest are optional. Dropping these on an edit silently reverts the task to the
// default integration, so they must round-trip.
export interface PackOverride {
	configSelectionMode?: string | null;
	configFallbackMode?: string | null;
	packId: string;
	packConfigId?: string | null;
	searchInput?: string | null;
}

export interface RawTask {
	id: string;
	name: string;
	actionId?: string | null;
	action?: { id?: string | null; ref?: string | null; name?: string | null } | null;
	description?: string | null;
	input?: unknown;
	packOverrides?: PackOverride[] | null;
	metadata?: unknown;
	transitionMode?: string | null;
	publishResultAs?: string | null;
	join?: number | null;
	timeout?: number | null;
	humanSecondsSaved?: number | null;
	isMocked?: boolean | null;
	mockInput?: unknown;
	runAsOrgId?: string | null;
	securitySchema?: unknown;
	retry?: { count: string; delay?: string | null; when?: string | null } | null;
	with?: { items?: string | null; concurrency?: string | null } | null;
	next?: RawTransition[] | null;
}

export interface RawWorkflow {
	id: string;
	name: string;
	description?: string | null;
	type?: string | null;
	schemaVersion?: string | null;
	version?: string | null;
	orgId: string;
	organization?: { id?: string | null; name?: string | null } | null;
	action?: { parameters?: Record<string, unknown> | null } | null;
	updatedAt?: string | null;
	input?: string[] | null;
	// The caller-visible return contract: an ordered [{name: "<jinja>"}] list a
	// sub-workflow renders at end of run — what its caller reads as RESULT.<name>.
	output?: unknown;
	inputSchema?: unknown;
	outputSchema?: unknown;
	varsSchema?: unknown;
	metadata?: unknown;
	timeout?: number | null;
	tasks: RawTask[];
}

// ---------------------------------------------------------------------------
// Cross-cutting utilities used by multiple workflow sub-modules
// ---------------------------------------------------------------------------

export interface PublishEntry {
	key: string;
	value: unknown;
}

export interface ExecResult {
	data?: unknown;
	errors?: unknown;
}

export function firstErrorMessage(result: ExecResult): string | undefined {
	const errors = result.errors;
	if (Array.isArray(errors) && errors.length > 0) {
		const message = (errors[0] as { message?: unknown }).message;
		return typeof message === 'string' ? message : JSON.stringify(errors[0]);
	}
	return undefined;
}

/**
 * Normalizes the three publish-entry wire shapes into a canonical PublishEntry[].
 * Accepts [{key,value}], a {key: value} object, or an array of single-key objects.
 */
export function normalizePublish(input: unknown): PublishEntry[] {
	if (input == null) return [];
	const entries: PublishEntry[] = [];
	if (Array.isArray(input)) {
		for (const item of input) {
			if (item && typeof item === 'object') {
				const record = item as Record<string, unknown>;
				if (typeof record.key === 'string') {
					entries.push({ key: record.key, value: record.value });
				} else {
					for (const [key, value] of Object.entries(record)) entries.push({ key, value });
				}
			}
		}
	} else if (typeof input === 'object') {
		for (const [key, value] of Object.entries(input as Record<string, unknown>)) entries.push({ key, value });
	}
	return entries;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function asObject(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Identifying fields a workflow-mutation request must carry (org + workflow). */
export const MUTATION_SCOPE_KEYS = ['workflowId', 'workflowName', 'orgId', 'orgName'] as const;

/** A transition with no condition or the built-in {{ SUCCEEDED }} catch-all. */
export function isSuccessCondition(when: string | null | undefined): boolean {
	const normalized = (when ?? '').replace(/[{}]/g, '').replace(/\s+/g, '').toUpperCase();
	return normalized === '' || normalized === 'SUCCEEDED';
}

/**
 * Within each task, custom-condition transitions must precede the success
 * catch-all. Under FOLLOW_FIRST the first matching transition wins, and
 * {{ SUCCEEDED }} is truthy on any success — so a success transition listed
 * first shadows every custom condition after it. Stable-partition keeps each
 * group's order.
 */
export function orderTransitionsByCondition(tasks: RawTask[]): void {
	for (const task of tasks) {
		const transitions = task.next;
		if (!transitions || transitions.length < 2) continue;
		const custom = transitions.filter(t => !isSuccessCondition(t.when));
		const success = transitions.filter(t => isSuccessCondition(t.when));
		if (custom.length > 0 && success.length > 0) task.next = [...custom, ...success];
	}
}
