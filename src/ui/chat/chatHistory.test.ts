import * as assert from 'assert';
import * as Mocha from 'mocha';
import { findPriorTurnState } from './chatHistory';

const { suite, test } = Mocha;

function responseTurn(rewst?: { conversationId?: string; orgId?: string }, extraMetadata?: Record<string, unknown>) {
	return { result: { metadata: { ...extraMetadata, ...(rewst ? { rewst } : {}) } } };
}

suite('Unit: findPriorTurnState', () => {
	test('returns undefined for empty history', () => {
		assert.strictEqual(findPriorTurnState([]), undefined);
	});

	test('returns undefined when no turn carries rewst metadata', () => {
		const history = [
			{ prompt: 'hi' }, // request turn (no result)
			responseTurn(undefined, { other: true }),
		];
		assert.strictEqual(findPriorTurnState(history), undefined);
	});

	test('finds rewst state from a response turn', () => {
		const history = [{ prompt: 'hi' }, responseTurn({ conversationId: 'conv-1', orgId: 'org-1' })];
		assert.deepStrictEqual(findPriorTurnState(history), { conversationId: 'conv-1', orgId: 'org-1' });
	});

	test('last rewst-carrying turn wins', () => {
		const history = [
			responseTurn({ conversationId: 'conv-1', orgId: 'org-1' }),
			responseTurn({ conversationId: 'conv-2', orgId: 'org-2' }),
			responseTurn(undefined, { foreign: 1 }),
		];
		assert.deepStrictEqual(findPriorTurnState(history), { conversationId: 'conv-2', orgId: 'org-2' });
	});

	test('skips malformed turns without throwing', () => {
		const history = [null, undefined, 42, { result: null }, responseTurn({ orgId: 'org-3' })];
		assert.deepStrictEqual(findPriorTurnState(history), { conversationId: undefined, orgId: 'org-3' });
	});
});
