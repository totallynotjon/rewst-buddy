import { extPrefix } from '@global';
import type { Session } from '@sessions';
import vscode from 'vscode';
import type { ToolRequest, ToolSpec } from './toolProtocol';

/**
 * rewst_graphql lets RoboRewsty compose and run GraphQL operations against the
 * user's own Rewst instance, authenticated with their session cookie. The
 * assistant already knows Rewst's domain; this gives it live access to the
 * same API the extension itself uses.
 *
 *   - Off by default (rewst-buddy.ai.enableGraphqlTool): the session can read
 *     and change anything the user can in Rewst.
 *   - Queries run directly once enabled; mutations always require explicit
 *     user approval — VS Code's native inline chat confirmation (Continue /
 *     Cancel) showing the full operation, gated at the tool's prepareInvocation
 *     (see lmTools.ts). There is no auto-approve escape hatch.
 *   - Every mutation MUST carry a scopeId: a stable id of the single resource
 *     it changes (e.g. the workflow id), which the assistant supplies. Approval
 *     is remembered per scopeId for the session, so confirming one change to a
 *     resource lets further mutations to that same resource run without
 *     re-asking, while a different resource (or a mutation with no scopeId) is
 *     gated again. A mutation without a scopeId is refused.
 *   - Subscriptions are rejected (the tool protocol is request/response).
 */

const MAX_OUTPUT_CHARS = 8_000;

export const GRAPHQL_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'rewst_graphql_schema',
		args: '{"typeName"?: string, "search"?: string, "includeDeprecated"?: boolean}',
		description:
			'Inspect the Rewst GraphQL schema with the user session before composing operations. With no args, lists root Query/Mutation/Subscription fields. Use typeName to inspect fields/input fields/enum values for one type. Use search to find matching type names and root operation fields.',
		inputSchema: {
			type: 'object',
			properties: {
				typeName: { type: 'string', description: 'Inspect one named GraphQL type.' },
				search: { type: 'string', description: 'Find matching type names and root operation fields.' },
				includeDeprecated: { type: 'boolean', description: 'Include deprecated fields/values.' },
			},
		},
	},
	{
		name: 'rewst_graphql',
		args: '{"query": string, "variables"?: object, "scopeId"?: string}',
		description:
			"Run a GraphQL operation against the user's Rewst instance with their session. Prefer rewst_graphql_schema first when you are unsure about field names or arguments. Queries run directly and return JSON data. Mutations require the user's approval and MUST include scopeId: a stable id of the single resource the mutation changes (e.g. the workflow id), even if it is just a string. Reuse the exact same scopeId for every change to that same object — approving one mutation for a scopeId lets later mutations with that same scopeId run without re-asking, while a different scopeId is confirmed separately. A mutation without a scopeId is refused, so keep mutations minimal and scoped to one resource. Subscriptions are not supported.",
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'GraphQL operation text.' },
				variables: { type: 'object', description: 'Operation variables.' },
				scopeId: {
					type: 'string',
					description:
						'Required for mutations: a stable id of the resource being changed (e.g. the workflow id). Approval is remembered per scopeId for the session; reuse the same id for repeated edits to the same object.',
				},
			},
			required: ['query'],
		},
	},
];

const GRAPHQL_TOOL_NAMES = new Set(GRAPHQL_TOOL_SPECS.map(spec => spec.name));

export function isGraphqlTool(name: string): boolean {
	return GRAPHQL_TOOL_NAMES.has(name);
}

export interface GraphqlToolDeps {
	isEnabled(): boolean;
	/**
	 * Final say on whether a mutation runs; returns true to run. In production
	 * this is already true by the time the tool executes — the user confirmed it
	 * through VS Code's inline chat confirmation at prepareInvocation time (see
	 * graphqlMutationConfirmation + lmTools.ts). Kept as a seam so runGraphqlTool
	 * stays independently testable and gated.
	 */
	confirmMutation(operation: string): Promise<boolean>;
	execute(query: string, variables?: Record<string, unknown>): Promise<{ data?: unknown; errors?: unknown }>;
}

interface GraphqlTypeRef {
	kind?: string | null;
	name?: string | null;
	ofType?: GraphqlTypeRef | null;
}

interface GraphqlArg {
	name?: string | null;
	type?: GraphqlTypeRef | null;
	defaultValue?: string | null;
}

