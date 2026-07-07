/**
 * Pure crate-unpack planning: GraphQL documents, crate-detail normalization,
 * dynamic token resolution, UnpackCrateInput construction, and the stream-event
 * loop that consumes the unpackCrate subscription. No `vscode` import anywhere —
 * the transport wiring (websocket, cookies) lives in unpackClient.ts and the UI
 * prompting lives in the InstallCrate command, both built on this module.
 *
 * Crates describe their own configuration dynamically: a crate carries an
 * ordered list of tokens (free-text inputs, single/multi selects with options,
 * and display-only rows) that the Rewst unpack wizard renders. Everything here
 * is driven off that token metadata so any crate's option set is handled
 * without per-crate knowledge.
 */

/** Value(s) supplied for tokens, keyed by token name or token id. */
export type TokenValues = Record<string, string | string[]>;

export interface CrateTokenOptionDetail {
	id?: string;
	label?: string;
	value?: string;
	isDefault?: boolean;
}

export interface CrateTokenDetail {
	id?: string;
	name?: string;
	type?: string;
	index: number;
	value?: string;
	isMultiselect?: boolean;
	previewText?: string;
	emptyLabel?: string;
	options: CrateTokenOptionDetail[];
}

export interface CrateTriggerDetail {
	id: string;
	triggerName?: string;
	/** The underlying trigger's criteria, forwarded verbatim on unpack. */
	criteria?: unknown;
	/** The underlying trigger's own default for the managed-orgs flag. */
	autoActivateManagedOrgs?: boolean;
}

export interface CrateDetail {
	id: string;
	name: string;
	description?: string;
	requiredOrgVariables: string[];
	isUnpackedForSelectedOrg?: boolean;
	/** Default name for the unpacked workflow (the crate's source workflow). */
	workflowName?: string;
	/** The source workflow's time-savings figure, echoed on unpack. */
	humanSecondsSaved?: number;
	tokens: CrateTokenDetail[];
	crateTriggers: CrateTriggerDetail[];
}

/** Lists the crate catalog visible to a session, scoped to one org. */
export const CRATE_LIST_QUERY = `
query RewstBuddyCrateList($orgId: ID, $limit: Int) {
  crates(selectedOrgId: $orgId, limit: $limit) {
    id
    name
    category
    description
    isUnpackedForSelectedOrg
  }
}
`.trim();

/** One crate with everything unpacking needs: tokens, options, and triggers. */
export const CRATE_DETAIL_QUERY = `
query RewstBuddyCrateDetail($crateId: ID, $orgId: ID) {
  crate(selectedOrgId: $orgId, where: { id: $crateId }) {
    id
    name
    description
    requiredOrgVariables
    isUnpackedForSelectedOrg
    workflow {
      name
      humanSecondsSaved
    }
    tokens {
      id
      name
      type
      index
      value
      isMultiselect
      previewText
      emptyLabel
      options {
        id
        label
        value
        isDefault
      }
    }
    crateTriggers {
      id
      trigger {
        id
        name
        criteria
        autoActivateManagedOrgs
      }
    }
  }
}
`.trim();

/**
 * The unpack stream. Progress members only need enough for a status label;
 * failures carry the server error and the success member carries the unpacked
 * object id.
 */
export const UNPACK_CRATE_SUBSCRIPTION = `
subscription RewstBuddyUnpackCrate($unpackingArguments: UnpackCrateInput!) {
  unpackCrate(unpackingArguments: $unpackingArguments) {
    __typename
    ... on UnpackCrateStreamSuccessResponse {
      didSucceed
      isFinished
      id
      orgId
      type
    }
    ... on CloningImportPhaseStreamFailureResponse {
      didSucceed
      isFinished
      error
      code
      phase
    }
    ... on ExportDownloadPhaseStreamFailureResponse {
      didSucceed
      isFinished
      error
      code
      phase
    }
    ... on CloningImportPhaseStreamMessage {
      isFinished
      phase
    }
    ... on ExportDownloadPhaseStreamMessage {
      isFinished
      phase
    }
  }
}
`.trim();

interface RawTokenOption {
	id?: unknown;
	label?: unknown;
	value?: unknown;
	isDefault?: unknown;
}

