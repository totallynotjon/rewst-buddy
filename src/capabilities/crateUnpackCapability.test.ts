import type { Session } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { listTools } from '../mcp/McpActions';
import type { McpSettings } from '../mcp/settings';
import { _resetApprovedMutationScopes, type MutationScope } from '../ui/chat/tools/graphqlTool';
import type { CapabilityContext } from './Capability';
import { _resetMcpMutationApproverForTesting, setMcpMutationApprover } from './graphqlMutateCapability';
import {
	_setUnpackTransportForTesting,
	crateUnpackCapability,
	type UnpackOutcome,
	type UnpackTransportOptions,
} from './crateUnpackCapability';
import { getCapability } from './registry';

const { suite, test, setup, teardown } = Mocha;

const CRATE_ROW = {
	id: 'crate-1',
	name: 'User Onboarding',
	description: 'Full onboarding',
	requiredOrgVariables: ['ORG_VAR'],
	isUnpackedForSelectedOrg: false,
	workflow: { name: 'Onboarding Flow', humanSecondsSaved: 900 },
	tokens: [
		{ id: 'tok-1', name: 'Team Name', type: 'inputVar', index: 0, options: [] },
		{
			id: 'tok-2',
			name: 'Channel',
			type: 'selectVar',
			index: 1,
			options: [{ id: 'o-1', label: 'General', value: 'general', isDefault: true }],
		},
	],
	crateTriggers: [
		{
			id: 'ct-1',
			trigger: {
				id: 'tr-1',
				name: 'On Form Submit',
				criteria: { condition: {} },
				autoActivateManagedOrgs: false,
			},
		},
	],
};

function useRawGraphqlWrapper(session: Session, wrapper: ReturnType<typeof createMockSession>['wrapper']): void {
	const wrap = wrapper.getWrapper();
	(session as { rawGraphql: Session['rawGraphql'] }).rawGraphql = async (query, variables) => {
		return wrap(async () => ({ data: undefined, errors: undefined }), 'rawGraphql', 'query RewstBuddyCrateDetail', {
			query,
			variables,
		});
	};
}

function sandboxCtx(orgId = 'org-sandbox', name = 'Sandbox') {
	const { session, wrapper } = createMockSession({ profile: { org: { id: orgId, name } } });
	useRawGraphqlWrapper(session, wrapper);
	const ctx: CapabilityContext = { session, orgId, sessions: [session] };
	return { ctx, wrapper };
}

