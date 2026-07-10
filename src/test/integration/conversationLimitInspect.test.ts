import * as Mocha from 'mocha';
import { askRewstAi, Session } from '@sessions';
import { clearCachedSession, getTestSession, hasTestToken, initTestEnvironment } from '@test';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

// The probe conversation that the web UI now shows the length-limit warning on.
const FLAGGED_CONVERSATION_ID = '019f4856-cf9e-7391-82b9-cea2b8cb441d';
const INSPECT_OPT_IN_ENV = 'REWST_CONVERSATION_LIMIT_INSPECT';
const CONTINUATION_OPT_IN_ENV = 'REWST_CONVERSATION_LIMIT_CONTINUATION';

function envFlag(name: string): boolean {
	return process.env[name] === '1';
}

function objectKeys(value: unknown): string[] {
	return value && typeof value === 'object' && !Array.isArray(value)
		? Object.keys(value as Record<string, unknown>)
		: [];
}

function jsonSize(value: unknown): number {
	return JSON.stringify(value ?? null).length;
}

function boundedText(value: unknown, max = 180): string {
	const text = String(value ?? '');
	return text.length > max ? `${text.slice(0, max)}...[truncated ${text.length - max} chars]` : text;
}

/**
 * INSPECTION PROBE (not an assertion test): fetches a conversation the web UI
 * flags as length-limited and prints bounded structural summaries of
 * conversation metadata plus every message's metadata/role so the length-limit
 * marker (a field our subscription mapper drops) can be identified without
 * logging live content.
 *
 *   REWST_CONVERSATION_LIMIT_INSPECT=1 npm run test:grep:integration -- "inspect flagged conversation metadata"
 *   REWST_CONVERSATION_LIMIT_INSPECT=1 REWST_CONVERSATION_LIMIT_CONTINUATION=1 npm run test:grep:integration -- "reproduce a continuation error"
 */
