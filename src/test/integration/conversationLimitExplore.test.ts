import * as Mocha from 'mocha';
import { askRewstAi, Session } from '@sessions';
import { clearCachedSession, getTestSession, hasTestToken, initTestEnvironment } from '@test';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

/**
 * EXPLORATION PROBE (not an assertion test): grows one RoboRewsty conversation
 * turn-by-turn until the backend's new "conversation is getting long" buttons
 * appear in the reply, dumping each turn's full reply + context usage so the
 * length-limit marker can be identified and a detector written against it.
 *
 * Run only on demand:
 *   unset REWST_TEST_TOKEN && npm run test:grep:integration -- "explore conversation length limit"
 */
suite('Integration: conversation length limit exploration', function () {
	this.timeout(1_200_000);

	let session: Session;

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		// getTestSession stores the validated cookie in secrets under user id,
		// which is exactly the key askRewstAi.getCookies reads.
		session = await getTestSession();
	});

	suiteTeardown(() => {
		clearCachedSession();
	});

	// Heuristic markers that a reply is the length-limit / "start a new chat"
	// prompt rather than a normal answer. Broad on purpose — the probe's job is
	// to surface the real wording, not to be the final detector.
	const SUSPECT =
		/new (chat|conversation)|start(ing)? (a )?(new|fresh)|conversation is getting long|reached the (maximum|max|length|limit)|too long|start over|\[[^\]]+\]\(command:|button/i;

	test('explore conversation length limit buttons', async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		const orgId = session.profile.org.id;
		let conversationId: string | undefined;
		const MAX_TURNS = 45;

		// Big filler to ramp context fast if the limit is token-based (~30k
		// tokens/turn ⇒ ~12 turns to a 350k window). Distinct per turn so the
		// backend can't collapse it as a duplicate. If the backend instead
		// summarizes and usage plateaus, the count-based limit still shows within
		// MAX_TURNS.
		const filler = (n: number): string =>
			Array.from(
				{ length: 2000 },
				(_, i) => `context-line-${n}-${i} lorem ipsum dolor sit amet consectetur adipiscing elit sed`,
			).join(' ');

		let prevPercent = -1;
		let plateauNoted = false;

		for (let turnNo = 1; turnNo <= MAX_TURNS; turnNo++) {
			const message =
				`Turn ${turnNo}. Please reply with a short paragraph about Rewst workflows. ` +
				`Here is some scratch context you can ignore: ${filler(turnNo)}`;

			let content = '';
			let usageLine = '(no usage reported)';
			let percent = -1;
			let errored: string | undefined;
			for await (const event of askRewstAi({
				session,
				orgId,
				message,
				conversationId,
				inactivityTimeoutMs: 180_000,
			})) {
				if (event.kind === 'conversation') conversationId = event.conversationId;
				if (event.kind === 'usage') {
					percent = event.percent;
					usageLine = `usage ${event.totalTokens}/${event.maxTokens} (${event.percent}%)`;
				}
				if (event.kind === 'complete') {
					content = event.content;
					if (event.conversationId) conversationId = event.conversationId;
				}
				if (event.kind === 'approval') {
					console.log(`\n>>> APPROVAL event on turn ${turnNo}:`, JSON.stringify(event.raw));
				}
				if (event.kind === 'error') errored = event.message;
			}

			console.log(`\n========== TURN ${turnNo} ========== ${usageLine} conv=${conversationId ?? '?'}`);
			if (errored) {
				console.log(`ERROR: ${errored}`);
				// Retry a transient interruption once; otherwise stop.
				if (/interrupted/i.test(errored)) {
					await new Promise(r => setTimeout(r, 15_000));
					continue;
				}
				break;
			}
			console.log(`REPLY (${content.length} chars):\n${content}`);

			// If context stops climbing while we keep feeding big messages, the
			// backend is summarizing — a token cap won't be reached, so the limit
			// (if any) is count-based. Note it once so the run's shape is clear.
			if (!plateauNoted && percent >= 0 && prevPercent >= 0 && percent <= prevPercent && turnNo > 3) {
				console.log(
					`>>> NOTE: context usage plateaued (${prevPercent}%→${percent}%) — backend is summarizing.`,
				);
				plateauNoted = true;
			}
			prevPercent = percent;

			if (SUSPECT.test(content)) {
				console.log(
					`\n>>> SUSPECT length-limit marker detected on turn ${turnNo}. Full reply above. Stopping.`,
				);
				break;
			}
		}
	});
});