suite('Unit: crateUnpackCapability', () => {
	let transportCalls: UnpackTransportOptions[];

	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		transportCalls = [];
		_setUnpackTransportForTesting(async (opts): Promise<UnpackOutcome> => {
			transportCalls.push(opts);
			return { id: 'wf-9', orgId: opts.input.orgId, type: 'workflow' };
		});
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		_setUnpackTransportForTesting(undefined);
	});

	test('registered write capability requiring org, crateId, and orgId', () => {
		const cap = getCapability('buddy_unpack_crate');
		assert.ok(cap, 'buddy_unpack_crate is registered');
		assert.strictEqual(cap, crateUnpackCapability);
		assert.strictEqual(cap.access, 'write');
		assert.notStrictEqual(cap.requiresOrg, false);
		const schema = cap.spec.inputSchema as { required: string[]; properties: Record<string, unknown> };
		assert.deepStrictEqual([...schema.required].sort(), ['crateId', 'orgId']);
		assert.ok('workflowName' in schema.properties);
		assert.ok('tokenValues' in schema.properties);
		assert.ok('enableTriggers' in schema.properties);
	});

	test('unpacks with approval: fetches detail, builds input, reports the unpacked workflow', async () => {
		const { ctx, wrapper } = sandboxCtx();
		wrapper.when('rawGraphql', { data: { data: { crate: CRATE_ROW } } });
		let seenScope: MutationScope | undefined;
		let seenSummary = '';
		setMcpMutationApprover(async (scope, summary) => {
			seenScope = scope;
			seenSummary = summary;
			return true;
		});

		const output = await crateUnpackCapability.run(
			{ orgId: 'org-sandbox', crateId: 'crate-1', tokenValues: { 'Team Name': 'Acme' } },
			ctx,
		);

		// Detail query carried the crate + org.
		const calls = wrapper.getCallsFor('rawGraphql');
		assert.strictEqual(calls.length, 1);
		const vars = (calls[0].variables as { variables: Record<string, unknown> }).variables;
		assert.strictEqual(vars.crateId, 'crate-1');
		assert.strictEqual(vars.orgId, 'org-sandbox');

		// Approval names the crate and the target org.
		assert.ok(seenScope);
		assert.strictEqual(seenScope.orgId, 'org-sandbox');
		assert.strictEqual(seenScope.scopeName, 'User Onboarding');
		assert.ok(seenSummary.includes('User Onboarding'));
		assert.ok(seenSummary.includes('org-sandbox'));

		// Transport received the fully built input, shaped like the web unpack wizard's.
		assert.strictEqual(transportCalls.length, 1);
		assert.deepStrictEqual(transportCalls[0].input, {
			crateId: 'crate-1',
			orgId: 'org-sandbox',
			tokenArguments: [
				{ crateTokenId: 'tok-1', value: 'Acme' },
				{ crateTokenId: 'tok-2', value: 'general' },
			],
			triggers: [
				{
					crateTriggerId: 'ct-1',
					triggerName: 'On Form Submit',
					enabled: false,
					isActivatedForOwner: true,
					autoActivateManagedOrgs: false,
					activateForOrgIds: [],
					activateForTagIds: [],
					criteria: { condition: {} },
				},
			],
			workflow: { name: 'Onboarding Flow', humanSecondsSaved: 900 },
		});

		const parsed = JSON.parse(output);
		assert.strictEqual(parsed.status, 'unpacked');
		assert.strictEqual(parsed.unpackedId, 'wf-9');
		assert.strictEqual(parsed.crateName, 'User Onboarding');
		assert.strictEqual(parsed.workflowName, 'Onboarding Flow');
		assert.deepStrictEqual(parsed.requiredOrgVariables, ['ORG_VAR']);
	});

	test('does not unpack when approval is denied', async () => {
		const { ctx, wrapper } = sandboxCtx();
		wrapper.when('rawGraphql', { data: { data: { crate: CRATE_ROW } } });
		setMcpMutationApprover(async () => false);

		const output = await crateUnpackCapability.run(
			{ orgId: 'org-sandbox', crateId: 'crate-1', tokenValues: { 'Team Name': 'Acme' } },
			ctx,
		);

		assert.strictEqual(JSON.parse(output).status, 'approval_required');
		assert.strictEqual(transportCalls.length, 0, 'transport never invoked');
	});

	test('missing token values return a structured input_required list before requesting approval', async () => {
		const { ctx, wrapper } = sandboxCtx();
		wrapper.when('rawGraphql', { data: { data: { crate: CRATE_ROW } } });
		let approverCalled = false;
		setMcpMutationApprover(async () => {
			approverCalled = true;
			return true;
		});

		const output = await crateUnpackCapability.run({ orgId: 'org-sandbox', crateId: 'crate-1' }, ctx);
		const parsed = JSON.parse(output);
		assert.strictEqual(parsed.status, 'input_required');
		// The one token with neither a provided value nor a default is described
		// dynamically: name, type, and its options so the caller can prompt or pick.
		assert.strictEqual(parsed.missingTokens.length, 1);
		assert.strictEqual(parsed.missingTokens[0].name, 'Team Name');
		assert.strictEqual(parsed.missingTokens[0].type, 'inputVar');
		// Tokens that resolved via defaults are reported too, so the caller can
		// override them in the same retry if the defaults are wrong.
		const resolved = parsed.resolvedTokens as { name: string; value: string }[];
		assert.deepStrictEqual(resolved, [{ name: 'Channel', value: 'general' }]);
		assert.strictEqual(approverCalled, false, 'approval never requested');
		assert.strictEqual(transportCalls.length, 0, 'transport never invoked');
	});

	test('select tokens surface their option labels and values in input_required', async () => {
		const { ctx, wrapper } = sandboxCtx();
		const row = {
			...CRATE_ROW,
			tokens: [
				{
					id: 'tok-sel',
					name: 'Region',
					type: 'selectVar',
					index: 0,
					// No default option — must be surfaced with its choices.
					options: [
						{ id: 'o-1', label: 'US East', value: 'us-east', isDefault: false },
						{ id: 'o-2', label: 'EU West', value: 'eu-west', isDefault: false },
					],
				},
			],
		};
		wrapper.when('rawGraphql', { data: { data: { crate: row } } });

		const output = await crateUnpackCapability.run({ orgId: 'org-sandbox', crateId: 'crate-1' }, ctx);
		const parsed = JSON.parse(output);
		assert.strictEqual(parsed.status, 'input_required');
		assert.strictEqual(parsed.missingTokens.length, 1);
		const missing = parsed.missingTokens[0];
		assert.strictEqual(missing.name, 'Region');
		assert.deepStrictEqual(
			missing.options.map((o: { value: string }) => o.value),
			['us-east', 'eu-west'],
			'select options listed for dynamic prompting',
		);
		assert.strictEqual(transportCalls.length, 0);
	});

	test('multiselect tokens accept an array of values', async () => {
		const { ctx, wrapper } = sandboxCtx();
		const row = {
			...CRATE_ROW,
			tokens: [
				{
					id: 'tok-multi',
					name: 'Channels',
					type: 'selectVar',
					index: 0,
					isMultiselect: true,
					options: [
						{ id: 'o-1', label: 'General', value: 'general', isDefault: false },
						{ id: 'o-2', label: 'Alerts', value: 'alerts', isDefault: false },
					],
				},
			],
		};
		wrapper.when('rawGraphql', { data: { data: { crate: row } } });
		setMcpMutationApprover(async () => true);

		const output = await crateUnpackCapability.run(
			{ orgId: 'org-sandbox', crateId: 'crate-1', tokenValues: { Channels: ['general', 'alerts'] } },
			ctx,
		);

		assert.strictEqual(JSON.parse(output).status, 'unpacked');
		assert.strictEqual(transportCalls.length, 1);
		// Multiselect values ride as the Jinja-wrapped JSON list the platform expects.
		assert.deepStrictEqual(transportCalls[0].input.tokenArguments, [
			{ crateTokenId: 'tok-multi', value: '{{ ["general","alerts"] }}' },
		]);
	});

	test('exposed to chat and MCP only when write tools are enabled', () => {
		// Cage-Free Rewsty's chat tools mirror listTools() (buddyChatToolSpecs), so
		// this pins both surfaces: hidden while write tools are off, listed when on.
		const settings = (enableWriteTools: boolean): McpSettings => ({
			enable: true,
			enableWriteTools,
			enableDangerousGraphqlMutation: false,
			alwaysAllowedOrgs: [],
			workingOrgScope: 'strict',
		});
		const withoutWrite = listTools(settings(false)).map(tool => tool.name);
		assert.ok(!withoutWrite.includes('buddy_unpack_crate'), 'hidden while write tools are disabled');
		const withWrite = listTools(settings(true)).map(tool => tool.name);
		assert.ok(withWrite.includes('buddy_unpack_crate'), 'listed once write tools are enabled');
	});

	test('unknown crate rejects', async () => {
		const { ctx, wrapper } = sandboxCtx();
		wrapper.when('rawGraphql', { data: { data: { crate: null } } });

		await assert.rejects(
			() => crateUnpackCapability.run({ orgId: 'org-sandbox', crateId: 'crate-x' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('crate-x'), 'error names the crate id');
				return true;
			},
		);
		assert.strictEqual(transportCalls.length, 0);
	});

	test('GraphQL errors propagate', async () => {
		const { ctx, wrapper } = sandboxCtx();
		wrapper.when('rawGraphql', { data: { data: undefined, errors: [{ message: 'crate error' }] } });

		await assert.rejects(
			() => crateUnpackCapability.run({ orgId: 'org-sandbox', crateId: 'crate-1' }, ctx),
			(err: Error) => {
				assert.ok(err.message.includes('GraphQL error'));
				return true;
			},
		);
	});
});
