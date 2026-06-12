#!/usr/bin/env node
/**
 * A/B comparison of RoboRewsty conversation modes: HELP_DOCS vs WORKFLOW_DIAGNOSIS.
 *
 * Runs a fixed battery of prompts under both conversationTypes (fresh, probe-titled
 * conversation per request so `probe-ai.mjs cleanup` can delete them), auto-scores
 * adherence where the expected answer is mechanically checkable, and writes full
 * transcripts to a JSON results file for manual review of the open-ended prompts.
 *
 * Usage:
 *   REWST_TEST_TOKEN=<appSession token> node scripts/compare-modes.mjs [--reps N] [--only id1,id2]
 *
 * Output:
 *   - progress + summary table on stdout
 *   - scripts/out/compare-modes-<timestamp>.json with full transcripts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

const HTTP_URL = process.env.REWST_GRAPHQL_URL ?? 'https://api.rewst.io/graphql';
const WS_URL = process.env.REWST_WS_URL ?? HTTP_URL.replace(/^http/, 'ws').replace(/\/graphql$/, '/subscriptions');
const COOKIE_NAME = 'appSession';
const PROBE_TITLE_PREFIX = '[rewst-buddy probe]';
const REQUEST_TIMEOUT_MS = 180_000;
const MODES = ['HELP_DOCS', 'WORKFLOW_DIAGNOSIS'];

const token = process.env.REWST_TEST_TOKEN;
if (!token) {
	console.error('REWST_TEST_TOKEN is required');
	process.exit(1);
}
const cookie = token.includes('=') ? token : `${COOKIE_NAME}=${token}`;

// --- prompt battery ---------------------------------------------------------
// `check` returns { pass, note } from the final assistant content; omitted for
// open-ended prompts that need human/LLM review of the saved transcript.

function stripFences(text) {
	return text.replace(/```[a-z]*\n?/gi, '').trim();
}

const BATTERY = [
	{
		id: 'exact-word',
		category: 'adherence',
		prompt: 'Reply with exactly the word PONG and nothing else. No punctuation, no explanation.',
		check: content => {
			const t = content.trim();
			return { pass: t === 'PONG', note: `got ${JSON.stringify(t.slice(0, 80))}` };
		},
	},
	{
		id: 'json-only',
		category: 'adherence',
		prompt: 'Return only valid JSON, no prose and no code fences: an object with key "a" set to the number 1 and key "b" set to the array ["x","y"].',
		check: content => {
			const raw = content.trim();
			const hadFences = /```/.test(raw);
			try {
				const parsed = JSON.parse(stripFences(raw));
				const correct = parsed?.a === 1 && Array.isArray(parsed?.b) && parsed.b.join(',') === 'x,y';
				const strict = correct && !hadFences && raw.startsWith('{');
				return {
					pass: strict,
					note: correct
						? strict
							? 'strict pass'
							: 'valid JSON but wrapped in fences/prose'
						: 'parsed but wrong shape',
				};
			} catch {
				return { pass: false, note: 'not parseable as JSON' };
			}
		},
	},
	{
		id: 'bullet-count',
		category: 'adherence',
		prompt: 'Name three PowerShell cmdlets for working with Windows services. Answer in exactly three bullet points, one cmdlet per bullet, nothing else.',
		check: content => {
			const bullets = content
				.trim()
				.split('\n')
				.filter(l => /^\s*[-*•]\s+/.test(l));
			const nonBullet = content
				.trim()
				.split('\n')
				.filter(l => l.trim() && !/^\s*[-*•]\s+/.test(l));
			return {
				pass: bullets.length === 3 && nonBullet.length === 0,
				note: `${bullets.length} bullets, ${nonBullet.length} extra line(s)`,
			};
		},
	},
	{
		id: 'word-limit',
		category: 'adherence',
		prompt: 'In one sentence of at most 15 words, what is a Rewst workflow trigger?',
		check: content => {
			const words = content.trim().split(/\s+/).length;
			const sentences = content
				.trim()
				.split(/[.!?]+\s/)
				.filter(Boolean).length;
			return { pass: words <= 15 && sentences <= 1, note: `${words} words, ~${sentences} sentence(s)` };
		},
	},
	{
		id: 'logic',
		category: 'reasoning',
		prompt: 'Alice is taller than Bob. Bob is taller than Carol. Dana is shorter than Carol. Who is the second shortest? Answer with just the name.',
		check: content => {
			const t = content.trim().toLowerCase();
			return {
				pass: /\bcarol\b/.test(t) && t.length < 40,
				note: `got ${JSON.stringify(content.trim().slice(0, 80))}`,
			};
		},
	},
	{
		id: 'jinja-task',
		category: 'general',
		prompt: 'Write a single Jinja2 expression that capitalizes the first letter of CTX.first_name. Give only the expression.',
		// open-ended-ish but sanity-checkable
		check: content => {
			const t = stripFences(content);
			return {
				pass: /capitalize/.test(t) && /first_name/.test(t),
				note: `got ${JSON.stringify(t.slice(0, 100))}`,
			};
		},
	},
	{
		id: 'docs-question',
		category: 'rewst-docs',
		prompt: 'What does the core_api_request action do in Rewst, and what are its main inputs?',
		// open-ended: review transcript for accuracy + whether docs search was used
	},
	{
		id: 'diagnosis-question',
		category: 'rewst-diagnosis',
		prompt: 'A Rewst workflow fails intermittently with a Jinja UndefinedError on CTX.ticket_id. What are the most likely causes and how do I fix it?',
		// open-ended: home turf for WORKFLOW_DIAGNOSIS, review transcript
	},
];

// --- GraphQL plumbing (mirrors probe-ai.mjs) --------------------------------

async function gql(query, variables = {}) {
	const res = await fetch(HTTP_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify({ query, variables }),
	});
	const body = await res.json().catch(() => ({ parseError: true, status: res.status }));
	if (!res.ok || body.errors) {
		console.error(`HTTP ${res.status}:`, JSON.stringify(body.errors ?? body).slice(0, 500));
	}
	return body;
}

async function getUser() {
	const body = await gql(`query { user { id username orgId organization { id name } } }`);
	const user = body.data?.user;
	if (!user?.id) {
		console.error('Token validation failed');
		process.exit(1);
	}
	return user;
}

async function createConversation(orgId, type, label) {
	const body = await gql(
		`mutation ($conversation: ConversationInput!) {
			createConversation(conversation: $conversation) { id title type }
		}`,
		{ conversation: { orgId, type, title: `${PROBE_TITLE_PREFIX} ${label}` } },
	);
	return body.data?.createConversation;
}

const SUBSCRIPTION = `
	subscription ($message: String!, $orgId: ID!, $conversationId: ID, $conversationType: String, $metadata: JSON, $resumeRequestId: ID) {
		conversationMessage(
			message: $message
			orgId: $orgId
			conversationId: $conversationId
			conversationType: $conversationType
			metadata: $metadata
			resumeRequestId: $resumeRequestId
		) {
			status
			error
			conversation_id
			metadata
			message { id role content createdAt }
		}
	}`;

/** Run one request; returns { content, events, durationMs, error, stats }. */
async function ask(message, orgId, conversationType, conversationId) {
	class CookieWebSocket extends WebSocket {
		constructor(url, protocols) {
			super(url, protocols, { headers: { cookie } });
		}
	}
	const client = createClient({
		url: WS_URL,
		webSocketImpl: CookieWebSocket,
		connectionParams: { cookie, token },
		retryAttempts: 0,
	});

	const started = Date.now();
	const events = [];
	const stats = { searching: 0, toolCalls: 0, statuses: {} };
	let content = null;
	let error = null;

	const timeout = setTimeout(() => {
		error = `timed out after ${REQUEST_TIMEOUT_MS / 1000}s`;
		client.dispose().catch(() => {});
	}, REQUEST_TIMEOUT_MS);

	try {
		for await (const event of client.iterate({
			query: SUBSCRIPTION,
			variables: {
				message,
				orgId,
				conversationId: conversationId ?? null,
				conversationType,
				metadata: { orgId },
				resumeRequestId: null,
			},
		})) {
			const payload = event?.data?.conversationMessage;
			if (!payload) continue;
			events.push(payload);
			const status = payload.status ?? 'unknown';
			stats.statuses[status] = (stats.statuses[status] ?? 0) + 1;
			if (status === 'searching') stats.searching++;
			if (status === 'TOOL_CALL_IN_PROGRESS') stats.toolCalls++;
			if (payload.error) error = payload.error;
			if (status === 'complete') {
				content = payload.message?.content ?? null;
				break;
			}
		}
	} catch (err) {
		error ??= err?.message ?? String(err);
	} finally {
		clearTimeout(timeout);
		await client.dispose().catch(() => {});
	}

	return { content, events, durationMs: Date.now() - started, error, stats };
}

