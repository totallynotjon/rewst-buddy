import type { CapabilityContext } from './Capability';
import { rawGraphqlOrThrow, requireResourceInOrg } from './inputHelpers';

/**
 * Shared read-modify-write plumbing for updateTrigger, reused by every dedicated
 * trigger edit tool (buddy_set_trigger_tags, buddy_set_trigger_activation). It
 * reads the full current trigger state first, applies only the requested delta,
 * always sends createPatch: true so the edit is revertable, then re-reads and
 * reports a before/after diff of the changed fields.
 *
 * Field-name traps this module encodes (see the Trigger output type in
 * schema.graphql and CLAUDE.md's capability-authoring note):
 *   - `tags` (output, resolved objects) ↔ `activatedForTagIds` (input, full-replace).
 *   - `activatedForOrgs` (output, resolved objects) ↔ top-level `activatedForOrgIds`
 *     (input, NOT independently readable — the output only exposes the resolved list).
 *   - `cloneOverrides.activatedForOrgIds` ≠ top-level `activatedForOrgIds`.
 *   - updateTrigger is a partial/merge update for stored top-level fields, so a
 *     delta only needs to carry the fields it changes.
 */

/** A named-object row (tag or org) as resolved on the Trigger output type. */
export interface NamedRef {
	id: string;
	name?: string;
}

/**
 * The readable state of one trigger. Every field here exists on the Trigger
 * output type. Top-level `activatedForOrgIds` (an updateTrigger INPUT) is
 * deliberately absent — it is not readable; `activatedForOrgs` is the resolved
 * activation org list that stands in for it on reads.
 */
export interface TriggerState {
	id: string;
	name?: string;
	enabled?: boolean;
	orgId?: string;
	workflowId?: string;
	formId?: string | null;
	description?: string | null;
	autoActivateManagedOrgs?: boolean;
	criteria?: unknown;
	parameters?: unknown;
	state?: unknown;
	cloneOverrides?: unknown;
	tags: NamedRef[];
	activatedForOrgs: NamedRef[];
}

const TRIGGER_STATE_BY_ID = `query RewstBuddyMcpTriggerStateById($orgId: ID!, $id: ID!) {
  triggers(where: { orgId: $orgId, id: $id }) {
    id
    name
    enabled
    orgId
    workflowId
    formId
    description
    autoActivateManagedOrgs
    criteria
    parameters
    state
    cloneOverrides
    tags { id name }
    activatedForOrgs { id name }
  }
}`;

const UPDATE_TRIGGER = `mutation RewstBuddyMcpUpdateTrigger($trigger: TriggerUpdateInput!, $createPatch: Boolean) {
  updateTrigger(trigger: $trigger, createPatch: $createPatch) { id name orgId }
}`;

interface RawTriggerState {
	id?: string;
	name?: string;
	enabled?: boolean;
	orgId?: string;
	workflowId?: string;
	formId?: string | null;
	description?: string | null;
	autoActivateManagedOrgs?: boolean;
	criteria?: unknown;
	parameters?: unknown;
	state?: unknown;
	cloneOverrides?: unknown;
	tags?: (NamedRef | null)[] | null;
	activatedForOrgs?: (NamedRef | null)[] | null;
}

function normalizeRefs(rows: (NamedRef | null)[] | null | undefined): NamedRef[] {
	return (rows ?? [])
		.filter((row): row is NamedRef => row != null && typeof row.id === 'string')
		.map(row => ({ id: row.id, name: row.name }));
}

function toTriggerState(raw: RawTriggerState): TriggerState {
	return {
		id: raw.id ?? '',
		name: raw.name,
		enabled: raw.enabled,
		orgId: raw.orgId,
		workflowId: raw.workflowId,
		formId: raw.formId,
		description: raw.description,
		autoActivateManagedOrgs: raw.autoActivateManagedOrgs,
		criteria: raw.criteria,
		parameters: raw.parameters,
		state: raw.state,
		cloneOverrides: raw.cloneOverrides,
		tags: normalizeRefs(raw.tags),
		activatedForOrgs: normalizeRefs(raw.activatedForOrgs),
	};
}

/**
 * Fetches the full readable state of one trigger, or undefined when the id is
 * unknown in the org. The query is org-filtered, so a returned row is in-org.
 */
export async function fetchTriggerState(
	ctx: CapabilityContext,
	orgId: string,
	triggerId: string,
): Promise<TriggerState | undefined> {
	const data = await rawGraphqlOrThrow(ctx.session, TRIGGER_STATE_BY_ID, { orgId, id: triggerId });
	const rows = ((data as { triggers?: RawTriggerState[] } | undefined)?.triggers ?? []) as RawTriggerState[];
	const row = rows.find(r => r.id === triggerId);
	return row ? toTriggerState(row) : undefined;
}

/**
 * Fetches a trigger's full state and fails closed unless it belongs to the
 * requested org. A session can manage several orgs and updateTrigger targets the
 * trigger by id alone, so this re-verification is what confines a by-id edit to
 * the requested org.
 */
