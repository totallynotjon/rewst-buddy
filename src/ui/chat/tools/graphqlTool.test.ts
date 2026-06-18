import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import {
	_resetApprovedMutationScopes,
	approveMutationScope,
	detectOperationType,
	graphqlMutationConfirmation,
	graphqlMutationScope,
	isGraphqlTool,
	isMutationScopeApproved,
	runGraphqlTool,
	type GraphqlToolDeps,
	type MutationScope,
} from './graphqlTool';

const { suite, test, setup } = Mocha;

const SCHEMA_TOOL = 'buddy_graphql_schema';
const READ_TOOL = 'buddy_graphql_read';
const MUTATE_TOOL = 'buddy_graphql_mutate';

function deps(over: Partial<GraphqlToolDeps> = {}): GraphqlToolDeps {
	return {
		isEnabled: () => true,
		confirmMutation: async () => true,
		execute: async () => ({ data: { ok: true } }),
		...over,
	};
}

const SCOPE: MutationScope = { scopeId: 'wf-1', scopeName: 'My Workflow', orgId: 'org-1', orgName: 'Acme' };

/** A scoped mutation request's args: the four scope fields plus a query. */
function scopedMutation(over: Record<string, unknown> = {}): Record<string, unknown> {
	return { query: 'mutation U { updateTemplate { id } }', ...SCOPE, ...over };
}