interface RawToken {
	id?: unknown;
	name?: unknown;
	type?: unknown;
	index?: unknown;
	value?: unknown;
	isMultiselect?: unknown;
	previewText?: unknown;
	emptyLabel?: unknown;
	options?: RawTokenOption[] | null;
}

interface RawCrateTrigger {
	id?: unknown;
	trigger?: { name?: unknown; criteria?: unknown; autoActivateManagedOrgs?: unknown } | null;
}

interface RawCrate {
	id?: unknown;
	name?: unknown;
	description?: unknown;
	requiredOrgVariables?: unknown[] | null;
	isUnpackedForSelectedOrg?: unknown;
	workflow?: { name?: unknown; humanSecondsSaved?: unknown } | null;
	tokens?: RawToken[] | null;
	crateTriggers?: RawCrateTrigger[] | null;
}

function optString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Normalizes the crate-detail response into a CrateDetail, sorting tokens by
 * their wizard index so prompting order matches Rewst's own unpack dialog.
 * Returns undefined when the crate row is absent (unknown id or no access).
 */
export function parseCrateDetail(data: unknown): CrateDetail | undefined {
	const crate = (data as { crate?: RawCrate | null } | null | undefined)?.crate;
	if (!crate || typeof crate.id !== 'string' || crate.id.length === 0) return undefined;

	const tokens: CrateTokenDetail[] = (crate.tokens ?? [])
		.map(raw => ({
			id: optString(raw.id),
			name: optString(raw.name),
			type: optString(raw.type),
			index: typeof raw.index === 'number' ? raw.index : 0,
			value: optString(raw.value),
			isMultiselect: raw.isMultiselect === true,
			previewText: optString(raw.previewText),
			emptyLabel: optString(raw.emptyLabel),
			options: (raw.options ?? []).map(option => ({
				id: optString(option.id),
				label: optString(option.label),
				value: optString(option.value),
				isDefault: option.isDefault === true,
			})),
		}))
		.sort((a, b) => a.index - b.index);

	const crateTriggers: CrateTriggerDetail[] = (crate.crateTriggers ?? [])
		.filter((raw): raw is RawCrateTrigger & { id: string } => typeof raw.id === 'string' && raw.id.length > 0)
		.map(raw => ({
			id: raw.id,
			triggerName: optString(raw.trigger?.name),
			criteria: raw.trigger?.criteria ?? undefined,
			autoActivateManagedOrgs: raw.trigger?.autoActivateManagedOrgs === true,
		}));

	return {
		id: crate.id,
		name: optString(crate.name) ?? '(unnamed crate)',
		description: optString(crate.description),
		requiredOrgVariables: (crate.requiredOrgVariables ?? []).filter(
			(v): v is string => typeof v === 'string' && v.length > 0,
		),
		isUnpackedForSelectedOrg: crate.isUnpackedForSelectedOrg === true,
		workflowName: optString(crate.workflow?.name),
		humanSecondsSaved:
			typeof crate.workflow?.humanSecondsSaved === 'number' ? crate.workflow.humanSecondsSaved : undefined,
		tokens,
		crateTriggers,
	};
}

/**
 * Whether a token carries a user-supplied value. `input*` tokens are free-text
 * and `select*` tokens choose from options; the rest (`text`, `linebreak`,
 * `requires*`) are display-only rows in the unpack wizard.
 */
export function isValueToken(token: CrateTokenDetail): boolean {
	return token.type !== undefined && (token.type.startsWith('input') || token.type.startsWith('select'));
}

/** A token's default: its preset value, else its default option's value. */
export function tokenDefault(token: CrateTokenDetail): string | undefined {
	if (token.value !== undefined) return token.value;
	return token.options.find(option => option.isDefault)?.value;
}

/**
 * A token's raw default before serialization. A multiselect token defaults to
 * every option marked default (the set the web wizard preselects), so its
 * default must ride through the same list serialization as supplied arrays.
 */
function tokenDefaultRaw(token: CrateTokenDetail): string | string[] | undefined {
	if (token.value !== undefined) return token.value;
	if (token.isMultiselect === true) {
		const defaults = token.options
			.filter(option => option.isDefault)
			.map(option => option.value)
			.filter((value): value is string => value !== undefined);
		return defaults.length > 0 ? defaults : undefined;
	}
	return token.options.find(option => option.isDefault)?.value;
}

