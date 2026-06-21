import {
	approveMutationScope,
	detectOperationType,
	isMutationScopeApproved,
	runMutationGraphql,
	type MutationScope,
} from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';

export type McpMutationApprover = (scope: MutationScope, operation: string) => Promise<boolean>;

let approver: McpMutationApprover = async () => false;

export function setMcpMutationApprover(fn: McpMutationApprover): void {
	approver = fn;
}

export function _resetMcpMutationApproverForTesting(): void {
	approver = async () => false;
}

export function requestMcpMutationApproval(scope: MutationScope, operation: string): Promise<boolean> {
	return approver(scope, operation);
}

const graphqlMutateSpec: ToolSpec = {
	name: 'rewst_graphql_mutate',
	args: '{"orgId": string, "query": string, "variables"?: object, "scopeId": string, "scopeName": string, "orgName"?: string}',
	description:
		"Run an arbitrary GraphQL mutation against one Rewst organization with the user's session. The dangerous GraphQL mutation setting must be enabled. The request includes the mutation document, optional variables, and the Rewst resource scope that VS Code uses for approval.",
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
		throw new Error('This tool runs mutations only; use rewst_graphql_query for read-only queries.');
	}

	const scopeId = requireTrimmedString(input, 'scopeId');
	const scopeName = requireTrimmedString(input, 'scopeName');
	const orgName = optionalTrimmedString(input, 'orgName') ?? ctx.session.profile.org.name;
	const scope: MutationScope = { scopeId, scopeName, orgId: ctx.orgId, orgName };
	const variables = parseVariables(input, ctx);
	const operation = formatOperationSummary(query, variables);

	if (!isMutationScopeApproved(scope)) {
		if (!(await approver(scope, operation))) {
			return JSON.stringify({
				status: 'approval_required',
				message:
					'The mutation was not run. The user must approve it in VS Code (a modal appears in their editor); retry after they approve.',
			});
		}
		approveMutationScope(scope);
	}

	return runMutationGraphql(query, variables, (q, v) => ctx.session.rawGraphql(q, v));
}

export const graphqlMutateCapability: Capability = {
	spec: graphqlMutateSpec,
	access: 'write',
	dangerous: true,
	chat: false,
	mcp: true,
	requiresOrg: true,
	run: runGraphqlMutate,
};
