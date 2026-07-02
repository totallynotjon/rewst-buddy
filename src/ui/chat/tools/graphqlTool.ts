import type { Session } from '@sessions';
import type { ToolRequest, ToolSpec } from './toolProtocol';

/**
 * Rewst GraphQL helpers run against the user's own Rewst instance,
 * authenticated with their session cookie. The combined buddy_graphql tool is
 * retired from the VS Code chat LM surface; MCP exposes dedicated
 * buddy_graphql_query and buddy_graphql_mutate primitives, while
 * buddy_graphql_schema remains available for schema inspection.
 *
 *   - The MCP boundary decides whether these tools are exposed.
 *   - Queries run directly once enabled; mutations always require explicit
 *     approval through the MCP mutation approver before execution.
 *   - Every mutation MUST carry four scope fields the assistant supplies:
 *     scopeId + scopeName (id and name of the single resource it changes, e.g. a
 *     workflow's id and name) and orgId + orgName. Approval is remembered for the
 *     session by the ids only (org + resource); the names are shown in the prompt
 *     so the user can recognize what is changing. Confirming one change to a
 *     resource lets further mutations to that same org+resource run without
 *     re-asking, while a different resource is gated again. A mutation missing any
 *     of the four fields is refused.
 *   - Subscriptions are rejected (the tool protocol is request/response).
 */

export const GRAPHQL_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'buddy_graphql_schema',
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
		name: 'buddy_graphql',
		args: '{"query": string, "variables"?: object, "scopeId"?: string, "scopeName"?: string, "orgId"?: string, "orgName"?: string}',
		description:
			"Run a GraphQL operation against the user's Rewst instance with their session. Prefer buddy_graphql_schema first when you are unsure about field names or arguments. Queries run directly and return JSON data. Mutations require the user's approval and MUST include four identifying fields: scopeId and scopeName (the id and human-readable name of the single resource the mutation changes, e.g. a workflow's id and name) plus orgId and orgName (the id and name of the org it runs in). A mutation missing any of them is refused. Reuse the exact same scopeId and orgId for every change to that same object — approval is remembered per resource for the session, so approving one mutation lets later mutations to that same resource run without re-asking, while a different resource is confirmed separately. The names are shown to the user in the approval prompt so they can recognize what is changing; only the ids are used to remember approval. Subscriptions are not supported.",
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'GraphQL operation text.' },
				variables: { type: 'object', description: 'Operation variables.' },
				scopeId: {
					type: 'string',
					description:
						'Required for mutations: a stable id of the resource being changed (e.g. the workflow id). Approval is remembered per resource for the session; reuse the same id for repeated edits to the same object.',
				},
				scopeName: {
					type: 'string',
					description:
						"Required for mutations: the resource's human-readable name (e.g. the workflow name), shown to the user in the approval prompt.",
				},
				orgId: {
					type: 'string',
					description: 'Required for mutations: the id of the org the mutation runs in.',
				},
				orgName: {
					type: 'string',
					description:
						'Required for mutations: the name of the org the mutation runs in, shown in the approval prompt.',
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
	 * this is true after the relevant surface has approved the mutation. Kept as
	 * a seam so runGraphqlTool stays independently testable and gated.
	 */
	confirmMutation(operation: string): Promise<boolean>;
	execute(query: string, variables?: Record<string, unknown>): Promise<{ data?: unknown; errors?: unknown }>;
	/**
	 * Stable identifier for the session/org behind `execute`, used to partition any
	 * cross-call cache (e.g. the workflow-search index) so a session switch in the
	 * same extension host never reuses another session's data. Undefined in tests.
	 */
	cacheScope?: string;
	/**
	 * Deps bound to the OTHER active sessions. A tool that looks an entity up by
	 * a globally unique id (e.g. execution logs by execution id) can sweep these
	 * when the primary session cannot see the entity — each Rewst session only
	 * sees its own org hierarchy.
	 */
	alternates?: GraphqlToolDeps[];
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
		isEnabled: () => true,
		// MCP mutations are approved before this dependency path is invoked, so
		// there is nothing left to ask inside the low-level GraphQL runner.
		confirmMutation: async () => true,
		execute: (query, variables) => session.rawGraphql(query, variables),
		// Partition per-session caches by the org behind this session.
		cacheScope: session.profile.org.id,
	};
}

/**
 * The resource + org a mutation declares it changes. The assistant supplies all
 * four: the ids drive session approval, the names are shown in the prompt so the
 * user can recognize what is being changed.
 */
export interface MutationScope {
	scopeId: string;
	scopeName: string;
	orgId: string;
	orgName: string;
}