interface GraphqlField {
	name?: string | null;
	type?: GraphqlTypeRef | null;
	args?: GraphqlArg[] | null;
}

interface GraphqlEnumValue {
	name?: string | null;
	isDeprecated?: boolean | null;
}

interface GraphqlTypeDetails {
	kind?: string | null;
	name?: string | null;
	description?: string | null;
	fields?: GraphqlField[] | null;
	inputFields?: GraphqlArg[] | null;
	enumValues?: GraphqlEnumValue[] | null;
	possibleTypes?: { name?: string | null }[] | null;
}

interface GraphqlRootSchema {
	queryType?: GraphqlTypeDetails | null;
	mutationType?: GraphqlTypeDetails | null;
	subscriptionType?: GraphqlTypeDetails | null;
}

const TYPE_REF_FRAGMENT = `{
	kind
	name
	ofType {
		kind
		name
		ofType {
			kind
			name
			ofType {
				kind
				name
				ofType {
					kind
					name
				}
			}
		}
	}
}`;

const ROOT_SCHEMA_QUERY = `query RewstBuddyRootSchema($includeDeprecated: Boolean!) {
	__schema {
		queryType {
			name
			fields(includeDeprecated: $includeDeprecated) {
				name
				args { name type ${TYPE_REF_FRAGMENT} defaultValue }
				type ${TYPE_REF_FRAGMENT}
			}
		}
		mutationType {
			name
			fields(includeDeprecated: $includeDeprecated) {
				name
				args { name type ${TYPE_REF_FRAGMENT} defaultValue }
				type ${TYPE_REF_FRAGMENT}
			}
		}
		subscriptionType {
			name
			fields(includeDeprecated: $includeDeprecated) {
				name
				args { name type ${TYPE_REF_FRAGMENT} defaultValue }
				type ${TYPE_REF_FRAGMENT}
			}
		}
	}
}`;

const TYPE_DETAILS_QUERY = `query RewstBuddyTypeDetails($typeName: String!, $includeDeprecated: Boolean!) {
	__type(name: $typeName) {
		kind
		name
		description
		fields(includeDeprecated: $includeDeprecated) {
			name
			args { name type ${TYPE_REF_FRAGMENT} defaultValue }
			type ${TYPE_REF_FRAGMENT}
		}
		inputFields { name type ${TYPE_REF_FRAGMENT} defaultValue }
		enumValues(includeDeprecated: $includeDeprecated) { name isDeprecated }
		possibleTypes { name }
	}
}`;

const TYPE_NAMES_QUERY = `query RewstBuddySchemaTypeNames($includeDeprecated: Boolean!) {
	__schema {
		types { name kind }
		queryType {
			name
			fields(includeDeprecated: $includeDeprecated) {
				name
				args { name type ${TYPE_REF_FRAGMENT} }
				type ${TYPE_REF_FRAGMENT}
			}
		}
		mutationType {
			name
			fields(includeDeprecated: $includeDeprecated) {
				name
				args { name type ${TYPE_REF_FRAGMENT} }
				type ${TYPE_REF_FRAGMENT}
			}
		}
		subscriptionType {
			name
			fields(includeDeprecated: $includeDeprecated) {
				name
				args { name type ${TYPE_REF_FRAGMENT} }
				type ${TYPE_REF_FRAGMENT}
			}
		}
	}
}`;

/** Binds the tool to the chat's session so operations hit the right org/region. */
export function createGraphqlDeps(session: Session): GraphqlToolDeps {
	return {
		isEnabled: () => vscode.workspace.getConfiguration(`${extPrefix}.ai`).get<boolean>('enableGraphqlTool', false),
		// The mutation prompt is VS Code's inline chat confirmation, shown at
		// prepareInvocation before the tool runs (see graphqlMutationConfirmation +
		// lmTools.ts). By the time execution reaches here the user has already said
		// yes, so there is nothing left to ask — a second OS modal would be the
		// jarring double-prompt this replaced (#25).
		confirmMutation: async () => true,
		execute: (query, variables) => session.rawGraphql(query, variables),
	};
}

// Resource scopeIds the user has approved this session. Confirming a mutation
// for a scopeId records it here so later mutations to the same resource run
// without re-asking; cleared on window reload (process-lifetime "session").
const approvedMutationScopes = new Set<string>();

/** Whether a mutation scopeId has already been approved this session. */
export function isMutationScopeApproved(scopeId: string): boolean {
	return approvedMutationScopes.has(scopeId);
}

