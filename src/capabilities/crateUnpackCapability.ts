import { z } from 'zod';
import {
	buildUnpackInput,
	CRATE_DETAIL_QUERY,
	parseCrateDetail,
	resolveTokenArguments,
	tokenDefault,
	type CrateDetail,
	type CrateTokenDetail,
	type TokenValues,
	type UnpackSuccess,
} from '../crates/crateUnpack';
import { runUnpackCrate, type UnpackTransportOptions } from '../crates/unpackClient';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';
import {
	json,
	ORG_ID_FIELD,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	requiredStringField,
	toInputSchema,
} from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';

/**
 * buddy_unpack_crate — install ("unpack") a prebuilt Rewst Crate into an org.
 *
 * Crates configure themselves dynamically through tokens (free-text inputs and
 * single/multi selects with option lists), so this capability is a two-step
 * conversation: called without enough token values it returns a structured
 * `input_required` payload describing exactly what the crate needs (never
 * prompting or mutating), and called with every value resolvable it runs the
 * unpackCrate subscription behind the standard per-call write approval.
 */

export type UnpackOutcome = UnpackSuccess;
export type { UnpackTransportOptions };

type UnpackTransport = (options: UnpackTransportOptions) => Promise<UnpackOutcome>;

let unpackTransport: UnpackTransport = runUnpackCrate;

/** Replaces the websocket transport in unit tests; pass undefined to restore. */
export function _setUnpackTransportForTesting(transport: UnpackTransport | undefined): void {
	unpackTransport = transport ?? runUnpackCrate;
}

const tokenValuesSchema: z.ZodType<TokenValues | undefined> = z
	.record(z.string(), z.union([z.string(), z.array(z.string())]))
	.optional()
	.describe(
		"Values for the crate's configuration tokens, keyed by token name (or token id). Multiselect tokens accept an array of option values. Call once without this to discover what the crate needs — the input_required response lists every token with its type, options, and default.",
	);

const unpackCrateInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	crateId: requiredStringField('crateId').describe('Id of the crate to unpack (from buddy_search_crates).'),
	workflowName: z
		.preprocess(raw => (typeof raw === 'string' ? raw.trim() : raw), z.string().min(1).optional())
		.catch(undefined)
		.describe('Name for the unpacked workflow; defaults to the crate name.') as z.ZodType<string | undefined>,
	tokenValues: tokenValuesSchema,
	enableTriggers: z
		.boolean()
		.optional()
		.describe(
			"Whether the crate's triggers install enabled. Defaults to false — the safe default installs triggers disabled so nothing fires until a human reviews them in Rewst.",
		),
});

/** One missing token, described richly enough to prompt or pick dynamically. */
function describeToken(token: CrateTokenDetail): Record<string, unknown> {
	const described: Record<string, unknown> = {
		id: token.id,
		name: token.name,
		type: token.type,
	};
	if (token.isMultiselect === true) described.isMultiselect = true;
	if (token.previewText !== undefined) described.hint = token.previewText;
	if (token.emptyLabel !== undefined) described.emptyLabel = token.emptyLabel;
	const defaultValue = tokenDefault(token);
	if (defaultValue !== undefined) described.default = defaultValue;
	if (token.options.length > 0) {
		described.options = token.options.map(option => ({
			label: option.label,
			value: option.value,
			isDefault: option.isDefault === true || undefined,
		}));
	}
	return described;
}

async function fetchCrateDetail(ctx: CapabilityContext, crateId: string, orgId: string): Promise<CrateDetail> {
	const data = await rawGraphqlOrThrow(ctx.session, CRATE_DETAIL_QUERY, { crateId, orgId });
	const crate = parseCrateDetail(data);
	if (!crate) {
		throw new Error(`Crate ${crateId} was not found or is not visible to this session.`);
	}
	return crate;
}

async function runUnpackCrateCapability(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const parsed = parseCapabilityInput(unpackCrateInputSchema, input);
	const { orgId, crateId, workflowName, enableTriggers } = parsed;
	const tokenValues = parsed.tokenValues ?? {};

	const crate = await fetchCrateDetail(ctx, crateId, orgId);

	// Dynamic configuration handshake: when anything the crate needs is still
	// unresolved, describe every gap (and what resolved via defaults, so those
	// can be overridden in the same retry) instead of prompting or mutating.
	const resolution = resolveTokenArguments(crate.tokens, tokenValues);
	if (resolution.missing.length > 0) {
		return json({
			status: 'input_required',
			crateId: crate.id,
			crateName: crate.name,
			message:
				'The crate needs values for the tokens below. Retry with tokenValues covering at least the missing tokens (keyed by token name or id); resolvedTokens show defaults that will be used unless overridden.',
			missingTokens: resolution.missing.map(describeToken),
			resolvedTokens: resolution.defaulted.map(({ token, value }) => ({
				name: token.name ?? token.id,
				value,
			})),
			requiredOrgVariables: crate.requiredOrgVariables,
		});
	}

	const unpackInput = buildUnpackInput(crate, { orgId, workflowName, tokenValues, enableTriggers });

	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: crate.id, scopeName: crate.name, orgId, orgName };
	const summary = `Unpack crate "${crate.name}" (${crate.id}) into org "${orgName}" (${orgId}) as workflow "${unpackInput.workflow.name}"`;

	return withMutationApproval(scope, summary, async () => {
		const outcome = await unpackTransport({ session: ctx.session, input: unpackInput });
		return json({
			status: 'unpacked',
			crateId: crate.id,
			crateName: crate.name,
			orgId,
			workflowName: unpackInput.workflow.name,
			unpackedId: outcome.id,
			unpackedType: outcome.type,
			triggersEnabled: enableTriggers === true,
			// Org variables the crate expects to exist; surface them so the caller
			// can verify or create them (buddy_list_org_variables / create).
			requiredOrgVariables: crate.requiredOrgVariables,
		});
	});
}

const unpackCrateSpec: ToolSpecDefinition = {
	name: 'buddy_unpack_crate',
	description:
		'Unpack (install) a prebuilt Rewst Crate into one organization, creating its workflow and triggers. Crates declare their own configuration tokens; call this without tokenValues first and it returns input_required listing every token the crate needs (with types, options, and defaults) — then retry with tokenValues filled in. Triggers install disabled unless enableTriggers is true. Requires write tools to be enabled and per-call approval in VS Code. Use buddy_search_crates to find crate ids.',
	inputSchema: toInputSchema(unpackCrateInputSchema),
};

export const crateUnpackCapability: Capability = writeCapability(unpackCrateSpec, runUnpackCrateCapability);