// --- runner -----------------------------------------------------------------

function parseArgs() {
	const args = process.argv.slice(2);
	const reps = args.includes('--reps') ? Number(args[args.indexOf('--reps') + 1]) || 1 : 1;
	const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
	return { reps, only };
}

const { reps, only } = parseArgs();
const battery = only ? BATTERY.filter(p => only.includes(p.id)) : BATTERY;
const user = await getUser();
console.log(`user: ${user.username}  org: ${user.organization?.name} (${user.orgId})`);
console.log(`battery: ${battery.map(p => p.id).join(', ')}  reps: ${reps}\n`);

const results = [];
for (const promptDef of battery) {
	for (const mode of MODES) {
		for (let rep = 1; rep <= reps; rep++) {
			const label = `${promptDef.id} ${mode} #${rep}`;
			process.stdout.write(`→ ${label} ... `);
			const conversation = await createConversation(user.orgId, mode, label);
			const run = await ask(promptDef.prompt, user.orgId, mode, conversation?.id);
			let score = null;
			if (run.content && promptDef.check) {
				try {
					score = promptDef.check(run.content);
				} catch (err) {
					score = { pass: false, note: `check threw: ${err.message}` };
				}
			}
			const verdict = run.error
				? `ERROR (${run.error})`
				: score
					? `${score.pass ? 'PASS' : 'FAIL'} (${score.note})`
					: 'captured';
			console.log(
				`${verdict}  [${(run.durationMs / 1000).toFixed(1)}s, search×${run.stats.searching}, tools×${run.stats.toolCalls}]`,
			);
			results.push({
				promptId: promptDef.id,
				category: promptDef.category,
				mode,
				rep,
				conversationId: conversation?.id ?? null,
				prompt: promptDef.prompt,
				content: run.content,
				error: run.error,
				durationMs: run.durationMs,
				stats: run.stats,
				score,
				events: run.events,
			});
		}
	}
}