/** Records that the user approved mutations for this resource this session. */
export function approveMutationScope(scopeId: string): void {
	approvedMutationScopes.add(scopeId);
}

/** Clears all session approvals (tests). */
export function _resetApprovedMutationScopes(): void {
	approvedMutationScopes.clear();
}

interface ParsedMutation {
	query: string;
	variables?: Record<string, unknown>;
	scopeId?: string;
}

/** Parses a `rewst_graphql` request as a mutation, or undefined if it isn't one. */
function parseMutation(name: string, input: unknown): ParsedMutation | undefined {
	if (name !== 'rewst_graphql') return undefined;
	const args = (typeof input === 'object' && input !== null ? input : {}) as {
		query?: unknown;
		variables?: unknown;
		scopeId?: unknown;
	};
	const query = typeof args.query === 'string' ? args.query.trim() : '';
	if (query.length === 0 || detectOperationType(query) !== 'mutation') return undefined;
	const variables =
		args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables)
			? (args.variables as Record<string, unknown>)
			: undefined;
	const scopeId =
		typeof args.scopeId === 'string' && args.scopeId.trim().length > 0 ? args.scopeId.trim() : undefined;
	return { query, variables, scopeId };
}

/**
 * The approved resource scopeId for a `rewst_graphql` mutation request, or
 * undefined when the request is not a mutation or carries no scopeId. lmTools.ts
 * records this once the invocation is permitted, so repeat edits to the same
 * resource skip the prompt.
 */
export function graphqlMutationScopeId(name: string, input: unknown): string | undefined {
	return parseMutation(name, input)?.scopeId;
}

/** Confirmation copy the chat surface renders inline for a mutation. */
export interface GraphqlMutationConfirmation {
	title: string;
	/** Markdown body: the prompt plus the full operation in fenced blocks. */
	message: string;
}

/**
 * The inline mutation confirmation for a tool request, or undefined when no
 * prompt is needed: anything but a `rewst_graphql` mutation (queries, schema
 * reads, other tools), a mutation whose scopeId is already approved this
 * session, or a mutation with no scopeId at all (it is refused downstream in
 * runGraphqlTool, so there is nothing to approve). Lets lmTools.ts gate
 * mutations through VS Code's native chat confirmation instead of an OS modal,
 * scoped to the resource the assistant declares it is changing (#25).
 */
export function graphqlMutationConfirmation(name: string, input: unknown): GraphqlMutationConfirmation | undefined {
	const mutation = parseMutation(name, input);
	if (!mutation?.scopeId || isMutationScopeApproved(mutation.scopeId)) return undefined;

	const lines = [
		`Run this mutation against resource \`${mutation.scopeId}\`? Approving also lets further changes to this same resource run for the rest of this session without asking again.`,
		'',
		'```graphql',
		mutation.query,
		'```',
	];
	if (mutation.variables) {
		lines.push('', 'Variables:', '```json', JSON.stringify(mutation.variables, null, 2), '```');
	}
	return {
		title: 'Cage-Free Rewsty wants to change a Rewst resource',
		message: lines.join('\n'),
	};
}

/**
 * Classifies a GraphQL document by its top-level operations. Comments and
 * string literals are stripped first so keywords inside them don't count;
 * a bare `{...}` selection set is an anonymous query. Any mutation makes the
 * whole document a mutation (mixed documents get the stricter gate).
 */
export function detectOperationType(document: string): 'query' | 'mutation' | 'subscription' {
	const cleaned = document
		.replace(/"""[\s\S]*?"""/g, ' ')
		.replace(/"(?:\\.|[^"\\])*"/g, ' ')
		.replace(/#[^\n]*/g, ' ');

	let depth = 0;
	let type: 'query' | 'mutation' = 'query';
	for (const token of cleaned.match(/[A-Za-z_][A-Za-z0-9_]*|[{}]/g) ?? []) {
		if (token === '{') depth++;
		else if (token === '}') depth = Math.max(0, depth - 1);
		else if (depth === 0) {
			if (token === 'subscription') return 'subscription';
			if (token === 'mutation') type = 'mutation';
		}
	}
	return type;
}

function formatResult(result: { data?: unknown; errors?: unknown }): string {
	const body: Record<string, unknown> = {};
	if (result.data !== undefined && result.data !== null) body.data = result.data;
	if (Array.isArray(result.errors) ? result.errors.length > 0 : result.errors != null) body.errors = result.errors;
	const text = Object.keys(body).length > 0 ? JSON.stringify(body, null, 1) : '(empty response)';
	return formatResultText(text);
}

