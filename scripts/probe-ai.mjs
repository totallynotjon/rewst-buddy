#!/usr/bin/env node
/**
 * Exploratory probe for Rewst's AI assistant (conversation) GraphQL API.
 *
 * Usage:
 *   REWST_TEST_TOKEN=<appSession token> node scripts/probe-ai.mjs <command> [args]
 *
 * Commands:
 *   whoami                      Validate token, print user + org
 *   list                        List existing conversations for the org
 *   show <conversationId>       Print a conversation with all messages
 *   prefs                       Print myRoboRewstyPreferences (alwaysAllowedTools, etc.)
 *   allow <toolName>            addAllowedTool — allow-list a tool for RoboRewsty
 *   unallow <toolName>          removeAllowedTool — remove a tool from the allow-list
 *   http-chat "<message>"       Create conversation + USER message over HTTP, poll for assistant reply
 *   ws-chat "<message>" [conversationId]
 *                               Drive the conversationMessage subscription via graphql-ws
 *                               (graphql-transport-ws subprotocol)
 *   ws-resume "<message>" <conversationId> <requestId>
 *                               Reattach to an in-flight request via resumeRequestId
 *                               (approval-continue / reconnect probe)
 *   provoke "<message>" [toolToAllow]
 *                               Send under WORKFLOW_DIAGNOSIS context to trigger an
 *                               approval_required, then attempt to continue (optionally
 *                               allow-listing toolToAllow first) by resuming the request
 *   ws-legacy "<message>" [conversationId]
 *                               Same, but using the legacy subscriptions-transport-ws subprotocol
 *   active                      Query activeConversationRequests for the current user
 *   cleanup                     Delete conversations created by this probe (title prefix match)
 *
 * All raw responses are printed as JSON so we can learn the API's actual semantics.
 */

import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

const HTTP_URL = process.env.REWST_GRAPHQL_URL ?? 'https://api.rewst.io/graphql';
// Discovered via app.rewst.io/__ENV.js: NEXT_PUBLIC_API_WS_URI
const WS_URL = process.env.REWST_WS_URL ?? HTTP_URL.replace(/^http/, 'ws').replace(/\/graphql$/, '/subscriptions');
const COOKIE_NAME = 'appSession';
const PROBE_TITLE_PREFIX = '[rewst-buddy probe]';

const token = process.env.REWST_TEST_TOKEN;
if (!token) {
	console.error('REWST_TEST_TOKEN is required');
	process.exit(1);
}
const cookie = token.includes('=') ? token : `${COOKIE_NAME}=${token}`;

function dump(label, value) {
	console.log(`\n=== ${label} ===`);
	console.log(JSON.stringify(value, null, 2));
}

async function gql(query, variables = {}) {
	const res = await fetch(HTTP_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify({ query, variables }),
	});
	const body = await res.json().catch(() => ({ parseError: true, status: res.status }));
	if (!res.ok || body.errors) {
		dump(`HTTP ${res.status} response (with errors)`, body);
	}
	return body;
}

const USER_QUERY = `query { user { id username orgId organization { id name } } }`;

const CONVERSATION_FIELDS = `
	id
	title
	type
	orgId
	userId
	metadata
	createdAt
	updatedAt
`;

const MESSAGE_FIELDS = `
	id
	conversationId
	role
	content
	metadata
	userId
	createdAt
`;

async function getUser() {
	const body = await gql(USER_QUERY);
	const user = body.data?.user;
	if (!user?.id) {
		dump('whoami failed', body);
		process.exit(1);
	}
	return user;
}

async function whoami() {
	dump('user', await getUser());
}

async function list() {
	const user = await getUser();
	const body = await gql(
		`query ($where: ConversationWhereInput) {
			conversations(where: $where, limit: 50) {
				${CONVERSATION_FIELDS}
				firstUserMessage { role content createdAt }
			}
		}`,
		{ where: { orgId: user.orgId } },
	);
	dump('conversations', body);
}

async function show(conversationId) {
	const body = await gql(
		`query ($id: ID!) {
			conversation(id: $id) {
				${CONVERSATION_FIELDS}
				messages { ${MESSAGE_FIELDS} }
			}
		}`,
		{ id: conversationId },
	);
	dump('conversation', body);
}

async function createConversation(orgId, type = 'HELP_DOCS') {
	const body = await gql(
		`mutation ($conversation: ConversationInput!) {
			createConversation(conversation: $conversation) { ${CONVERSATION_FIELDS} }
		}`,
		{ conversation: { orgId, type, title: `${PROBE_TITLE_PREFIX} ${new Date().toISOString()}` } },
	);
	dump('createConversation', body);
	return body.data?.createConversation;
}