/**
 * How a supplied value is flattened into the single string the API expects.
 * Multiselect values ride as a Jinja-wrapped JSON list (`{{ ["a","b"] }}`) —
 * the exact serialization the web unpack wizard sends.
 */
function flattenValue(value: string | string[]): string {
	return Array.isArray(value) ? `{{ ${JSON.stringify(value)} }}` : value;
}

export interface ResolvedTokenArguments {
	/** One entry per value-bearing token that resolved, in wizard order. */
	tokenArguments: { crateTokenId: string; value: string }[];
	/** Value tokens with neither a supplied value nor a default. */
	missing: CrateTokenDetail[];
	/** Tokens that resolved from defaults rather than supplied values. */
	defaulted: { token: CrateTokenDetail; value: string }[];
}

/**
 * Resolves every value-bearing token against the supplied values (keyed by
 * token name or id), falling back to the token's default. Display-only tokens
 * are skipped; anything unresolvable is reported in `missing` so callers can
 * prompt for exactly what the crate needs.
 */
export function resolveTokenArguments(tokens: CrateTokenDetail[], provided: TokenValues): ResolvedTokenArguments {
	const tokenArguments: { crateTokenId: string; value: string }[] = [];
	const missing: CrateTokenDetail[] = [];
	const defaulted: { token: CrateTokenDetail; value: string }[] = [];

	for (const token of tokens) {
		if (!isValueToken(token) || token.id === undefined) continue;

		const suppliedRaw =
			(token.name !== undefined ? provided[token.name] : undefined) ?? provided[token.id] ?? undefined;
		// Defaults ride through the same serializer as supplied values, so a
		// multiselect default emits the identical Jinja-list format.
		const raw = suppliedRaw ?? tokenDefaultRaw(token);
		const supplied = suppliedRaw === undefined ? undefined : flattenValue(suppliedRaw);
		const value = raw === undefined ? undefined : flattenValue(raw);
		if (value === undefined) {
			missing.push(token);
			continue;
		}
		if (supplied === undefined) {
			defaulted.push({ token, value });
		}
		tokenArguments.push({ crateTokenId: token.id, value });
	}

	return { tokenArguments, missing, defaulted };
}

export interface UnpackCrateInput {
	crateId: string;
	orgId: string;
	tokenArguments: { crateTokenId: string; value: string }[];
	triggers: {
		crateTriggerId: string;
		triggerName: string;
		enabled: boolean;
		isActivatedForOwner: boolean;
		autoActivateManagedOrgs: boolean;
		activateForOrgIds: string[];
		activateForTagIds: string[];
		criteria: unknown;
	}[];
	/** No orgId here — the target org is the top-level orgId (mirrors the web wizard). */
	workflow: { name: string; humanSecondsSaved: number };
}

export interface BuildUnpackOptions {
	orgId: string;
	/** Name for the unpacked workflow; defaults to the crate name. */
	workflowName?: string;
	tokenValues?: TokenValues;
	/**
	 * Whether the crate's triggers install enabled. Defaults to false — the
	 * safe default is installing with triggers off and enabling in Rewst after
	 * review, so an unpack can never start firing automations by surprise.
	 */
	enableTriggers?: boolean;
}

/**
 * Builds the UnpackCrateInput for one crate. Throws when any value-bearing
 * token cannot be resolved — callers that want to prompt should call
 * resolveTokenArguments first and only build once nothing is missing.
 */
export function buildUnpackInput(crate: CrateDetail, opts: BuildUnpackOptions): UnpackCrateInput {
	const { tokenArguments, missing } = resolveTokenArguments(crate.tokens, opts.tokenValues ?? {});
	if (missing.length > 0) {
		const names = missing.map(token => token.name ?? token.id ?? '(unnamed token)').join('", "');
		throw new Error(`Crate "${crate.name}" needs values for token(s) "${names}".`);
	}

	return {
		crateId: crate.id,
		orgId: opts.orgId,
		tokenArguments,
		// One entry per crate trigger (a crate can carry several); each keeps its
		// own name and criteria, mirroring the web wizard's per-trigger defaults.
		triggers: crate.crateTriggers.map(trigger => ({
			crateTriggerId: trigger.id,
			triggerName: trigger.triggerName ?? crate.name,
			enabled: opts.enableTriggers === true,
			isActivatedForOwner: true,
			autoActivateManagedOrgs: trigger.autoActivateManagedOrgs === true,
			activateForOrgIds: [],
			activateForTagIds: [],
			criteria: trigger.criteria ?? {},
		})),
		workflow: {
			name: opts.workflowName ?? crate.workflowName ?? crate.name,
			humanSecondsSaved: crate.humanSecondsSaved ?? 0,
		},
	};
}