function unwrapType(type: GraphqlTypeRef | null | undefined): string {
	if (!type) return 'Unknown';
	if (type.kind === 'NON_NULL') return `${unwrapType(type.ofType)}!`;
	if (type.kind === 'LIST') return `[${unwrapType(type.ofType)}]`;
	return type.name ?? 'Unknown';
}

function formatArgs(args: GraphqlArg[] | null | undefined): string {
	if (!args || args.length === 0) return '';
	return `(${args.map(arg => `${arg.name}: ${unwrapType(arg.type)}`).join(', ')})`;
}

function formatField(field: GraphqlField): string {
	return `${field.name}${formatArgs(field.args)}: ${unwrapType(field.type)}`;
}

function formatFields(fields: GraphqlField[] | null | undefined, cap: number): string[] {
	const usable = (fields ?? []).filter(field => typeof field.name === 'string');
	const lines = usable.slice(0, cap).map(field => `- ${formatField(field)}`);
	if (usable.length > cap)
		lines.push(`...(showing first ${cap} of ${usable.length}; use search or typeName to narrow)`);
	return lines;
}

function schemaFromResult(result: { data?: unknown }): GraphqlRootSchema | undefined {
	const data = result.data as { __schema?: GraphqlRootSchema } | undefined;
	return data?.__schema;
}

function typeFromResult(result: { data?: unknown }): GraphqlTypeDetails | undefined {
	const data = result.data as { __type?: GraphqlTypeDetails | null } | undefined;
	return data?.__type ?? undefined;
}

function formatRootSchema(schema: GraphqlRootSchema): string {
	const sections: string[] = [];
	const roots: [string, GraphqlTypeDetails | null | undefined, number][] = [
		['Query', schema.queryType, 80],
		['Mutation', schema.mutationType, 80],
		['Subscription', schema.subscriptionType, 40],
	];
	for (const [label, type, cap] of roots) {
		if (!type) continue;
		const lines = formatFields(type.fields, cap);
		sections.push(`## ${label} (${type.name ?? 'unknown'})\n${lines.length ? lines.join('\n') : '(no fields)'}`);
	}
	sections.push(
		'Use rewst_graphql_schema with {"typeName": "TypeName"} to inspect return/input types, or {"search": "term"} to find likely operations.',
	);
	return sections.join('\n\n');
}

function formatTypeDetails(type: GraphqlTypeDetails | undefined, typeName: string): string {
	if (!type) return `Type not found: ${typeName}`;
	const sections = [`## ${type.name ?? typeName} (${type.kind ?? 'UNKNOWN'})`];
	if (type.fields?.length) sections.push(`Fields:\n${formatFields(type.fields, 120).join('\n')}`);
	if (type.inputFields?.length) {
		const lines = type.inputFields
			.slice(0, 120)
			.map(
				field =>
					`- ${field.name}: ${unwrapType(field.type)}${field.defaultValue ? ` = ${field.defaultValue}` : ''}`,
			);
		if (type.inputFields.length > 120) lines.push(`...(showing first 120 of ${type.inputFields.length})`);
		sections.push(`Input fields:\n${lines.join('\n')}`);
	}
	if (type.enumValues?.length) {
		const lines = type.enumValues
			.slice(0, 160)
			.map(value => `- ${value.name}${value.isDeprecated ? ' (deprecated)' : ''}`);
		if (type.enumValues.length > 160) lines.push(`...(showing first 160 of ${type.enumValues.length})`);
		sections.push(`Enum values:\n${lines.join('\n')}`);
	}
	if (type.possibleTypes?.length) {
		sections.push(`Possible types:\n${type.possibleTypes.map(possible => `- ${possible.name}`).join('\n')}`);
	}
	if (sections.length === 1) sections.push('(no fields, input fields, enum values, or possible types)');
	return sections.join('\n\n');
}

