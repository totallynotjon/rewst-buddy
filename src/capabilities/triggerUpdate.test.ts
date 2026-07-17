import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import { diffTriggerStates, type TriggerState } from './triggerUpdate';

function state(overrides: Partial<TriggerState> = {}): TriggerState {
	return {
		id: 't1',
		name: 'Nightly',
		enabled: true,
		orgId: 'org-sandbox',
		workflowId: 'wf1',
		formId: null,
		description: 'desc',
		autoActivateManagedOrgs: false,
		criteria: { kind: 'cron', expr: '0 0 * * *' },
		parameters: null,
		state: null,
		cloneOverrides: { activatedForOrgIds: ['orgA'], name: 'Clone' },
		tags: [{ id: 'tagX', name: 'X' }],
		activatedForOrgs: [{ id: 'orgA', name: 'Org A' }],
		...overrides,
	};
}

suite('Unit: diffTriggerStates', () => {
	test('reports a genuine field change', () => {
		const diff = diffTriggerStates(state(), state({ tags: [{ id: 'tagX' }, { id: 'tagY' }] }));
		assert.deepStrictEqual(diff.tagIds, { before: ['tagX'], after: ['tagX', 'tagY'] });
		assert.strictEqual(Object.keys(diff).length, 1);
	});

	test('key order alone is not a change in raw object fields', () => {
		const before = state({
			criteria: { kind: 'cron', expr: '0 0 * * *' },
			cloneOverrides: { activatedForOrgIds: ['orgA'], name: 'Clone' },
		});
		const after = state({
			criteria: { expr: '0 0 * * *', kind: 'cron' },
			cloneOverrides: { name: 'Clone', activatedForOrgIds: ['orgA'] },
		});
		assert.deepStrictEqual(diffTriggerStates(before, after), {});
	});

	test('nested key reordering is not a change either', () => {
		const before = state({ parameters: { outer: { a: 1, b: [{ x: 1, y: 2 }] } } });
		const after = state({ parameters: { outer: { b: [{ y: 2, x: 1 }], a: 1 } } });
		assert.deepStrictEqual(diffTriggerStates(before, after), {});
	});

	test('array order inside raw fields is still meaningful', () => {
		const before = state({ criteria: { steps: ['a', 'b'] } });
		const after = state({ criteria: { steps: ['b', 'a'] } });
		assert.deepStrictEqual(Object.keys(diffTriggerStates(before, after)), ['criteria']);
	});

	test('reordered tag and activation-org lists are not a change', () => {
		const before = state({
			tags: [
				{ id: 'tagX', name: 'X' },
				{ id: 'tagY', name: 'Y' },
			],
			activatedForOrgs: [
				{ id: 'orgA', name: 'Org A' },
				{ id: 'orgB', name: 'Org B' },
			],
		});
		const after = state({
			tags: [
				{ id: 'tagY', name: 'Y' },
				{ id: 'tagX', name: 'X' },
			],
			activatedForOrgs: [
				{ id: 'orgB', name: 'Org B' },
				{ id: 'orgA', name: 'Org A' },
			],
		});
		assert.deepStrictEqual(diffTriggerStates(before, after), {});
	});
});