export async function requireTriggerState(
	ctx: CapabilityContext,
	triggerId: string,
	orgId: string,
): Promise<TriggerState> {
	return requireResourceInOrg({
		label: 'Trigger',
		id: triggerId,
		orgId,
		fetch: () => fetchTriggerState(ctx, orgId, triggerId),
	});
}

/** The tag ids currently on a trigger (deduped, order preserved). */
export function tagIdsOf(state: TriggerState): string[] {
	return dedupe(state.tags.map(tag => tag.id));
}

/** The activation org ids currently resolved on a trigger (from activatedForOrgs). */
export function activatedOrgIdsOf(state: TriggerState): string[] {
	return dedupe(state.activatedForOrgs.map(org => org.id));
}

export function dedupe(ids: string[]): string[] {
	return [...new Set(ids)];
}

/** The add/remove/replace operations the dedicated trigger edit tools expose. */
export type IdSetOperation = 'add' | 'remove' | 'replace';

/**
 * Merges a requested id set into the current one for a full-replace input field
 * (activatedForTagIds, activatedForOrgIds). `add` appends (deduped), `remove`
 * drops the requested ids, `replace` sets exactly the requested ids (deduped).
 * The result is what the caller sends as the full field value.
 */
export function mergeIdSet(operation: IdSetOperation, current: string[], requested: string[]): string[] {
	const requestedSet = new Set(requested);
	switch (operation) {
		case 'add':
			return dedupe([...current, ...requested]);
		case 'remove':
			return current.filter(id => !requestedSet.has(id));
		case 'replace':
			return dedupe(requested);
	}
}

/**
 * A comparable, printable projection of a trigger's state. Arrays of resolved
 * objects collapse to sorted id lists so a diff is stable and readable. The org
 * activation list is surfaced as `activatedForOrgIds`, derived from the readable
 * `activatedForOrgs` (the top-level input of that name is not itself readable).
 */
function comparable(state: TriggerState): Record<string, unknown> {
	return {
		name: state.name,
		enabled: state.enabled,
		workflowId: state.workflowId,
		formId: state.formId,
		description: state.description,
		autoActivateManagedOrgs: state.autoActivateManagedOrgs,
		criteria: state.criteria,
		parameters: state.parameters,
		state: state.state,
		cloneOverrides: state.cloneOverrides,
		tagIds: [...state.tags.map(tag => tag.id)].sort(),
		activatedForOrgIds: [...state.activatedForOrgs.map(org => org.id)].sort(),
	};
}

export type TriggerFieldDiff = Record<string, { before: unknown; after: unknown }>;

/**
 * JSON.stringify with object keys in sorted order at every nesting level, so
 * two reads of the same raw field (criteria, parameters, cloneOverrides) that
 * differ only in key order compare equal. Array order is preserved — it can be
 * meaningful in these fields.
 */
function stableStringify(value: unknown): string | undefined {
	return JSON.stringify(value, (_key, val: unknown) => {
		if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
			return Object.fromEntries(
				Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
			);
		}
		return val;
	});
}

/**
 * Field-by-field before/after diff over the comparable projection. Only fields
 * whose serialized value changed are included. This surfaces both the requested
 * change and any side-effect the write did not ask for (e.g. an activation-org
 * shift after a tag edit — the open concern in issue #181).
 */
export function diffTriggerStates(before: TriggerState, after: TriggerState): TriggerFieldDiff {
	const b = comparable(before);
	const a = comparable(after);
	const diff: TriggerFieldDiff = {};
	for (const key of Object.keys(a)) {
		if (stableStringify(b[key]) !== stableStringify(a[key])) {
			diff[key] = { before: b[key], after: a[key] };
		}
	}
	return diff;
}

export interface TriggerUpdateResult {
	before: TriggerState;
	after: TriggerState;
	/** Fields whose value changed between the pre-write and post-write reads. */
	changed: TriggerFieldDiff;
}

/**
 * Applies a delta to one trigger through updateTrigger with createPatch: true
 * (so the edit is revertable), then re-reads and diffs. The caller passes the
 * `before` state it already read for verification/summary, and a `delta` that is
 * the exact TriggerUpdateInput fields to change — for full-replace fields
 * (activatedForTagIds, activatedForOrgIds) the caller must have already merged
 * the delta with the current set. This helper never merges; it only writes,
 * re-reads, and diffs.
 */
export async function runTriggerUpdate(
	ctx: CapabilityContext,
	opts: { triggerId: string; orgId: string; delta: Record<string, unknown>; before: TriggerState },
): Promise<TriggerUpdateResult> {
	const trigger = { id: opts.triggerId, ...opts.delta };
	const data = await rawGraphqlOrThrow(ctx.session, UPDATE_TRIGGER, { trigger, createPatch: true });
	const updated = (data as { updateTrigger?: { id?: string } } | undefined)?.updateTrigger;
	if (!updated?.id) throw new Error('updateTrigger returned no trigger; the mutation may have failed.');
	const after = await requireTriggerState(ctx, opts.triggerId, opts.orgId);
	return { before: opts.before, after, changed: diffTriggerStates(opts.before, after) };
}