function formatSchemaSearch(schema: GraphqlRootSchema & { types?: GraphqlTypeDetails[] }, term: string): string {
	const needle = term.toLowerCase();
	const typeMatches = (schema.types ?? [])
		.filter(type => type.name && !type.name.startsWith('__') && type.name.toLowerCase().includes(needle))
		.slice(0, 80)
		.map(type => `- type ${type.name} (${type.kind ?? 'UNKNOWN'})`);
	const fieldMatches: string[] = [];
	const roots: [string, GraphqlTypeDetails | null | undefined][] = [
		['Query', schema.queryType],
		['Mutation', schema.mutationType],
		['Subscription', schema.subscriptionType],
	];
	for (const [label, type] of roots) {
		for (const field of type?.fields ?? []) {
			if (field.name?.toLowerCase().includes(needle)) fieldMatches.push(`- ${label}.${formatField(field)}`);
			if (fieldMatches.length >= 80) break;
		}
	}
	const sections = [`Search: ${term}`];
	sections.push(`Types:\n${typeMatches.length ? typeMatches.join('\n') : '(none)'}`);
	sections.push(`Root fields:\n${fieldMatches.length ? fieldMatches.join('\n') : '(none)'}`);
	sections.push('Use rewst_graphql_schema with {"typeName": "TypeName"} for details before calling rewst_graphql.');
	return sections.join('\n\n');
}

async function runSchemaTool(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const includeDeprecated = request.args.includeDeprecated === true;
	const typeName = request.args.typeName;
	const search = request.args.search;
	if (typeName !== undefined && (typeof typeName !== 'string' || typeName.trim().length === 0)) {
		throw new Error('rewst_graphql_schema "typeName" must be a non-empty string when provided.');
	}
	if (search !== undefined && (typeof search !== 'string' || search.trim().length === 0)) {
		throw new Error('rewst_graphql_schema "search" must be a non-empty string when provided.');
	}
	if (typeName !== undefined && search !== undefined) {
		throw new Error('rewst_graphql_schema accepts either "typeName" or "search", not both.');
	}

	if (typeof typeName === 'string') {
		return formatResultText(
			formatTypeDetails(
				typeFromResult(await deps.execute(TYPE_DETAILS_QUERY, { typeName, includeDeprecated })),
				typeName,
			),
		);
	}
	if (typeof search === 'string') {
		const result = await deps.execute(TYPE_NAMES_QUERY, { includeDeprecated });
		return formatResultText(
			formatSchemaSearch(
				(schemaFromResult(result) ?? {}) as GraphqlRootSchema & { types?: GraphqlTypeDetails[] },
				search,
			),
		);
	}
	return formatResultText(
		formatRootSchema(schemaFromResult(await deps.execute(ROOT_SCHEMA_QUERY, { includeDeprecated })) ?? {}),
	);
}

function formatResultText(text: string): string {
	return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + '\n…(output truncated)' : text;
}

export async function runGraphqlTool(request: ToolRequest, deps: GraphqlToolDeps | undefined): Promise<string> {
	if (!deps || !deps.isEnabled()) {
		throw new Error(
			'GraphQL tools are disabled. The user can enable them with the rewst-buddy.ai.enableGraphqlTool setting.',
		);
	}

	if (request.tool === 'rewst_graphql_schema') {
		return runSchemaTool(request, deps);
	}

	const query = request.args.query;
	if (typeof query !== 'string' || query.trim().length === 0) {
		throw new Error('rewst_graphql requires a "query" argument containing a GraphQL document.');
	}
	const rawVariables = request.args.variables;
	if (
		rawVariables !== undefined &&
		(typeof rawVariables !== 'object' || rawVariables === null || Array.isArray(rawVariables))
	) {
		throw new Error('rewst_graphql "variables" must be a JSON object when provided.');
	}
	const variables = rawVariables as Record<string, unknown> | undefined;

	const kind = detectOperationType(query);
	if (kind === 'subscription') {
		throw new Error('rewst_graphql does not support subscriptions; use a query or mutation.');
	}
	if (kind === 'mutation') {
		const scopeId = request.args.scopeId;
		if (typeof scopeId !== 'string' || scopeId.trim().length === 0) {
			throw new Error(
				'rewst_graphql mutations require a non-empty "scopeId" identifying the single resource being changed (e.g. the workflow id). Add it and retry.',
			);
		}
		const operation = variables
			? `${query.trim()}\n\nVariables:\n${JSON.stringify(variables, null, 2)}`
			: query.trim();
		const summary = `Resource ${scopeId.trim()}\n\n${operation}`;
		if (!(await deps.confirmMutation(summary))) {
			throw new Error('The user declined this mutation. Do not retry it; ask what they would prefer.');
		}
	}

	return formatResult(await deps.execute(query, variables));
}
