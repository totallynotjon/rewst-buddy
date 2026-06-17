#!/usr/bin/env node
/**
 * Exploratory probe for Rewst's WORKFLOW GraphQL API.
 *
 * Goal: learn the exact calls + fields required to read and edit workflows, so
 * we can bundle that logic into native chat tools instead of many GraphQL turns.
 *
 * Auto-loads REWST_TEST_TOKEN from .env (gitignored). Override the endpoint with
 * REWST_GRAPHQL_URL.
 *
 * Usage:
 *   node scripts/probe-workflow.mjs whoami
 *   node scripts/probe-workflow.mjs root                 Root Query/Mutation fields (workflow-ish)
 *   node scripts/probe-workflow.mjs type <TypeName>      Inspect a type's fields/inputFields/enums
 *   node scripts/probe-workflow.mjs search <term>        Find type names + root fields matching term
 *   node scripts/probe-workflow.mjs gql '<query>' '<jsonVars>'   Run an arbitrary operation
 *   node scripts/probe-workflow.mjs file <path> '<jsonVars>'     Run an operation from a file
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
	try {
		const text = readFileSync(join(__dirname, '..', '.env'), 'utf8');
		for (const line of text.split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
		}
	} catch {
		/* no .env */
	}
}
loadEnv();

const HTTP_URL = process.env.REWST_GRAPHQL_URL ?? 'https://api.rewst.io/graphql';
const COOKIE_NAME = 'appSession';

const token = process.env.REWST_TEST_TOKEN;
if (!token) {
	console.error('REWST_TEST_TOKEN is required (put it in .env)');
	process.exit(1);
}
const cookie = token.includes('=') ? token : `${COOKIE_NAME}=${token}`;

function dump(label, value) {
	console.log(`\n=== ${label} ===`);
	console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

async function gql(query, variables = {}) {
	const res = await fetch(HTTP_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify({ query, variables }),
	});
	const body = await res.json().catch(() => ({ parseError: true, status: res.status }));
	return body;
}

const USER_QUERY = `query { user { id username orgId organization { id name } } }`;

async function whoami() {
	dump('user', await gql(USER_QUERY));
}

const TYPE_REF = `kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }`;

async function root() {
	const body = await gql(`query {
		__schema {
			queryType { fields { name args { name } type { ${TYPE_REF} } } }
			mutationType { fields { name args { name } type { ${TYPE_REF} } } }
		}
	}`);
	const q = body.data?.__schema?.queryType?.fields ?? [];
	const m = body.data?.__schema?.mutationType?.fields ?? [];
	const fmt = f => `  ${f.name}(${(f.args ?? []).map(a => a.name).join(', ')}) -> ${unwrap(f.type)}`;
	const hit = re => f => re.test(f.name);
	const re = /workflow|action|task|trigger|transition|node/i;
	console.log('\n=== Query fields (workflow-ish) ===');
	console.log(q.filter(hit(re)).map(fmt).join('\n'));
	console.log('\n=== Mutation fields (workflow-ish) ===');
	console.log(m.filter(hit(re)).map(fmt).join('\n'));
}

function unwrap(t) {
	if (!t) return '?';
	if (t.kind === 'NON_NULL') return unwrap(t.ofType) + '!';
	if (t.kind === 'LIST') return '[' + unwrap(t.ofType) + ']';
	return t.name ?? '?';
}

async function type(name) {
	const body = await gql(
		`query ($n: String!) {
			__type(name: $n) {
				kind name description
				fields { name args { name type { ${TYPE_REF} } } type { ${TYPE_REF} } }
				inputFields { name type { ${TYPE_REF} } defaultValue }
				enumValues { name }
			}
		}`,
		{ n: name },
	);
	const t = body.data?.__type;
	if (!t) return dump('type', body);
	console.log(`\n=== ${t.name} (${t.kind}) ===`);
	if (t.description) console.log(t.description);
	if (t.fields?.length) {
		console.log('\nFields:');
		for (const f of t.fields)
			console.log(
				`  ${f.name}(${(f.args ?? []).map(a => `${a.name}: ${unwrap(a.type)}`).join(', ')}): ${unwrap(f.type)}`,
			);
	}
	if (t.inputFields?.length) {
		console.log('\nInput fields:');
		for (const f of t.inputFields)
			console.log(`  ${f.name}: ${unwrap(f.type)}${f.defaultValue ? ` = ${f.defaultValue}` : ''}`);
	}
	if (t.enumValues?.length) console.log('\nEnum values:\n  ' + t.enumValues.map(e => e.name).join(', '));
}

async function search(term) {
	const body = await gql(`query {
		__schema {
			types { name kind }
			queryType { fields { name args { name } type { ${TYPE_REF} } } }
			mutationType { fields { name args { name } type { ${TYPE_REF} } } }
		}
	}`);
	const s = body.data?.__schema;
	const needle = term.toLowerCase();
	const types = (s?.types ?? []).filter(
		t => t.name && !t.name.startsWith('__') && t.name.toLowerCase().includes(needle),
	);
	const qf = (s?.queryType?.fields ?? []).filter(f => f.name.toLowerCase().includes(needle));
	const mf = (s?.mutationType?.fields ?? []).filter(f => f.name.toLowerCase().includes(needle));
	const fmt = f => `  ${f.name}(${(f.args ?? []).map(a => a.name).join(', ')}) -> ${unwrap(f.type)}`;
	console.log(`\n=== Types matching "${term}" ===\n` + types.map(t => `  ${t.name} (${t.kind})`).join('\n'));
	console.log(`\n=== Query fields matching "${term}" ===\n` + qf.map(fmt).join('\n'));
	console.log(`\n=== Mutation fields matching "${term}" ===\n` + mf.map(fmt).join('\n'));
}

async function runGql(query, varsJson) {
	const variables = varsJson ? JSON.parse(varsJson) : {};
	dump('result', await gql(query, variables));
}

async function runFile(path, varsJson) {
	const query = readFileSync(path, 'utf8');
	await runGql(query, varsJson);
}

const [command, ...args] = process.argv.slice(2);
const commands = {
	whoami,
	root,
	type: () => type(args[0]),
	search: () => search(args[0]),
	gql: () => runGql(args[0], args[1]),
	file: () => runFile(args[0], args[1]),
};

if (!command || !commands[command]) {
	console.error(`Unknown command '${command ?? ''}'. Available: ${Object.keys(commands).join(', ')}`);
	process.exit(1);
}
await commands[command]();