async function httpChat(message) {
	const user = await getUser();
	const conversation = await createConversation(user.orgId);
	if (!conversation?.id) process.exit(1);

	const msgBody = await gql(
		`mutation ($message: ConversationMessageInput!) {
			createConversationMessage(message: $message) { ${MESSAGE_FIELDS} }
		}`,
		{ message: { conversationId: conversation.id, content: message, role: 'USER' } },
	);
	dump('createConversationMessage', msgBody);

	// Poll: does an ASSISTANT message ever appear without a subscription?
	for (let i = 0; i < 10; i++) {
		await new Promise(r => setTimeout(r, 3000));
		const poll = await gql(`query ($id: ID!) { conversation(id: $id) { id messages { ${MESSAGE_FIELDS} } } }`, {
			id: conversation.id,
		});
		const messages = poll.data?.conversation?.messages ?? [];
		console.log(`poll ${i + 1}: ${messages.length} message(s), roles: ${messages.map(m => m.role).join(', ')}`);
		if (messages.some(m => m.role === 'ASSISTANT')) {
			dump('assistant replied via HTTP-only flow', poll);
			return;
		}
	}
	console.log('\nNo ASSISTANT message appeared after 30s — HTTP-only flow likely does not trigger the AI.');
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
			message { ${MESSAGE_FIELDS} }
		}
	}`;

/**
 * Drive the conversationMessage subscription and dump every event.
 *
 * opts:
 *   conversationId   reuse an existing conversation (multi-turn)
 *   resumeRequestId  reattach to an in-flight request (approval / reconnect)
 *   conversationType default 'HELP_DOCS'; try 'WORKFLOW_DIAGNOSIS' for agent tools
 *   metadata         extra context merged into { orgId } (route context can unlock
 *                    the agent's mutating tools, which is what triggers approvals)
 *
 * Returns the last requestId seen (from request_registered) and whether an
 * approval_required event was observed — so callers can chain a resume.
 */
async function wsChat(message, opts = {}) {
	const user = await getUser();
	console.log(`connecting to ${WS_URL} (graphql-transport-ws) as ${user.username}...`);

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
		on: {
			connected: () => console.log('ws connected'),
			closed: e => console.log(`ws closed: code=${e?.code} reason=${e?.reason}`),
			error: e => console.log('ws error:', e?.message ?? e),
		},
	});

	// The web app sends metadata containing orgId alongside the top-level orgId
	const variables = {
		message,
		orgId: user.orgId,
		conversationId: opts.conversationId ?? null,
		conversationType: opts.conversationType ?? 'HELP_DOCS',
		metadata: { orgId: user.orgId, ...(opts.metadata ?? {}) },
		resumeRequestId: opts.resumeRequestId ?? null,
	};
	dump('subscription variables', variables);

	let n = 0;
	let lastRequestId;
	let approval;
	let conversationId = opts.conversationId;
	try {
		for await (const event of client.iterate({ query: SUBSCRIPTION, variables })) {
			dump(`event ${++n}`, event);
			const payload = event?.data?.conversationMessage;
			if (!payload) continue;
			if (payload.conversation_id) conversationId = payload.conversation_id;
			const requestId = payload.metadata?.requestId;
			if (requestId) lastRequestId = requestId;
			if (payload.status === 'approval_required') {
				approval = payload;
				console.log('\n*** APPROVAL REQUIRED ***');
				console.log('  lastRequestId:', lastRequestId ?? '(none seen)');
				console.log('  payload.metadata keys:', Object.keys(payload.metadata ?? {}).join(', ') || '(none)');
			}
		}
		console.log(`\nsubscription completed after ${n} event(s)`);
	} catch (err) {
		console.error('\nsubscription failed:', err);
	} finally {
		await client.dispose().catch(() => {});
	}
	return { lastRequestId, approval, conversationId };
}

// Legacy subscriptions-transport-ws subprotocol, hand-rolled (in case the server
// does not speak graphql-transport-ws).
async function wsLegacy(message, conversationId) {
	const user = await getUser();
	console.log(`connecting to ${WS_URL} (legacy graphql-ws subprotocol) as ${user.username}...`);

	const socket = new WebSocket(WS_URL, 'graphql-ws', { headers: { cookie } });
	const send = obj => socket.send(JSON.stringify(obj));

	socket.on('open', () => {
		console.log('ws open, sending connection_init');
		send({ type: 'connection_init', payload: { cookie, token } });
	});
	socket.on('message', raw => {
		const msg = JSON.parse(raw.toString());
		dump(`<- ${msg.type}`, msg);
		if (msg.type === 'connection_ack') {
			send({
				id: '1',
				type: 'start',
				payload: {
					query: SUBSCRIPTION,
					variables: {
						message,
						orgId: user.orgId,
						conversationId: conversationId ?? null,
						conversationType: 'HELP_DOCS',
					},
				},
			});
		}
		if (msg.type === 'complete' || msg.type === 'connection_error') socket.close();
	});
	socket.on('close', (code, reason) => console.log(`ws closed: code=${code} reason=${reason}`));
	socket.on('error', err => console.error('ws error:', err.message));
}

const PREFS_FIELDS = `
	id
	userId
	alwaysAllowedTools
	customInstructions
	metadata
	createdAt
	updatedAt
