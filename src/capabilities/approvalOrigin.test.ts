import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import { currentApprovalOrigin, runWithApprovalOrigin } from './approvalOrigin';
import {
	_resetMcpMutationApproverForTesting,
	requestMcpMutationApproval,
	setMcpMutationApprover,
} from './graphqlMutateCapability';

const { suite, test, teardown } = Mocha;

const scope: MutationScope = { scopeId: 's1', scopeName: 'Thing', orgId: 'org-1', orgName: 'Org' };

suite('Unit: approvalOrigin', () => {
	teardown(() => _resetMcpMutationApproverForTesting());

	test('defaults to mcp outside any origin scope', () => {
		assert.strictEqual(currentApprovalOrigin(), 'mcp');
	});

	test('runWithApprovalOrigin sets the in-flight origin and survives an async hop', async () => {
		const seen = await runWithApprovalOrigin('chat', async () => {
			// The origin must persist across awaited boundaries — capability runs and
			// the approval prompt are async, so read it after a microtask.
			await Promise.resolve();
			return currentApprovalOrigin();
		});
		assert.strictEqual(seen, 'chat');
		assert.strictEqual(currentApprovalOrigin(), 'mcp', 'origin does not leak outside the scope');
	});

	test('requestMcpMutationApproval reports the current origin to the approver', async () => {
		let seen: string | undefined;
		setMcpMutationApprover(async (_scope, _operation, origin) => {
			seen = origin;
			return false;
		});

		await requestMcpMutationApproval(scope, 'op');
		assert.strictEqual(seen, 'mcp', 'an external MCP call is the default origin');

		await runWithApprovalOrigin('chat', () => requestMcpMutationApproval(scope, 'op'));
		assert.strictEqual(seen, 'chat', 'an in-process chat call is reported as chat');
	});
});