suite('Unit: graphqlTool', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
	});

	test('isGraphqlTool recognizes split GraphQL tools', () => {
		assert.ok(isGraphqlTool(READ_TOOL));
		assert.ok(isGraphqlTool(MUTATE_TOOL));
		assert.ok(isGraphqlTool(SCHEMA_TOOL));
		assert.ok(!isGraphqlTool('read_file'));
	});

	suite('detectOperationType()', () => {
		test('named and anonymous queries', () => {
			assert.strictEqual(detectOperationType('query Foo { user { id } }'), 'query');
			assert.strictEqual(detectOperationType('{ user { id } }'), 'query');
		});

		test('mutations, including after fragments and queries', () => {
			assert.strictEqual(detectOperationType('mutation Update { updateTemplate { id } }'), 'mutation');
			assert.strictEqual(
				detectOperationType('query A { user { id } }\nmutation B { deleteTemplate { id } }'),
				'mutation',
			);
		});

		test('subscriptions are detected', () => {
			assert.strictEqual(detectOperationType('subscription S { conversationMessage { id } }'), 'subscription');
		});

		test('keywords inside strings, comments, and selections do not count', () => {
			assert.strictEqual(detectOperationType('query Q { search(term: "mutation") { id } }'), 'query');
			assert.strictEqual(detectOperationType('# mutation in a comment\nquery Q { user { id } }'), 'query');
			assert.strictEqual(detectOperationType('{ mutation { id } }'), 'query');
		});
	});

	suite('graphqlMutationConfirmation()', () => {
		test('names the resource and org and shows the operation and variables', () => {
			const confirmation = graphqlMutationConfirmation(
				MUTATE_TOOL,
				scopedMutation({
					query: 'mutation U($id: ID!) { updateTemplate(id: $id) { id } }',
					variables: { id: 't-1' },
				}),
			);
			assert.ok(confirmation, 'an unapproved mutation needs confirmation');
			assert.match(confirmation.message, /My Workflow/);
			assert.match(confirmation.message, /wf-1/);
			assert.match(confirmation.message, /Acme/);
			assert.match(confirmation.message, /org-1/);
			assert.match(confirmation.message, /```graphql/);
			assert.match(confirmation.message, /mutation U/);
			assert.match(confirmation.message, /Variables:/);
			assert.match(confirmation.message, /"id": "t-1"/);
		});

		test('omits the variables block when there are none', () => {
			const confirmation = graphqlMutationConfirmation(
				MUTATE_TOOL,
				scopedMutation({ query: 'mutation D { deleteTemplate { id } }' }),
			);
			assert.ok(confirmation);
			assert.doesNotMatch(confirmation.message, /Variables:/);
		});

		test('widens the fence so backticks in the operation cannot close it early', () => {
			const confirmation = graphqlMutationConfirmation(
				MUTATE_TOOL,
				scopedMutation({ query: 'mutation M { x(body: "```danger```") { id } }' }),
			);
			assert.ok(confirmation);
			// The inner ``` run forces a 4-backtick fence around the operation.
			assert.match(confirmation.message, /````graphql\n/);
			assert.match(confirmation.message, /\n````/);
		});

		test('returns undefined for queries and schema reads', () => {
			assert.strictEqual(
				graphqlMutationConfirmation(MUTATE_TOOL, scopedMutation({ query: '{ user { id } }' })),
				undefined,
			);
			assert.strictEqual(graphqlMutationConfirmation(READ_TOOL, scopedMutation()), undefined);
			assert.strictEqual(graphqlMutationConfirmation(SCHEMA_TOOL, {}), undefined);
		});

		test('returns undefined for other tools, bad queries, and a mutation missing any scope field', () => {
			assert.strictEqual(
				graphqlMutationConfirmation('read_file', scopedMutation({ query: 'mutation D { x }' })),
				undefined,
			);
			assert.strictEqual(graphqlMutationConfirmation(MUTATE_TOOL, {}), undefined);
			assert.strictEqual(graphqlMutationConfirmation(MUTATE_TOOL, { query: '   ' }), undefined);
			assert.strictEqual(graphqlMutationConfirmation(MUTATE_TOOL, undefined), undefined);
			// A mutation missing any scope field is refused in runGraphqlTool, so
			// there is nothing to approve here.
			for (const field of ['scopeId', 'scopeName', 'orgId', 'orgName']) {
				assert.strictEqual(
					graphqlMutationConfirmation(MUTATE_TOOL, scopedMutation({ [field]: undefined })),
					undefined,
					`missing ${field}`,
				);
			}
		});

		test('an already-approved scope needs no further confirmation, a new resource does', () => {
			assert.ok(graphqlMutationConfirmation(MUTATE_TOOL, scopedMutation()), 'first time prompts');

			approveMutationScope(SCOPE);
			assert.strictEqual(
				graphqlMutationConfirmation(MUTATE_TOOL, scopedMutation()),
				undefined,
				'same resource no longer prompts',
			);
			assert.ok(
				graphqlMutationConfirmation(MUTATE_TOOL, scopedMutation({ scopeId: 'wf-2' })),
				'a different resource still prompts',
			);
			assert.ok(
				graphqlMutationConfirmation(MUTATE_TOOL, scopedMutation({ orgId: 'org-2' })),
				'the same resource id in another org still prompts',
			);
		});
	});

	suite('graphqlMutationScope() + scope approval', () => {
		test('reports the full scope only for a complete scoped mutation', () => {
			assert.deepStrictEqual(graphqlMutationScope(MUTATE_TOOL, scopedMutation()), SCOPE);
			assert.strictEqual(
				graphqlMutationScope(MUTATE_TOOL, scopedMutation({ scopeName: undefined })),
				undefined,
			);
			assert.strictEqual(
				graphqlMutationScope(MUTATE_TOOL, scopedMutation({ query: '{ user { id } }' })),
				undefined,
			);
			assert.strictEqual(graphqlMutationScope(READ_TOOL, scopedMutation()), undefined);
		});

		test('approval is keyed on org + resource ids, not names', () => {
			assert.strictEqual(isMutationScopeApproved(SCOPE), false);
			approveMutationScope(SCOPE);
			assert.strictEqual(isMutationScopeApproved(SCOPE), true);
			// A different display name for the same ids is still approved.
			assert.strictEqual(isMutationScopeApproved({ ...SCOPE, scopeName: 'Renamed', orgName: 'Acme Inc' }), true);
			// A different id is not.
			assert.strictEqual(isMutationScopeApproved({ ...SCOPE, scopeId: 'wf-2' }), false);
			_resetApprovedMutationScopes();
			assert.strictEqual(isMutationScopeApproved(SCOPE), false);
		});
	});

	test('safe schema and read ignore the unsafe setting, but still require a session', async () => {
		await assert.doesNotReject(
			runGraphqlTool(
				{ tool: READ_TOOL, args: { query: '{ user { id } }' } },
				deps({ isEnabled: () => false }),
			),
		);
		await assert.doesNotReject(
			runGraphqlTool({ tool: SCHEMA_TOOL, args: {} }, deps({ isEnabled: () => false })),
		);
		await assert.rejects(
			runGraphqlTool({ tool: READ_TOOL, args: { query: '{ user { id } }' } }, undefined),
			/active Rewst session/,
		);
	});

	test('mutations are gated by the GraphQL Unsafe setting', async () => {
		await assert.rejects(
			runGraphqlTool({ tool: MUTATE_TOOL, args: scopedMutation() }, deps({ isEnabled: () => false })),
			/GraphQL Unsafe/,
		);
	});

	test('requires a query argument', async () => {
		await assert.rejects(runGraphqlTool({ tool: READ_TOOL, args: {} }, deps()), /requires a "query"/);
		await assert.rejects(
			runGraphqlTool({ tool: MUTATE_TOOL, args: { query: '  ' } }, deps()),
			/requires a "query"/,
		);
	});

	test('rejects non-object variables', async () => {
		await assert.rejects(
			runGraphqlTool({ tool: READ_TOOL, args: { query: '{ user { id } }', variables: [1] } }, deps()),
			/must be a JSON object/,
		);
	});

	test('rejects subscriptions', async () => {
		await assert.rejects(
			runGraphqlTool({ tool: READ_TOOL, args: { query: 'subscription S { x }' } }, deps()),
			/does not support subscriptions/,
		);
		await assert.rejects(
			runGraphqlTool({ tool: MUTATE_TOOL, args: scopedMutation({ query: 'subscription S { x }' }) }, deps()),
			/does not support subscriptions/,
		);
	});

	test('read and mutate reject the opposite operation type', async () => {
		await assert.rejects(
			runGraphqlTool({ tool: READ_TOOL, args: scopedMutation() }, deps()),
			/buddy_graphql_read only supports queries/,
		);
		await assert.rejects(
			runGraphqlTool({ tool: MUTATE_TOOL, args: { query: '{ user { id } }' } }, deps()),
			/buddy_graphql_mutate requires a mutation/,
		);
	});

	test('runs queries without confirmation and passes variables through', async () => {
		let confirms = 0;
		const calls: { query: string; variables?: Record<string, unknown> }[] = [];
		const output = await runGraphqlTool(
			{
				tool: READ_TOOL,
				args: { query: 'query T($id: ID!) { template(id: $id) { name } }', variables: { id: 't-1' } },
			},
			deps({
				confirmMutation: async () => {
					confirms++;
					return true;
				},
				execute: async (query, variables) => {
					calls.push({ query, variables });
					return { data: { template: { name: 'My Template' } } };
				},
			}),
		);
		assert.strictEqual(confirms, 0);
		assert.strictEqual(calls.length, 1);
		assert.deepStrictEqual(calls[0].variables, { id: 't-1' });
		assert.match(output, /My Template/);
	});

	test('asks for confirmation before running a mutation, with the resource, org, and operation in the summary', async () => {
		let confirmed = '';
		const output = await runGraphqlTool(
			{
				tool: MUTATE_TOOL,
				args: scopedMutation({
					query: 'mutation U($id: ID!) { updateTemplate(id: $id) { id } }',
					variables: { id: 't-1' },
				}),
			},
			deps({
				confirmMutation: async operation => {
					confirmed = operation;
					return true;
				},
			}),
		);
		assert.match(confirmed, /My Workflow/);
		assert.match(confirmed, /wf-1/);
		assert.match(confirmed, /Acme/);
		assert.match(confirmed, /org-1/);
		assert.match(confirmed, /mutation U/);
		assert.match(confirmed, /"id": "t-1"/);
		assert.match(output, /"ok": true/);
	});

	test('refuses a mutation that is missing any scope field, naming the missing ones', async () => {
		for (const field of ['scopeId', 'scopeName', 'orgId', 'orgName']) {
			let ran = false;
			await assert.rejects(
				runGraphqlTool(
					{
						tool: MUTATE_TOOL,
						args: scopedMutation({ query: 'mutation D { deleteTemplate { id } }', [field]: undefined }),
					},
					deps({
						execute: async () => {
							ran = true;
							return {};
						},
					}),
				),
				new RegExp(field),
				`missing ${field} is refused`,
			);
			assert.strictEqual(ran, false, `${field}: nothing ran`);
		}
	});

	test('does not run a declined mutation', async () => {
		let ran = false;
		await assert.rejects(
			runGraphqlTool(
				{ tool: MUTATE_TOOL, args: scopedMutation({ query: 'mutation D { deleteTemplate { id } }' }) },
				deps({
					confirmMutation: async () => false,
					execute: async () => {
						ran = true;
						return {};
					},
				}),
			),
			/declined this mutation/,
		);
		assert.strictEqual(ran, false);
	});

	test('includes GraphQL errors in the output', async () => {
		const output = await runGraphqlTool(
			{ tool: READ_TOOL, args: { query: '{ nope }' } },
			deps({ execute: async () => ({ data: null, errors: [{ message: 'Cannot query field "nope"' }] }) }),
		);
		assert.match(output, /Cannot query field/);
		assert.ok(!output.includes('"data"'));
	});

	test('returns oversized responses intact for the shared tool-output formatter', async () => {
		const big = 'x'.repeat(20_000);
		const output = await runGraphqlTool(
			{ tool: READ_TOOL, args: { query: '{ big }' } },
			deps({ execute: async () => ({ data: { big } }) }),
		);
		assert.ok(output.includes(big));
		assert.doesNotMatch(output, /output truncated/);
	});

	suite('buddy_graphql_schema', () => {
		test('lists root operation fields', async () => {
			const output = await runGraphqlTool(
				{ tool: SCHEMA_TOOL, args: {} },
				deps({
					execute: async (_query, variables) => {
						assert.deepStrictEqual(variables, { includeDeprecated: false });
						return {
							data: {
								__schema: {
									queryType: {
										name: 'Query',
										fields: [
											{
												name: 'templates',
												args: [
													{
														name: 'orgId',
														type: {
															kind: 'NON_NULL',
															ofType: { kind: 'SCALAR', name: 'ID' },
														},
													},
												],
												type: { kind: 'LIST', ofType: { kind: 'OBJECT', name: 'Template' } },
											},
										],
									},
									mutationType: { name: 'Mutation', fields: [] },
								},
							},
						};
					},
				}),
			);
			assert.match(output, /## Query \(Query\)/);
			assert.match(output, /templates\(orgId: ID!\): \[Template\]/);
			assert.match(output, /typeName/);
		});

		test('inspects a named type', async () => {
			const output = await runGraphqlTool(
				{ tool: SCHEMA_TOOL, args: { typeName: 'TemplateInput', includeDeprecated: true } },
				deps({
					execute: async (_query, variables) => {
						assert.deepStrictEqual(variables, { typeName: 'TemplateInput', includeDeprecated: true });
						return {
							data: {
								__type: {
									kind: 'INPUT_OBJECT',
									name: 'TemplateInput',
									inputFields: [
										{
											name: 'name',
											type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'String' } },
										},
										{ name: 'body', type: { kind: 'SCALAR', name: 'String' } },
									],
								},
							},
						};
					},
				}),
			);
			assert.match(output, /TemplateInput \(INPUT_OBJECT\)/);
			assert.match(output, /name: String!/);
			assert.match(output, /body: String/);
		});

		test('searches type names and root operation fields', async () => {
			const output = await runGraphqlTool(
				{ tool: SCHEMA_TOOL, args: { search: 'template' } },
				deps({
					execute: async () => ({
						data: {
							__schema: {
								types: [
									{ name: 'Template', kind: 'OBJECT' },
									{ name: 'Workflow', kind: 'OBJECT' },
								],
								queryType: {
									name: 'Query',
									fields: [
										{ name: 'template', args: [], type: { kind: 'OBJECT', name: 'Template' } },
									],
								},
								mutationType: {
									name: 'Mutation',
									fields: [
										{
											name: 'updateTemplate',
											args: [],
											type: { kind: 'OBJECT', name: 'Template' },
										},
									],
								},
							},
						},
					}),
				}),
			);
			assert.match(output, /type Template \(OBJECT\)/);
			assert.match(output, /Query\.template: Template/);
			assert.match(output, /Mutation\.updateTemplate: Template/);
		});

		test('validates schema arguments', async () => {
			await assert.rejects(
				runGraphqlTool({ tool: SCHEMA_TOOL, args: { typeName: '', search: 'x' } }, deps()),
				/typeName/,
			);
			await assert.rejects(
				runGraphqlTool({ tool: SCHEMA_TOOL, args: { typeName: 'A', search: 'B' } }, deps()),
				/either "typeName" or "search"/,
			);
		});
	});
});
