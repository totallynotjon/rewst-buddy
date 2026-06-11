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
 *     user approval in a modal showing the full operation — there is no
 *     auto-approve escape hatch.
 *   - Subscriptions are rejected (the tool protocol is request/response).
 */

const MAX_OUTPUT_CHARS = 8_000;

export const GRAPHQL_TOOL_SPECS: ToolSpec[] = [
	{
		name: 'rewst_graphql_schema',
		args: '{"typeName"?: string, "search"?: string, "includeDeprecated"?: boolean}',
		description:
			'Inspect the Rewst GraphQL schema with the user session before composing operations. With no args, lists root Query/Mutation/Subscription fields. Use typeName to inspect fields/input fields/enum values for one type. Use search to find matching type names and root operation fields.',
	},
	{
		name: 'rewst_graphql',
		args: '{"query": string, "variables"?: object}',
		description:
			"Run a GraphQL operation against the user's Rewst instance with their session. Prefer rewst_graphql_schema first when you are unsure about field names or arguments. Queries run directly and return JSON data. Mutations require the user's approval before running, so keep them minimal and explain what you intend to change. Subscriptions are not supported.",
	},
];

const GRAPHQL_TOOL_NAMES = new Set(GRAPHQL_TOOL_SPECS.map(spec => spec.name));

export function isGraphqlTool(name: string): boolean {
	return GRAPHQL_TOOL_NAMES.has(name);
}

export interface GraphqlToolDeps {
	isEnabled(): boolean;
	/** Shows the mutation approval modal; returns true to run. */
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
		confirmMutation: async operation => {
			const choice = await vscode.window.showWarningMessage(
				'RoboRewsty wants to run a GraphQL mutation on your Rewst instance:',
				{ modal: true, detail: operation },
				'Run',
			);
			return choice === 'Run';
		},
		execute: (query, variables) => session.rawGraphql(query, variables),
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
		const summary = variables
			? `${query.trim()}\n\nVariables:\n${JSON.stringify(variables, null, 2)}`
			: query.trim();
		if (!(await deps.confirmMutation(summary))) {
			throw new Error('The user declined this mutation. Do not retry it; ask what they would prefer.');
		}
	}

	return formatResult(await deps.execute(query, variables));
}
