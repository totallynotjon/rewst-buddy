import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import {
	buildUnpackInput,
	classifyUnpackEvent,
	collectUnpackOutcome,
	isValueToken,
	parseCrateDetail,
	resolveTokenArguments,
	tokenDefault,
	type CrateDetail,
	type CrateTokenDetail,
} from './crateUnpack';

/** Builds a token row with sensible defaults, mirroring the GraphQL shape. */
function token(overrides: Partial<CrateTokenDetail> = {}): CrateTokenDetail {
	return {
		id: 'tok-1',
		name: 'Token One',
		type: 'inputVar',
		index: 0,
		options: [],
		...overrides,
	};
}

function crate(overrides: Partial<CrateDetail> = {}): CrateDetail {
	return {
		id: 'crate-1',
		name: 'User Onboarding',
		requiredOrgVariables: [],
		tokens: [],
		crateTriggers: [],
		...overrides,
	};
}

async function* scripted(...payloads: unknown[]): AsyncIterable<unknown> {
	for (const payload of payloads) {
		yield payload;
	}
}

suite('Unit: crateUnpack planner', () => {
	suite('parseCrateDetail()', () => {
		test('normalizes a crate row and sorts tokens by index', () => {
			const detail = parseCrateDetail({
				crate: {
					id: 'crate-1',
					name: 'User Onboarding',
					description: 'Full onboarding',
					requiredOrgVariables: ['ORG_VAR'],
					isUnpackedForSelectedOrg: false,
					workflow: { name: 'Onboarding Flow', humanSecondsSaved: 900 },
					tokens: [
						{ id: 'tok-b', name: 'Second', type: 'inputVar', index: 2, options: [] },
						{ id: 'tok-a', name: 'First', type: 'selectVar', index: 1, options: [] },
					],
					crateTriggers: [
						{
							id: 'ct-1',
							trigger: {
								id: 'tr-1',
								name: 'On Form Submit',
								criteria: { condition: {} },
								autoActivateManagedOrgs: true,
							},
						},
					],
				},
			});
			assert.ok(detail, 'crate row parses');
			assert.strictEqual(detail.id, 'crate-1');
			assert.strictEqual(detail.name, 'User Onboarding');
			assert.deepStrictEqual(detail.requiredOrgVariables, ['ORG_VAR']);
			// The unpacked-workflow defaults come from the crate's source workflow,
			// mirroring the web unpack wizard.
			assert.strictEqual(detail.workflowName, 'Onboarding Flow');
			assert.strictEqual(detail.humanSecondsSaved, 900);
			assert.deepStrictEqual(
				detail.tokens.map(t => t.id),
				['tok-a', 'tok-b'],
				'tokens sorted by index',
			);
			assert.strictEqual(detail.crateTriggers.length, 1);
			assert.strictEqual(detail.crateTriggers[0].id, 'ct-1');
			assert.strictEqual(detail.crateTriggers[0].triggerName, 'On Form Submit');
			assert.deepStrictEqual(detail.crateTriggers[0].criteria, { condition: {} });
			assert.strictEqual(detail.crateTriggers[0].autoActivateManagedOrgs, true);
		});

		test('missing crate row parses to undefined', () => {
			assert.strictEqual(parseCrateDetail({ crate: null }), undefined);
			assert.strictEqual(parseCrateDetail(undefined), undefined);
			assert.strictEqual(parseCrateDetail({}), undefined);
		});
	});

	suite('token planning', () => {
		test('input and select tokens carry values; display tokens do not', () => {
			assert.strictEqual(isValueToken(token({ type: 'inputVar' })), true);
			assert.strictEqual(isValueToken(token({ type: 'inputTriggerParam' })), true);
			assert.strictEqual(isValueToken(token({ type: 'selectVar' })), true);
			assert.strictEqual(isValueToken(token({ type: 'selectPackVar' })), true);
			assert.strictEqual(isValueToken(token({ type: 'selectTriggerParam' })), true);
			assert.strictEqual(isValueToken(token({ type: 'text' })), false);
			assert.strictEqual(isValueToken(token({ type: 'linebreak' })), false);
			assert.strictEqual(isValueToken(token({ type: 'requiresVar' })), false);
			assert.strictEqual(isValueToken(token({ type: undefined })), false);
		});

		test('tokenDefault prefers explicit value, then default option, then undefined', () => {
			assert.strictEqual(tokenDefault(token({ value: 'preset' })), 'preset');
			assert.strictEqual(
				tokenDefault(
					token({
						options: [
							{ id: 'o-1', label: 'A', value: 'a', isDefault: false },
							{ id: 'o-2', label: 'B', value: 'b', isDefault: true },
						],
					}),
				),
				'b',
			);
			assert.strictEqual(tokenDefault(token({})), undefined);
		});

		test('resolveTokenArguments matches by name and id, fills defaults, reports missing', () => {
			const tokens = [
				token({ id: 'tok-1', name: 'Team Name', type: 'inputVar', index: 0 }),
				token({
					id: 'tok-2',
					name: 'Channel',
					type: 'selectVar',
					index: 1,
					options: [{ id: 'o', label: 'General', value: 'general', isDefault: true }],
				}),
				token({ id: 'tok-3', name: 'Notes', type: 'text', index: 2 }),
				token({ id: 'tok-4', name: 'Region', type: 'inputVar', index: 3 }),
			];
			const { tokenArguments, missing } = resolveTokenArguments(tokens, {
				'Team Name': 'Acme',
				'tok-4': 'us-east',
			});
			assert.deepStrictEqual(tokenArguments, [
				{ crateTokenId: 'tok-1', value: 'Acme' },
				{ crateTokenId: 'tok-2', value: 'general' },
				{ crateTokenId: 'tok-4', value: 'us-east' },
			]);
			assert.deepStrictEqual(missing, [], 'nothing missing');
		});

		test('array values join for multiselect tokens', () => {
			const tokens = [
				token({
					id: 'tok-multi',
					name: 'Channels',
					type: 'selectVar',
					isMultiselect: true,
					options: [
						{ id: 'o-1', label: 'General', value: 'general', isDefault: false },
						{ id: 'o-2', label: 'Alerts', value: 'alerts', isDefault: false },
					],
				}),
			];
			const { tokenArguments, missing } = resolveTokenArguments(tokens, { Channels: ['general', 'alerts'] });
			// The platform expects multiselect values as a Jinja-wrapped JSON list —
			// the exact serialization the web unpack wizard sends.
			assert.deepStrictEqual(tokenArguments, [
				{ crateTokenId: 'tok-multi', value: '{{ ["general","alerts"] }}' },
			]);
			assert.deepStrictEqual(missing, []);
		});

		test('resolveTokenArguments lists value tokens with no value and no default as missing', () => {
			const tokens = [token({ id: 'tok-1', name: 'Team Name', type: 'inputVar' })];
			const { tokenArguments, missing } = resolveTokenArguments(tokens, {});
			assert.deepStrictEqual(tokenArguments, []);
			assert.strictEqual(missing.length, 1);
			assert.strictEqual(missing[0].name, 'Team Name');
		});
	});

	suite('buildUnpackInput()', () => {
		test('builds the full UnpackCrateInput the way the web unpack wizard does', () => {
			const detail = crate({
				workflowName: 'Onboarding Flow',
				humanSecondsSaved: 900,
				tokens: [token({ id: 'tok-1', name: 'Team Name', type: 'inputVar' })],
				crateTriggers: [
					{
						id: 'ct-1',
						triggerName: 'On Form Submit',
						criteria: { condition: {} },
						autoActivateManagedOrgs: true,
					},
				],
			});
			const input = buildUnpackInput(detail, {
				orgId: 'org-1',
				tokenValues: { 'Team Name': 'Acme' },
			});
			assert.deepStrictEqual(input, {
				crateId: 'crate-1',
				orgId: 'org-1',
				tokenArguments: [{ crateTokenId: 'tok-1', value: 'Acme' }],
				triggers: [
					{
						crateTriggerId: 'ct-1',
						triggerName: 'On Form Submit',
						enabled: false,
						isActivatedForOwner: true,
						// Carried from the trigger itself, as the web wizard defaults it.
						autoActivateManagedOrgs: true,
						activateForOrgIds: [],
						activateForTagIds: [],
						criteria: { condition: {} },
					},
				],
				// No orgId inside workflow — the org is the top-level orgId, and
				// humanSecondsSaved comes from the crate's source workflow.
				workflow: { name: 'Onboarding Flow', humanSecondsSaved: 900 },
			});
		});

		test('covers every trigger when a crate has several', () => {
			const detail = crate({
				crateTriggers: [
					{ id: 'ct-1', triggerName: 'On Form Submit', criteria: { condition: {} } },
					{
						id: 'ct-2',
						triggerName: 'On Timer',
						criteria: { schedule: 'daily' },
						autoActivateManagedOrgs: true,
					},
				],
			});
			const input = buildUnpackInput(detail, { orgId: 'org-1', enableTriggers: true });
			assert.strictEqual(input.triggers.length, 2);
			assert.deepStrictEqual(
				input.triggers.map(t => t.crateTriggerId),
				['ct-1', 'ct-2'],
			);
			assert.deepStrictEqual(
				input.triggers.map(t => t.triggerName),
				['On Form Submit', 'On Timer'],
				'each trigger keeps its own name',
			);
			assert.deepStrictEqual(
				input.triggers.map(t => t.criteria),
				[{ condition: {} }, { schedule: 'daily' }],
				'each trigger keeps its own criteria',
			);
			assert.deepStrictEqual(
				input.triggers.map(t => t.autoActivateManagedOrgs),
				[false, true],
				'autoActivateManagedOrgs is per-trigger',
			);
			assert.ok(
				input.triggers.every(t => t.enabled),
				'enableTriggers applies to all triggers',
			);
		});

		test('honors workflowName and enableTriggers, defaulting workflow fields when the crate has none', () => {
			const detail = crate({ crateTriggers: [{ id: 'ct-1', triggerName: 'On Timer' }] });
			const input = buildUnpackInput(detail, {
				orgId: 'org-1',
				workflowName: 'Custom Name',
				enableTriggers: true,
			});
			assert.strictEqual(input.workflow.name, 'Custom Name');
			assert.strictEqual(input.workflow.humanSecondsSaved, 0);
			assert.strictEqual(input.triggers[0].enabled, true);
			// A trigger with no criteria still sends an empty criteria object.
			assert.deepStrictEqual(input.triggers[0].criteria, {});
		});

		test('throws listing missing token names', () => {
			const detail = crate({ tokens: [token({ id: 'tok-1', name: 'Team Name', type: 'inputVar' })] });
			assert.throws(
				() => buildUnpackInput(detail, { orgId: 'org-1' }),
				(err: Error) => {
					assert.ok(err.message.includes('Team Name'), 'error names the missing token');
					return true;
				},
			);
		});
	});

	suite('classifyUnpackEvent()', () => {
		test('success event', () => {
			const event = classifyUnpackEvent({
				__typename: 'UnpackCrateStreamSuccessResponse',
				didSucceed: true,
				isFinished: true,
				id: 'wf-1',
				orgId: 'org-1',
				type: 'workflow',
			});
			assert.deepStrictEqual(event, { kind: 'success', id: 'wf-1', orgId: 'org-1', type: 'workflow' });
		});

		test('failure events carry the server error', () => {
			const event = classifyUnpackEvent({
				__typename: 'CloningImportPhaseStreamFailureResponse',
				didSucceed: false,
				isFinished: true,
				error: 'boom',
			});
			assert.strictEqual(event?.kind, 'failure');
			assert.ok(event.kind === 'failure' && event.error.includes('boom'));
		});

		test('success-shaped event that did not succeed is a failure', () => {
			const event = classifyUnpackEvent({
				__typename: 'UnpackCrateStreamSuccessResponse',
				didSucceed: false,
				isFinished: true,
				id: 'wf-1',
			});
			assert.strictEqual(event?.kind, 'failure');
		});

		test('progress and null payloads', () => {
			const progress = classifyUnpackEvent({
				__typename: 'CloningImportPhaseStreamMessage',
				isFinished: false,
				phase: 'import',
			});
			assert.strictEqual(progress?.kind, 'progress');
			assert.ok(progress.kind === 'progress' && progress.label.includes('import'));
			assert.strictEqual(classifyUnpackEvent(null), undefined);
			assert.strictEqual(classifyUnpackEvent(undefined), undefined);
		});
	});

	suite('collectUnpackOutcome()', () => {
		test('consumes progress then resolves on success', async () => {
			const labels: string[] = [];
			const outcome = await collectUnpackOutcome(
				scripted(
					{ __typename: 'ExportDownloadPhaseStreamMessage', isFinished: false, phase: 'export' },
					{ __typename: 'CloningImportPhaseStreamMessage', isFinished: false, phase: 'import' },
					{
						__typename: 'UnpackCrateStreamSuccessResponse',
						didSucceed: true,
						isFinished: true,
						id: 'wf-9',
						orgId: 'org-1',
						type: 'workflow',
					},
				),
				{ onProgress: label => labels.push(label) },
			);
			assert.strictEqual(outcome.id, 'wf-9');
			assert.strictEqual(labels.length, 2, 'both progress events reported');
		});

		test('rejects on a failure event with the server error', async () => {
			await assert.rejects(
				() =>
					collectUnpackOutcome(
						scripted({
							__typename: 'CloningImportPhaseStreamFailureResponse',
							didSucceed: false,
							isFinished: true,
							error: 'import exploded',
						}),
						{},
					),
				(err: Error) => {
					assert.ok(err.message.includes('import exploded'));
					return true;
				},
			);
		});

		test('rejects when the stream ends without a terminal event', async () => {
			await assert.rejects(
				() =>
					collectUnpackOutcome(
						scripted({ __typename: 'CloningImportPhaseStreamMessage', isFinished: false, phase: 'import' }),
						{},
					),
				(err: Error) => {
					assert.ok(err.message.length > 0);
					return true;
				},
			);
		});

		test('inactivity timeout aborts the transport and rejects', async () => {
			let aborted = false;
			const stalled: AsyncIterable<unknown> = {
				[Symbol.asyncIterator]() {
					return {
						next: () => new Promise<IteratorResult<unknown>>(() => {}),
					};
				},
			};
			await assert.rejects(
				() =>
					collectUnpackOutcome(stalled, {
						inactivityTimeoutMs: 20,
						abort: () => {
							aborted = true;
						},
					}),
				(err: Error) => {
					assert.ok(
						/no (unpack )?progress|timed out|no response/i.test(err.message),
						`timeout message: ${err.message}`,
					);
					return true;
				},
			);
			assert.ok(aborted, 'abort was invoked on timeout');
		});
	});
});