export interface UnpackSuccess {
	id?: string;
	orgId?: string;
	type?: string;
}

export type UnpackEvent =
	| { kind: 'progress'; label: string }
	| ({ kind: 'success' } & UnpackSuccess)
	| { kind: 'failure'; error: string };

interface RawStreamEvent {
	__typename?: unknown;
	didSucceed?: unknown;
	isFinished?: unknown;
	id?: unknown;
	orgId?: unknown;
	type?: unknown;
	error?: unknown;
	code?: unknown;
	phase?: unknown;
}

/**
 * Classifies one unpackCrate stream payload. A success-typed event that did
 * not succeed is a failure — didSucceed is authoritative over the typename.
 */
export function classifyUnpackEvent(payload: unknown): UnpackEvent | undefined {
	if (payload === null || payload === undefined || typeof payload !== 'object') return undefined;
	const event = payload as RawStreamEvent;

	if (typeof event.error === 'string' && event.error.length > 0) {
		return { kind: 'failure', error: event.error };
	}
	if (event.__typename === 'UnpackCrateStreamSuccessResponse') {
		if (event.didSucceed !== true) {
			return { kind: 'failure', error: 'Unpack reported it did not succeed.' };
		}
		return {
			kind: 'success',
			id: optString(event.id),
			orgId: optString(event.orgId),
			type: optString(event.type),
		};
	}
	if (event.didSucceed === false) {
		return { kind: 'failure', error: 'Unpack failed without a server error message.' };
	}
	const label = optString(event.phase) ?? optString(event.__typename) ?? 'working';
	return { kind: 'progress', label };
}

const TIMED_OUT = Symbol('timed-out');

async function nextWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<typeof TIMED_OUT>(resolve => {
				timer = setTimeout(() => resolve(TIMED_OUT), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** Unpacks can be slow (they clone a workflow tree), but each phase streams. */
const DEFAULT_UNPACK_INACTIVITY_TIMEOUT_MS = 300_000;

export interface CollectUnpackOptions {
	/** Resets on every received payload; guards a silently stalled stream. */
	inactivityTimeoutMs?: number;
	/** Tears down the underlying transport when the loop gives up waiting. */
	abort?: () => void;
	onProgress?: (label: string) => void;
}

/**
 * Consumes unpackCrate stream payloads until a terminal event: resolves on
 * success, throws on failure, a stream that ends without a terminal event, or
 * inactivity. Mirrors the runConversation loop shape so it is unit-testable
 * with scripted iterables.
 */
export async function collectUnpackOutcome(
	payloads: AsyncIterable<unknown>,
	options: CollectUnpackOptions,
): Promise<UnpackSuccess> {
	const timeoutMs = options.inactivityTimeoutMs ?? DEFAULT_UNPACK_INACTIVITY_TIMEOUT_MS;
	const iterator = payloads[Symbol.asyncIterator]();
	try {
		for (;;) {
			const step = iterator.next();
			const next = await nextWithTimeout(step, timeoutMs);
			if (next === TIMED_OUT) {
				// The dangling next() settles (or rejects) once abort tears down
				// the transport; swallow it to avoid unhandled rejections.
				step.catch(() => {});
				options.abort?.();
				throw new Error(`No unpack progress for ${Math.round(timeoutMs / 1000)}s; gave up.`);
			}
			if (next.done) {
				throw new Error('The unpack stream ended without reporting success or failure.');
			}

			const event = classifyUnpackEvent(next.value);
			if (event === undefined) continue;
			if (event.kind === 'success') {
				return { id: event.id, orgId: event.orgId, type: event.type };
			}
			if (event.kind === 'failure') {
				throw new Error(`Crate unpack failed: ${event.error}`);
			}
			options.onProgress?.(event.label);
		}
	} finally {
		// Fire-and-forget: a source stalled mid-await would never settle return(),
		// and the transport teardown (abort/dispose) is what actually frees it.
		Promise.resolve(iterator.return?.(undefined)).catch(() => {});
	}
}