// --- report -----------------------------------------------------------------

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `compare-modes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(outFile, JSON.stringify({ user: user.username, org: user.orgId, reps, results }, null, 2));

console.log('\n=== summary ===');
console.log(`prompt          | mode               | result | time   | search | tools`);
console.log(`----------------|--------------------|--------|--------|--------|------`);
for (const r of results) {
	const result = r.error ? 'ERR' : r.score ? (r.score.pass ? 'PASS' : 'FAIL') : '—';
	console.log(
		`${r.promptId.padEnd(15)} | ${r.mode.padEnd(18)} | ${result.padEnd(6)} | ${(r.durationMs / 1000).toFixed(1).padStart(5)}s | ${String(r.stats.searching).padStart(6)} | ${String(r.stats.toolCalls).padStart(5)}`,
	);
}

const byMode = mode => {
	const scored = results.filter(r => r.mode === mode && r.score);
	const passed = scored.filter(r => r.score.pass).length;
	const avgMs =
		results.filter(r => r.mode === mode).reduce((a, r) => a + r.durationMs, 0) /
		results.filter(r => r.mode === mode).length;
	return { scored: scored.length, passed, avgMs };
};
console.log('');
for (const mode of MODES) {
	const { scored, passed, avgMs } = byMode(mode);
	console.log(`${mode}: ${passed}/${scored} auto-checks passed, avg ${(avgMs / 1000).toFixed(1)}s/request`);
}
console.log(`\nfull transcripts: ${outFile}`);
console.log(`cleanup probe conversations with: REWST_TEST_TOKEN=... node scripts/probe-ai.mjs cleanup`);
