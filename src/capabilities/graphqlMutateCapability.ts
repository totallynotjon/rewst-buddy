import { detectOperationType, runMutationGraphql, type MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import { currentApprovalOrigin, type ApprovalOrigin } from './approvalOrigin';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';

export type McpMutationApprover = (scope: MutationScope, operation: string, origin: ApprovalOrigin) => Promise<boolean>;

let approver: McpMutationApprover = async () => false;

export function setMcpMutationApprover(fn: McpMutationApprover): void {
	approver = fn;
}

export function _resetMcpMutationApproverForTesting(): void {
	approver = async () => false;
}

export function requestMcpMutationApproval(scope: MutationScope, operation: string): Promise<boolean> {
	return approver(scope, operation, currentApprovalOrigin());
}

const graphqlMutateSpec: ToolSpec = {
	name: 'buddy_graphql_mutate',
	args: '{"orgId": string, "query": string, "variables"?: object, "scopeId": string, "scopeName": string, "orgName"?: string}',
	description:
		"Run an arbitrary GraphQL mutation against one Rewst organization with the user's session. The dangerous GraphQL mutation setting must be enabled. The request includes the mutation document, optional variables, and the Rewst resource scope that VS Code uses for approval. For editing a trigger's tags, prefer the dedicated buddy_set_trigger_tags tool, and for editing a trigger's org activation or autoActivateManagedOrgs prefer buddy_set_trigger_activation; both read the current state first and merge the change so existing tags or activations are not dropped.",
	inputSchema: {
		type: 'object',
		properties: {
			orgId: { type: 'string', description: 'Rewst organization id the mutation runs against.' },
			query: { type: 'string', description: 'GraphQL mutation document.' },
			variables: { type: 'object', description: 'Optional GraphQL variables.' },
			scopeId: { type: 'string', description: 'Stable id of the Rewst resource being changed.' },
			scopeName: { type: 'string', description: 'Human-readable name of the Rewst resource being changed.' },
			orgName: { type: 'string', description: 'Human-readable name of the Rewst organization.' },
		},
		required: ['orgId', 'query', 'scopeId', 'scopeName'],
	},
};

function requireTrimmedString(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Missing required string argument "${key}".`);
	}
	return value.trim();
}

function optionalTrimmedString(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function parseVariables(input: Record<string, unknown>, ctx: CapabilityContext): Record<string, unknown> | undefined {
	const rawVariables = input.variables;
	if (rawVariables === undefined) return undefined;
	if (!isPlainObject(rawVariables)) {
		throw new Error('"variables" must be a JSON object when provided.');
	}
	if (rawVariables.orgId !== undefined && rawVariables.orgId !== ctx.orgId) {
		throw new Error('"variables.orgId" must match the requested "orgId".');
	}
	return rawVariables;
}

function formatOperationSummary(query: string, variables: Record<string, unknown> | undefined): string {
	const operation = query.trim();
	if (variables === undefined) return operation;
	return `${operation}\n\nVariables:\n${JSON.stringify(variables, null, 2)}`;
}

async function runGraphqlMutate(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const query = requireTrimmedString(input, 'query');
	const kind = detectOperationType(query);
	if (kind === 'subscription') {
		throw new Error('Subscriptions are not supported; this tool runs mutations only.');
	}
	if (kind === 'query') {
		throw new Error('This tool runs mutations only; use buddy_graphql_query for read-only queries.');
	}

	const scopeId = requireTrimmedString(input, 'scopeId');
	const scopeName = requireTrimmedString(input, 'scopeName');
	const orgName = optionalTrimmedString(input, 'orgName') ?? ctx.session.profile.org.name;
	const scope: MutationScope = { scopeId, scopeName, orgId: ctx.orgId, orgName };
	const variables = parseVariables(input, ctx);
	const operation = formatOperationSummary(query, variables);

	// Always prompt, never reuse a scope-keyed approval: the caller supplies an
	// arbitrary scopeId alongside an arbitrary mutation document, so unlike the
	// typed write capabilities (where scopeId is verified against a fetched
	// resource id before the scope is recorded) a scope here has no fixed
	// relationship to what the query actually does. Reusing an approval recorded
	// for one mutation would let a later, unrelated mutation on the same
	// caller-chosen scopeId run unprompted (#177).
	if (!(await requestMcpMutationApproval(scope, operation))) {
		return JSON.stringify({
			status: 'approval_required',
			message:
				'The mutation was not run; it needs approval in the VS Code window running Rewst Buddy. Focus that window to respond to the prompt, then retry. The prompt does not appear in the MCP client and cannot be approved if no VS Code window is open.',
		});
	}

	return runMutationGraphql(query, variables, (q, v) => ctx.session.rawGraphql(q, v));
}

export const graphqlMutateCapability: Capability = writeCapability(graphqlMutateSpec, runGraphqlMutate, {
	dangerous: true,
	requiresOrg: true,
});
