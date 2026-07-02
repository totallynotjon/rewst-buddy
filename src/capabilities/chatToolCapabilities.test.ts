import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import { SessionManager } from '@sessions';
import type { CapabilityContext } from './Capability';
import { executionLogsDeps } from './chatToolCapabilities';

const { suite, test, setup } = Mocha;

function twoSessionContext() {
	const one = createMockSession({
		profile: {
			org: { id: 'org-1', name: 'One' },
			user: Fixtures.userFragment({ id: 'user-1', orgId: 'org-1' }),
		},
	}).session;
	const two = createMockSession({
		profile: {
			org: { id: 'org-2', name: 'Two' },
			user: Fixtures.userFragment({ id: 'user-2', orgId: 'org-2' }),
		},
	}).session;
	SessionManager._setSessionsForTesting([one, two]);
	const ctx: CapabilityContext = { session: one, orgId: 'org-1', sessions: [one, two] };
	return { ctx, one, two };
}

suite('Unit: chatToolCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	suite('executionLogsDeps()', () => {
		test('without orgId the context session leads and the others become alternates', async () => {
			const { ctx } = twoSessionContext();
			const deps = await executionLogsDeps({}, ctx);
			assert.strictEqual(deps.cacheScope, 'org-1', 'primary is the context session');
			assert.strictEqual(deps.alternates?.length, 1);
			assert.strictEqual(deps.alternates![0].cacheScope, 'org-2');
		});

		test('an orgId routes the primary to the session managing that org', async () => {
			const { ctx } = twoSessionContext();
			const deps = await executionLogsDeps({ orgId: 'org-2' }, ctx);
			assert.strictEqual(deps.cacheScope, 'org-2', 'primary follows the requested org');
			assert.strictEqual(deps.alternates?.length, 1);
			assert.strictEqual(deps.alternates![0].cacheScope, 'org-1');
		});

		test('an unknown orgId falls back to the context session instead of erroring', async () => {
			const { ctx } = twoSessionContext();
			const deps = await executionLogsDeps({ orgId: 'org-nope' }, ctx);
			assert.strictEqual(deps.cacheScope, 'org-1');
			assert.strictEqual(deps.alternates?.length, 1);
		});
	});
});