`;

async function prefs() {
	const body = await gql(`query { myRoboRewstyPreferences { ${PREFS_FIELDS} } }`);
	dump('myRoboRewstyPreferences', body);
}

async function allow(toolName) {
	if (!toolName) {
		console.error('usage: allow <toolName>');
		process.exit(1);
	}
	const body = await gql(
		`mutation ($toolName: String!) { addAllowedTool(toolName: $toolName) { ${PREFS_FIELDS} } }`,
		{ toolName },
	);
	dump(`addAllowedTool(${toolName})`, body);
}

async function unallow(toolName) {
	if (!toolName) {
		console.error('usage: unallow <toolName>');
		process.exit(1);
	}
	const body = await gql(
		`mutation ($toolName: String!) { removeAllowedTool(toolName: $toolName) { ${PREFS_FIELDS} } }`,
		{ toolName },
	);
	dump(`removeAllowedTool(${toolName})`, body);
}

/**
 * Provoke an approval, then probe the approve mechanism. Sends a prompt under
 * WORKFLOW_DIAGNOSIS context; if approval_required fires, attempts to continue
 * by resuming with the captured requestId. Pass a tool name as the 2nd arg to
 * also test the addAllowedTool path before resuming.
 */
async function provoke(message, toolToAllow) {
	// Read-only default: asks the agent to *inspect* workflow state, baiting a
	// gated read tool without creating or mutating anything in the sandbox org.
	const first = await wsChat(message ?? 'Diagnose why my most recent workflow execution failed — read its logs.', {
		conversationType: 'WORKFLOW_DIAGNOSIS',
	});
	if (!first.approval) {
		console.log(
			'\nNo approval_required observed — try a different prompt/context to make the agent call a gated tool.',
		);
		return;
	}
	if (toolToAllow) {
		console.log(`\nallow-listing "${toolToAllow}" before resume...`);
		await allow(toolToAllow);
	}
	if (!first.lastRequestId) {
		console.log('\nApproval fired but no requestId was captured — cannot resume.');
		return;
	}
	console.log(`\nresuming requestId=${first.lastRequestId} (conversationId=${first.conversationId ?? 'null'})...`);
	await wsChat('', {
		conversationId: first.conversationId,
		conversationType: 'WORKFLOW_DIAGNOSIS',
		resumeRequestId: first.lastRequestId,
	});
}

async function active() {
	const user = await getUser();
	const body = await gql(
		`query ($orgId: ID!, $userId: ID!) {
			activeConversationRequests(orgId: $orgId, userId: $userId) {
				requestId
				conversationId
				orgId
				userId
				updatedAt
			}
		}`,
		{ orgId: user.orgId, userId: user.id },
	);
	dump('activeConversationRequests', body);
}

async function cleanup() {
	const user = await getUser();
	const body = await gql(
		`query ($where: ConversationWhereInput) {
			conversations(where: $where, limit: 100) { id title }
		}`,
		{ where: { orgId: user.orgId, userId: user.id } },
	);
	const targets = (body.data?.conversations ?? []).filter(c => c.title?.startsWith(PROBE_TITLE_PREFIX));
	console.log(`found ${targets.length} probe conversation(s) to delete`);
	for (const c of targets) {
		const del = await gql(`mutation ($id: ID!) { deleteConversation(id: $id) }`, { id: c.id });
		console.log(`deleted ${c.id} (${c.title}):`, JSON.stringify(del));
	}
}

const [command, ...args] = process.argv.slice(2);
const commands = {
	whoami,
	list,
	show: () => show(args[0]),
	prefs,
	allow: () => allow(args[0]),
	unallow: () => unallow(args[0]),
	'http-chat': () => httpChat(args[0] ?? 'What is a Rewst workflow?'),
	'ws-chat': () => wsChat(args[0] ?? 'What is a Rewst workflow?', { conversationId: args[1] }),
	'ws-resume': () => wsChat(args[0] ?? '', { conversationId: args[1], resumeRequestId: args[2] }),
	provoke: () => provoke(args[0], args[1]),
	'ws-legacy': () => wsLegacy(args[0] ?? 'What is a Rewst workflow?', args[1]),
	active,
	cleanup,
};

if (!command || !commands[command]) {
	console.error(`Unknown command '${command ?? ''}'. Available: ${Object.keys(commands).join(', ')}`);
	process.exit(1);
}
await commands[command]();
