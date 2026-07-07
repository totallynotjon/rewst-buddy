import type { Session } from '@sessions';
import { clearCachedSession, getTestSession, hasTestToken, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { rawGraphqlOrThrow } from '../../capabilities/inputHelpers';
import { buildUnpackInput, CRATE_DETAIL_QUERY, CRATE_LIST_QUERY, parseCrateDetail } from '../../crates/crateUnpack';

const { suite, test, suiteSetup, suiteTeardown } = Mocha;

/**
 * Live read-only probes for the crate-unpack planner: the catalog and detail
 * queries must parse real production crates end-to-end, and the resulting
 * UnpackCrateInput must assemble the same shape the web unpack wizard sends
 * (verified against a captured HAR of the "Add Client to Rewst" wizard).
 * Nothing here unpacks anything — the subscription is never started.
 */

// Public Rewst-maintained crate ("Add Client to Rewst") used in the HAR capture.
const KNOWN_CRATE_ID = '1df926ab-e10f-451f-ac24-5ffbfb94c4ae';

suite('Integration: crate unpack planning probes', function () {
	this.timeout(120_000);

	let session: Session;
	let orgId: string;

	suiteSetup(async function () {
		if (!hasTestToken()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		session = await getTestSession();
		orgId = session.profile.org.id;
		if (!orgId) throw new Error('Refusing to run: the test session has no primary org id.');
		console.log(`\n[itest] target org: ${session.profile.org.name} (${orgId})`);
	});

	suiteTeardown(() => {
		clearCachedSession();
	});

	test('catalog list query returns crates for the org', async () => {
		const data = await rawGraphqlOrThrow(session, CRATE_LIST_QUERY, { orgId, limit: 5 });
		const crates = (data as { crates?: { id?: string; name?: string }[] } | undefined)?.crates ?? [];
		assert.ok(crates.length > 0, 'at least one catalog crate visible');
		assert.ok(crates[0].id, 'crates carry ids');
	});

	test('detail query on a known public crate parses and builds a wizard-shaped input', async () => {
		const data = await rawGraphqlOrThrow(session, CRATE_DETAIL_QUERY, { crateId: KNOWN_CRATE_ID, orgId });
		const crate = parseCrateDetail(data);
		assert.ok(crate, 'known crate parses');
		assert.strictEqual(crate.id, KNOWN_CRATE_ID);
		assert.ok(crate.name.length > 0, 'crate has a name');
		assert.ok(crate.tokens.length > 0, 'crate carries tokens');
		assert.ok(crate.crateTriggers.length > 0, 'crate carries at least one trigger');
		for (const trigger of crate.crateTriggers) {
			assert.ok(trigger.triggerName, 'each trigger resolves its underlying trigger name');
		}
		assert.ok(crate.workflowName, 'source workflow name resolves for the default');
		assert.strictEqual(typeof crate.humanSecondsSaved, 'number', 'source workflow humanSecondsSaved resolves');

		// This crate's tokens are all display-only in production, so the input
		// builds with no supplied values — matching the web wizard, which asks
		// for nothing but workflow name and trigger settings.
		const input = buildUnpackInput(crate, { orgId });
		assert.strictEqual(input.crateId, KNOWN_CRATE_ID);
		assert.strictEqual(input.orgId, orgId);
		assert.strictEqual(typeof input.workflow.humanSecondsSaved, 'number');
		assert.ok(!('orgId' in input.workflow), 'workflow carries no orgId (top-level orgId owns targeting)');
		assert.strictEqual(input.triggers.length, crate.crateTriggers.length, 'every crate trigger is covered');
		for (const trigger of input.triggers) {
			assert.strictEqual(trigger.enabled, false, 'triggers default to disabled');
			assert.deepStrictEqual(trigger.activateForOrgIds, []);
			assert.deepStrictEqual(trigger.activateForTagIds, []);
			assert.notStrictEqual(trigger.criteria, undefined, 'criteria is always sent');
		}
	});
});
