/**
 * Unit tests for evaluateRenderJinja (the structured render helper extracted
 * from runRenderJinja for use by the Jinja preview panel).
 *
 * Runner: mocha extension-host (touches @sessions / vscode transitively).
 * The existing buddy_render_jinja tests live in
 * src/ui/chat/tools/workflowTools.test.ts and are left byte-for-byte
 * unmodified — this file only covers the new evaluateRenderJinja surface.
 */

import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { GraphqlToolDeps } from '../ui/chat/tools/graphqlTool';
import { evaluateRenderJinja } from './executions';

const { suite, test, setup } = Mocha;

// ---------------------------------------------------------------------------
// Minimal fakeDeps factory — mirrors the pattern in workflowTools.test.ts
// (sits at the GraphqlToolDeps seam, not the Session/MockWrapper seam).
// ---------------------------------------------------------------------------

type FakeExecuteHandler = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

function makeDeps(handler: FakeExecuteHandler): GraphqlToolDeps {
	return {
		isEnabled: () => true,
		confirmMutation: async () => true,
		execute: handler as GraphqlToolDeps['execute'],
	};
}

suite('Unit: evaluateRenderJinja', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('returns ok:true with rendered value on success', async () => {
		const deps = makeDeps(async query => {
			if (query.includes('RewstBuddyRenderJinja')) {
				return { data: { renderJinja: { result: 'hello' } } };
			}
			return { data: {} };
		});

		const outcome = await evaluateRenderJinja(deps, 'org-1', '{{ CTX.x }}', { x: 'hello' });

		assert.strictEqual(outcome.ok, true);
		assert.strictEqual(outcome.value, 'hello');
		assert.strictEqual(outcome.hasControlCharacter, false);
	});

	test('returns ok:false with jinjaError on a Jinja error', async () => {
		const deps = makeDeps(async query => {
			if (query.includes('RewstBuddyRenderJinja')) {
				return { data: { renderJinja: { result: undefined, error: 'unexpected char' } } };
			}
			return { data: {} };
		});

		const outcome = await evaluateRenderJinja(deps, 'org-1', '{{ bad jinja }}', {});

		assert.strictEqual(outcome.ok, false);
		assert.strictEqual(outcome.jinjaError, 'unexpected char');
	});

	test('flags a control character in the rendered value', async () => {
		const deps = makeDeps(async query => {
			if (query.includes('RewstBuddyRenderJinja')) {
				return { data: { renderJinja: { result: 'hello\x07world' } } };
			}
			return { data: {} };
		});

		const outcome = await evaluateRenderJinja(deps, 'org-1', '{{ CTX.x }}', {});

		assert.strictEqual(outcome.ok, true);
		assert.strictEqual(outcome.hasControlCharacter, true);
	});

	test('throws with GraphQL error context on a transport error', async () => {
		const deps = makeDeps(async query => {
			if (query.includes('RewstBuddyRenderJinja')) {
				return { errors: [{ message: 'network timeout' }] };
			}
			return { data: {} };
		});

		await assert.rejects(
			() => evaluateRenderJinja(deps, 'org-1', '{{ CTX.x }}', {}),
			(err: Error) => {
				assert.ok(
					err.message.includes('network timeout'),
					`expected error to include 'network timeout', got: ${err.message}`,
				);
				return true;
			},
		);
	});
});
