import * as assert from 'assert';
import * as Mocha from 'mocha';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import {
	_resetMcpMutationApproverForTesting,
	setMcpMutationApprover,
	type Capability,
	type CapabilityContext,
} from '@capabilities';
import { _resetApprovedMutationScopes, type MutationScope } from '../ui/chat/tools/graphqlTool';
import { TEMPLATE_MUTATE_CAPABILITIES } from './templateMutateCapabilities';

const { suite, test, setup, teardown } = Mocha;

function cap(name: string): Capability {
	const capability = TEMPLATE_MUTATE_CAPABILITIES.find(c => c.spec.name === name);
	if (!capability) throw new Error(`missing capability ${name}`);
	return capability;
}

/** A mock session whose primary org is the given id, plus a ctx scoped to it. */
function sandboxCtx(orgId = 'org-sandbox', name = 'Sandbox') {
	const { session, wrapper } = createMockSession({ profile: { org: { id: orgId, name } } });
	const ctx: CapabilityContext = { session, orgId, sessions: [session] };
	return { ctx, wrapper };
}

suite('Unit: templateMutateCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	suite('buddy_create_template', () => {
		test('is a write capability gated by approval, mcp-only', () => {
			const c = cap('buddy_create_template');
			assert.strictEqual(c.access, 'write');
			assert.strictEqual(c.mcp, true);
			assert.strictEqual(c.chat, false);
			assert.notStrictEqual(c.requiresOrg, false);
		});

		test('creates the template and returns its id when approved', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper.when('createTemplateMinimal', {
				data: Fixtures.createTemplateMinimalMutation({ id: 't-new', name: 'My Template' }),
			});
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_create_template').run(
				{ orgId: 'org-sandbox', name: 'My Template', body: 'hello' },
				ctx,
			);

			const calls = wrapper.getCallsFor('createTemplateMinimal');
			assert.strictEqual(calls.length, 1);
			assert.deepStrictEqual(calls[0].variables, { name: 'My Template', orgId: 'org-sandbox', body: 'hello' });
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.status, 'created');
			assert.strictEqual(parsed.id, 't-new');
		});

		test('passes the requested org to the approval scope and summary', async () => {
			const { ctx, wrapper } = sandboxCtx('org-sandbox', 'Sandbox');
			wrapper.when('createTemplateMinimal', { data: Fixtures.createTemplateMinimalMutation({ id: 't-1' }) });
			let seenScope: MutationScope | undefined;
			let seenSummary = '';
			setMcpMutationApprover(async (scope, summary) => {
				seenScope = scope;
				seenSummary = summary;
				return true;
			});

			await cap('buddy_create_template').run({ orgId: 'org-sandbox', name: 'Greeting', body: '' }, ctx);

			assert.strictEqual(seenScope?.orgId, 'org-sandbox');
			assert.strictEqual(seenScope?.orgName, 'Sandbox');
			assert.ok(seenSummary.includes('Greeting'));
			assert.ok(seenSummary.includes('org-sandbox'));
		});

		test('does not mutate when approval is denied', async () => {
			const { ctx, wrapper } = sandboxCtx();
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_create_template').run(
				{ orgId: 'org-sandbox', name: 'My Template', body: 'hello' },
				ctx,
			);

			assert.strictEqual(wrapper.getCallsFor('createTemplateMinimal').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});

		test('allows an empty body but rejects a missing one', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper.when('createTemplateMinimal', { data: Fixtures.createTemplateMinimalMutation({ id: 't-blank' }) });
			setMcpMutationApprover(async () => true);

			await cap('buddy_create_template').run({ orgId: 'org-sandbox', name: 'Blank', body: '' }, ctx);
			assert.strictEqual(wrapper.getCallsFor('createTemplateMinimal')[0].variables!.body, '');

			await assert.rejects(
				() => cap('buddy_create_template').run({ orgId: 'org-sandbox', name: 'No Body' }, ctx),
				/Missing required string argument "body"/,
			);
		});

		test('rejects a blank name before requesting approval', async () => {
			const { ctx, wrapper } = sandboxCtx();
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_create_template').run({ orgId: 'org-sandbox', name: '   ', body: 'x' }, ctx),
				/Missing required string argument "name"/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(wrapper.getCallsFor('createTemplateMinimal').length, 0);
		});
	});

	suite('buddy_update_template_body', () => {
		test('is a write capability gated by approval, mcp-only', () => {
			const c = cap('buddy_update_template_body');
			assert.strictEqual(c.access, 'write');
			assert.strictEqual(c.mcp, true);
			assert.strictEqual(c.chat, false);
			assert.notStrictEqual(c.requiresOrg, false);
		});

		test('updates the body when the template is in-org and approved', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper
				.when('getTemplate', {
					data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-sandbox', name: 'My T' }),
				})
				.when('updateTemplateBody', {
					data: Fixtures.updateTemplateBodyMutation({ id: 't-1', orgId: 'org-sandbox', name: 'My T' }),
				});
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_update_template_body').run(
				{ orgId: 'org-sandbox', templateId: 't-1', body: 'new body' },
				ctx,
			);

			const calls = wrapper.getCallsFor('updateTemplateBody');
			assert.strictEqual(calls.length, 1);
			assert.deepStrictEqual(calls[0].variables, { id: 't-1', body: 'new body' });
			assert.strictEqual(JSON.parse(output).status, 'updated');
		});

		test('refuses to mutate a template that belongs to another org', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper.when('getTemplate', {
				data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-OTHER', name: 'Foreign' }),
			});
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() =>
					cap('buddy_update_template_body').run({ orgId: 'org-sandbox', templateId: 't-1', body: 'x' }, ctx),
				/Template t-1 is not in org org-sandbox/,
			);
			// The org check runs before any prompt or mutation: fail closed.
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 0);
		});

		test('does not mutate when approval is denied', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper.when('getTemplate', {
				data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-sandbox', name: 'My T' }),
			});
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_update_template_body').run(
				{ orgId: 'org-sandbox', templateId: 't-1', body: 'x' },
				ctx,
			);

			assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});

		test('allows an empty body but rejects a missing one', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper
				.when('getTemplate', {
					data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-sandbox', name: 'My T' }),
				})
				.when('updateTemplateBody', {
					data: Fixtures.updateTemplateBodyMutation({ id: 't-1', orgId: 'org-sandbox' }),
				});
			setMcpMutationApprover(async () => true);

			await cap('buddy_update_template_body').run({ orgId: 'org-sandbox', templateId: 't-1', body: '' }, ctx);
			assert.strictEqual(wrapper.getCallsFor('updateTemplateBody')[0].variables!.body, '');

			await assert.rejects(
				() => cap('buddy_update_template_body').run({ orgId: 'org-sandbox', templateId: 't-1' }, ctx),
				/Missing required string argument "body"/,
			);
		});

		test('rejects a blank templateId before fetching or approving', async () => {
			const { ctx, wrapper } = sandboxCtx();
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_update_template_body').run({ orgId: 'org-sandbox', templateId: '  ', body: 'x' }, ctx),
				/Missing required string argument "templateId"/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 0);
			assert.strictEqual(wrapper.getCallsFor('updateTemplateBody').length, 0);
		});
	});

	suite('buddy_rename_template', () => {
		test('is a write capability gated by approval, mcp-only', () => {
			const c = cap('buddy_rename_template');
			assert.strictEqual(c.access, 'write');
			assert.strictEqual(c.mcp, true);
			assert.strictEqual(c.chat, false);
			assert.notStrictEqual(c.requiresOrg, false);
		});

		test('renames the template when in-org and approved', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper
				.when('getTemplate', {
					data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-sandbox', name: 'Old Name' }),
				})
				.when('updateTemplateName', {
					data: {
						__typename: 'Mutation',
						template: Fixtures.fullTemplate({ id: 't-1', orgId: 'org-sandbox', name: 'New Name' }),
					},
				});
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_rename_template').run(
				{ orgId: 'org-sandbox', templateId: 't-1', name: 'New Name' },
				ctx,
			);

			const calls = wrapper.getCallsFor('updateTemplateName');
			assert.strictEqual(calls.length, 1);
			assert.deepStrictEqual(calls[0].variables, { id: 't-1', name: 'New Name' });
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.status, 'renamed');
			assert.strictEqual(parsed.name, 'New Name');
		});

		test('refuses to rename a template that belongs to another org', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper.when('getTemplate', {
				data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-OTHER', name: 'Foreign' }),
			});
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_rename_template').run({ orgId: 'org-sandbox', templateId: 't-1', name: 'X' }, ctx),
				/Template t-1 is not in org org-sandbox/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(wrapper.getCallsFor('updateTemplateName').length, 0);
		});

		test('does not mutate when approval is denied', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper.when('getTemplate', {
				data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-sandbox', name: 'Old Name' }),
			});
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_rename_template').run(
				{ orgId: 'org-sandbox', templateId: 't-1', name: 'New Name' },
				ctx,
			);

			assert.strictEqual(wrapper.getCallsFor('updateTemplateName').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});

		test('rejects a blank name before fetching or approving', async () => {
			const { ctx, wrapper } = sandboxCtx();
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_rename_template').run({ orgId: 'org-sandbox', templateId: 't-1', name: '  ' }, ctx),
				/Missing required string argument "name"/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 0);
			assert.strictEqual(wrapper.getCallsFor('updateTemplateName').length, 0);
		});
	});

	suite('buddy_delete_template', () => {
		test('is a write capability gated by approval, mcp-only', () => {
			const c = cap('buddy_delete_template');
			assert.strictEqual(c.access, 'write');
			assert.strictEqual(c.mcp, true);
			assert.strictEqual(c.chat, false);
			assert.notStrictEqual(c.requiresOrg, false);
		});

		test('deletes the template when in-org and approved', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper
				.when('getTemplate', {
					data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-sandbox', name: 'Doomed' }),
				})
				.when('deleteTemplate', { data: { __typename: 'Mutation', deleteTemplate: 't-1' } });
			setMcpMutationApprover(async () => true);

			const output = await cap('buddy_delete_template').run({ orgId: 'org-sandbox', templateId: 't-1' }, ctx);

			assert.strictEqual(wrapper.getCallsFor('deleteTemplate').length, 1);
			assert.deepStrictEqual(wrapper.getCallsFor('deleteTemplate')[0].variables, { id: 't-1' });
			const parsed = JSON.parse(output);
			assert.strictEqual(parsed.status, 'deleted');
			assert.strictEqual(parsed.id, 't-1');
		});

		test('refuses to delete a template that belongs to another org', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper.when('getTemplate', {
				data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-OTHER', name: 'Foreign' }),
			});
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_delete_template').run({ orgId: 'org-sandbox', templateId: 't-1' }, ctx),
				/Template t-1 is not in org org-sandbox/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(wrapper.getCallsFor('deleteTemplate').length, 0);
		});

		test('does not delete when approval is denied', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper.when('getTemplate', {
				data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-sandbox', name: 'Doomed' }),
			});
			setMcpMutationApprover(async () => false);

			const output = await cap('buddy_delete_template').run({ orgId: 'org-sandbox', templateId: 't-1' }, ctx);

			assert.strictEqual(wrapper.getCallsFor('deleteTemplate').length, 0);
			assert.strictEqual(JSON.parse(output).status, 'approval_required');
		});

		test('rejects a blank templateId before fetching or approving', async () => {
			const { ctx, wrapper } = sandboxCtx();
			let approverCalled = false;
			setMcpMutationApprover(async () => {
				approverCalled = true;
				return true;
			});

			await assert.rejects(
				() => cap('buddy_delete_template').run({ orgId: 'org-sandbox', templateId: '  ' }, ctx),
				/Missing required string argument "templateId"/,
			);
			assert.strictEqual(approverCalled, false);
			assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 0);
			assert.strictEqual(wrapper.getCallsFor('deleteTemplate').length, 0);
		});
	});

	suite('backend-failure branches', () => {
		const inOrg = () => ({ data: Fixtures.getTemplateQuery({ id: 't-1', orgId: 'org-sandbox', name: 'T' }) });

		test('create surfaces an SDK error', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper.when('createTemplateMinimal', { error: new Error('boom') });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_create_template').run({ orgId: 'org-sandbox', name: 'X', body: '' }, ctx),
				/boom/,
			);
		});

		test('create throws when no template is returned', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper.when('createTemplateMinimal', { data: { __typename: 'Mutation', template: null } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_create_template').run({ orgId: 'org-sandbox', name: 'X', body: '' }, ctx),
				/returned no template/,
			);
		});

		test('buddy_update_template_body throws when no template is returned', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper
				.when('getTemplate', inOrg())
				.when('updateTemplateBody', { data: { __typename: 'Mutation', template: null } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() =>
					cap('buddy_update_template_body').run({ orgId: 'org-sandbox', templateId: 't-1', body: 'x' }, ctx),
				/returned no template/,
			);
		});

		test('buddy_rename_template throws when no template is returned', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper
				.when('getTemplate', inOrg())
				.when('updateTemplateName', { data: { __typename: 'Mutation', template: null } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_rename_template').run({ orgId: 'org-sandbox', templateId: 't-1', name: 'New' }, ctx),
				/returned no template/,
			);
		});

		test('buddy_delete_template throws when no id is returned', async () => {
			const { ctx, wrapper } = sandboxCtx();
			wrapper
				.when('getTemplate', inOrg())
				.when('deleteTemplate', { data: { __typename: 'Mutation', deleteTemplate: null } });
			setMcpMutationApprover(async () => true);
			await assert.rejects(
				() => cap('buddy_delete_template').run({ orgId: 'org-sandbox', templateId: 't-1' }, ctx),
				/returned no id/,
			);
		});
	});
});