/** Names of the four scope fields a mutation must carry, for error messages. */
export const MUTATION_SCOPE_FIELDS = ['scopeId', 'scopeName', 'orgId', 'orgName'] as const;

// Approval is remembered only by the ids (org + resource), so a friendlier or
// differently-cased name can't widen what was approved. A JSON tuple keeps the
// two ids distinct so no pair can collide with another.
function scopeKey(scope: MutationScope): string {
	return JSON.stringify([scope.orgId, scope.scopeId]);
}

// Resource scopes the user has approved this session. Confirming a mutation for
// a scope records it here so later mutations to the same org+resource run
// without re-asking; cleared on window reload (process-lifetime "session").
const approvedMutationScopes = new Set<string>();

/** Whether this org+resource scope has already been approved this session. */
export function isMutationScopeApproved(scope: MutationScope): boolean {
	return approvedMutationScopes.has(scopeKey(scope));
}

/** Records that the user approved mutations for this org+resource this session. */
export function approveMutationScope(scope: MutationScope): void {
	approvedMutationScopes.add(scopeKey(scope));
}

/** Clears all session approvals (tests). */
export function _resetApprovedMutationScopes(): void {
	approvedMutationScopes.clear();
}

interface ParsedMutation {
	query: string;
	variables?: Record<string, unknown>;
	/** Present only when all four scope fields are supplied and non-empty. */
	scope?: MutationScope;
}

function trimmedString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Parses a `buddy_graphql` request as a mutation, or undefined if it isn't one. */
function parseMutation(name: string, input: unknown): ParsedMutation | undefined {
	if (name !== 'buddy_graphql') return undefined;
	const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
	const query = typeof args.query === 'string' ? args.query.trim() : '';
	if (query.length === 0 || detectOperationType(query) !== 'mutation') return undefined;
	const variables =
		args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables)
			? (args.variables as Record<string, unknown>)
			: undefined;
	const scopeId = trimmedString(args.scopeId);
	const scopeName = trimmedString(args.scopeName);
	const orgId = trimmedString(args.orgId);
	const orgName = trimmedString(args.orgName);
	const scope = scopeId && scopeName && orgId && orgName ? { scopeId, scopeName, orgId, orgName } : undefined;
	return { query, variables, scope };
}

/**
 * The declared scope for a `buddy_graphql` mutation request, or undefined when
 * the request is not a mutation or is missing any scope field.
 */
export function graphqlMutationScope(name: string, input: unknown): MutationScope | undefined {
	return parseMutation(name, input)?.scope;
}

/**
 * Wraps content in a fenced code block whose backtick run is one longer than any
 * run inside the content, so a model-supplied query or variables value
 * containing ``` cannot close the fence early and distort the approval prompt.
 */