suite('Integration: conversation length limit inspection', function () {
	this.timeout(120_000);

	let session: Session;

	suiteSetup(async function () {
		if (!hasTestToken() || !envFlag(INSPECT_OPT_IN_ENV)) {
			this.skip();
			return;
		}
		initTestEnvironment();
		session = await getTestSession();
	});

	suiteTeardown(() => {
		clearCachedSession();
	});

	test('reproduce a continuation error on the near-full conversation', async function () {
		if (!hasTestToken() || !envFlag(INSPECT_OPT_IN_ENV) || !envFlag(CONTINUATION_OPT_IN_ENV)) {
			this.skip();
			return;
		}
		const orgId = session.profile.org.id;
		// One more turn on the ~98%-full conversation, with a large payload, to see
		// whether the backend errors and exactly what error text the provider gets.
		const big = Array.from(
			{ length: 4000 },
			(_, i) => `payload-${i} lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod`,
		).join(' ');
		const message = `Please summarize everything discussed so far in detail. Extra context: ${big}`;

		const kinds: string[] = [];
		let errorMsg: string | undefined;
		for await (const event of askRewstAi({
			session,
			orgId,
			message,
			conversationId: FLAGGED_CONVERSATION_ID,
			inactivityTimeoutMs: 180_000,
		})) {
			kinds.push(event.kind);
			if (event.kind === 'usage')
				console.log(`  usage ${event.totalTokens}/${event.maxTokens} (${event.percent}%)`);
			if (event.kind === 'error') errorMsg = event.message;
		}
		console.log(`\n===== continuation result =====`);
		console.log(`event kinds: ${kinds.join(', ')}`);
		console.log(`ERROR: ${errorMsg ? boundedText(errorMsg) : '(none — completed normally)'}`);
	});

	test('find and inspect the azure-function conversation tail', async function () {
		if (!hasTestToken() || !envFlag(INSPECT_OPT_IN_ENV)) {
			this.skip();
			return;
		}
		const sdk = session.sdk;
		if (!sdk) throw new Error('no sdk on test session');

		const list = await sdk.getConversations({
			where: { orgId: session.profile.org.id, userId: session.profile.user.id },
			limit: 50,
			order: [['updatedAt', 'DESC']],
		});
		const convos = list.conversations ?? [];
		console.log(`\n===== ${convos.length} recent conversations =====`);
		convos.forEach(c => console.log(`  ${c.id}  type=${c.type}  titleLen=${(c.title ?? '').length}`));

		const azure = convos.find(c => /azure|function/i.test(c.title ?? ''));
		if (!azure) {
			console.log('\n>>> No azure/function conversation found in the most recent 50.');
			return;
		}
		console.log(`\n>>> AZURE conversation: ${azure.id}  type=${azure.type}`);

		const full = await sdk.getConversation({ id: azure.id });
		const convo = full.conversation;
		const messages = convo?.messages ?? [];
		console.log(`messages: ${messages.length}`);
		const rehydrated = (convo?.metadata as Record<string, unknown> | undefined)?.rehydratedConversation as
			| Record<string, unknown>
			| undefined;
		console.log(`graphState keys: [${objectKeys(rehydrated?.graphState).join(',')}]`);
		console.log(
			`internalMessages count: ${Array.isArray(rehydrated?.internalMessages) ? rehydrated.internalMessages.length : 'n/a'}`,
		);

		console.log(`\n===== last 6 messages (role, stopReason, metaKeys) =====`);
		messages.slice(-6).forEach((m, i) => {
			const meta = m.metadata as Record<string, unknown> | null | undefined;
			console.log(
				`[${messages.length - 6 + i}] role=${m.role} stopReason=${boundedText(meta?.stopReason ?? '-', 80)} metaKeys=[${objectKeys(meta).join(',')}] metaBytes=${jsonSize(meta)} len=${(m.content ?? '').length}`,
			);
		});
	});

	test('inspect flagged conversation metadata', async function () {
		if (!hasTestToken() || !envFlag(INSPECT_OPT_IN_ENV)) {
			this.skip();
			return;
		}
		const sdk = session.sdk;
		if (!sdk) throw new Error('no sdk on test session');

		const res = await sdk.getConversation({ id: FLAGGED_CONVERSATION_ID });
		const convo = res.conversation;
		if (!convo) {
			console.log(`\n>>> conversation ${FLAGGED_CONVERSATION_ID} not found for this user.`);
			return;
		}

		console.log(`\n===== CONVERSATION ${convo.id} =====`);
		console.log(`titleLen: ${(convo.title ?? '').length}  type: ${convo.type}  updatedAt: ${convo.updatedAt}`);
		const meta = convo.metadata as Record<string, unknown> | null | undefined;
		const metaJson = JSON.stringify(convo.metadata ?? null);
		console.log(`conversation.metadata: ${metaJson.length} bytes, top-level keys:`);
		console.log(`  [${objectKeys(meta).join(', ') || typeof meta}]`);
		// Scan the whole serialized metadata for length-limit signal words.
		const NEEDLES = [
			'limit',
			'max',
			'length',
			'token',
			'full',
			'warning',
			'exceed',
			'fresh',
			'new conversation',
			'start a new',
			'too long',
			'truncat',
			'summariz',
			'closed',
			'locked',
			'button',
		];
		for (const needle of NEEDLES) {
			const idx = metaJson.toLowerCase().indexOf(needle);
			if (idx >= 0) {
				console.log(`  HIT "${needle}" @${idx}`);
			}
		}

		const messages = convo.messages ?? [];
		console.log(`\n===== ${messages.length} MESSAGES (metadata + role) =====`);
		messages.forEach((m, i) => {
			const meta = m.metadata as Record<string, unknown> | null | undefined;
			console.log(
				`\n[#${i}] role=${m.role} id=${m.id} metaKeys=[${objectKeys(meta).join(', ')}] metaBytes=${jsonSize(meta)} contentLen=${(m.content ?? '').length}`,
			);
		});

		// The last assistant message is where a "conversation is full" flag or
		// button payload would most plausibly live — summarize it without content.
		const lastAssistant = [...messages].reverse().find(m => m.role === 'ASSISTANT');
		if (lastAssistant) {
			console.log(`\n===== LAST ASSISTANT MESSAGE (summary) =====`);
			console.log(`contentLen: ${(lastAssistant.content ?? '').length}`);
			console.log(`metadataKeys: [${objectKeys(lastAssistant.metadata).join(', ')}]`);
			console.log(`metadataBytes: ${jsonSize(lastAssistant.metadata)}`);
		}
	});
});