function fencedBlock(language: string, content: string): string {
	const longestRun = Math.max(0, ...[...content.matchAll(/`+/g)].map(match => match[0].length));
	const fence = '`'.repeat(Math.max(3, longestRun + 1));
	return `${fence}${language}\n${content}\n${fence}`;
}

/** Confirmation copy the chat surface renders inline for a mutation. */
export interface GraphqlMutationConfirmation {
	title: string;
	/** Markdown body: the prompt plus the full operation in fenced blocks. */
	message: string;
}

/**
 * The inline mutation confirmation for a tool request, or undefined when no
 * prompt is needed: anything but a `buddy_graphql` mutation (queries, schema
 * reads, other tools), a mutation whose org+resource scope is already approved
 * this session, or a mutation missing any scope field (it is refused downstream
 * in runGraphqlTool, so there is nothing to approve). Kept for the low-level
 * GraphQL runner tests and any future surface that wants this confirmation copy.
 */
export function graphqlMutationConfirmation(name: string, input: unknown): GraphqlMutationConfirmation | undefined {
	const mutation = parseMutation(name, input);
	if (!mutation?.scope || isMutationScopeApproved(mutation.scope)) return undefined;
	const { scopeName, scopeId, orgName, orgId } = mutation.scope;

	const lines = [
		`Run this mutation against **${scopeName}** (\`${scopeId}\`) in org **${orgName}** (\`${orgId}\`)? Approving also lets further changes to this same resource run for the rest of this session without asking again.`,
		'',
		fencedBlock('graphql', mutation.query),
	];
	if (mutation.variables) {
		lines.push('', 'Variables:', fencedBlock('json', JSON.stringify(mutation.variables, null, 2)));
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
		'Use buddy_graphql_schema with {"typeName": "TypeName"} to inspect return/input types, or {"search": "term"} to find likely operations.',
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
	sections.push('Use buddy_graphql_schema with {"typeName": "TypeName"} for details before calling buddy_graphql.');
	return sections.join('\n\n');
}

async function runSchemaTool(request: ToolRequest, deps: GraphqlToolDeps): Promise<string> {
	const includeDeprecated = request.args.includeDeprecated === true;
	const typeName = request.args.typeName;
	const search = request.args.search;
	if (typeName !== undefined && (typeof typeName !== 'string' || typeName.trim().length === 0)) {
		throw new Error('buddy_graphql_schema "typeName" must be a non-empty string when provided.');
	}
	if (search !== undefined && (typeof search !== 'string' || search.trim().length === 0)) {
		throw new Error('buddy_graphql_schema "search" must be a non-empty string when provided.');
	}
	if (typeName !== undefined && search !== undefined) {
		throw new Error('buddy_graphql_schema accepts either "typeName" or "search", not both.');
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
	return text;
}

/**
 * Runs a read-only GraphQL operation: mutations and subscriptions are rejected
 * before execution, then the result is formatted (and length-capped) the same
 * way as the chat tool. Used by the MCP read-only query capability, where writes
 * are gated separately at the server boundary and must never slip through here.
 */
export async function runReadonlyGraphql(
	query: string,
	variables: Record<string, unknown> | undefined,
	execute: (q: string, v?: Record<string, unknown>) => Promise<{ data?: unknown; errors?: unknown }>,
): Promise<string> {
	if (typeof query !== 'string' || query.trim().length === 0) {
		throw new Error('A non-empty GraphQL "query" is required.');
	}
	const kind = detectOperationType(query);
	if (kind !== 'query') {
		throw new Error(`This tool runs read-only queries only; received a ${kind}. Use a query operation.`);
	}
	return formatResult(await execute(query, variables));
}

/**
 * Runs a GraphQL mutation and formats the result the same way as the chat tool.
 * Used by the MCP mutation capability after the MCP boundary and VS Code modal
 * have allowed the write.
 */
export async function runMutationGraphql(
	query: string,
	variables: Record<string, unknown> | undefined,
	execute: (q: string, v?: Record<string, unknown>) => Promise<{ data?: unknown; errors?: unknown }>,
): Promise<string> {
	if (typeof query !== 'string' || query.trim().length === 0) {
		throw new Error('A non-empty GraphQL "query" is required.');
	}
	const kind = detectOperationType(query);
	if (kind !== 'mutation') {
		throw new Error(`This tool runs mutations only; received a ${kind}. Use a mutation operation.`);
	}
	return formatResult(await execute(query, variables));
}

export async function runGraphqlTool(request: ToolRequest, deps: GraphqlToolDeps | undefined): Promise<string> {
	if (!deps) throw new Error('GraphQL dependencies are unavailable.');

	if (request.tool === 'buddy_graphql_schema') {
		return runSchemaTool(request, deps);
	}

	const query = request.args.query;
	if (typeof query !== 'string' || query.trim().length === 0) {
		throw new Error('buddy_graphql requires a "query" argument containing a GraphQL document.');
	}
	const rawVariables = request.args.variables;
	if (
		rawVariables !== undefined &&
		(typeof rawVariables !== 'object' || rawVariables === null || Array.isArray(rawVariables))
	) {
		throw new Error('buddy_graphql "variables" must be a JSON object when provided.');
	}
	const variables = rawVariables as Record<string, unknown> | undefined;

	const kind = detectOperationType(query);
	if (kind === 'subscription') {
		throw new Error('buddy_graphql does not support subscriptions; use a query or mutation.');
	}
	if (kind === 'mutation') {
		const missing = MUTATION_SCOPE_FIELDS.filter(field => {
			const value = request.args[field];
			return typeof value !== 'string' || value.trim().length === 0;
		});
		if (missing.length > 0) {
			throw new Error(
				`buddy_graphql mutations require non-empty ${MUTATION_SCOPE_FIELDS.join(', ')} (the id and name of the resource being changed plus its org id and name). Missing: ${missing.join(', ')}. Add them and retry.`,
			);
		}
		const scopeId = (request.args.scopeId as string).trim();
		const scopeName = (request.args.scopeName as string).trim();
		const orgId = (request.args.orgId as string).trim();
		const orgName = (request.args.orgName as string).trim();
		const operation = variables
			? `${query.trim()}\n\nVariables:\n${JSON.stringify(variables, null, 2)}`
			: query.trim();
		const summary = `${scopeName} (${scopeId}) in org ${orgName} (${orgId})\n\n${operation}`;
		if (!(await deps.confirmMutation(summary))) {
			throw new Error('The user declined this mutation. Do not retry it; ask what they would prefer.');
		}
	}

	return formatResult(await deps.execute(query, variables));
}
