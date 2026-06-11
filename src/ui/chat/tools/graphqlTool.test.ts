import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { detectOperationType, isGraphqlTool, runGraphqlTool, type GraphqlToolDeps } from './graphqlTool';

const { suite, test, setup } = Mocha;

function deps(over: Partial<GraphqlToolDeps> = {}): GraphqlToolDeps {
	return {
		isEnabled: () => true,
		confirmMutation: async () => true,
		execute: async () => ({ data: { ok: true } }),
		...over,
	};
}

suite('Unit: graphqlTool', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('isGraphqlTool recognizes rewst_graphql', () => {
		assert.ok(isGraphqlTool('rewst_graphql'));
		assert.ok(isGraphqlTool('rewst_graphql_schema'));
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

	test('fails when the tool is disabled or deps are missing', async () => {
		await assert.rejects(
			runGraphqlTool(
				{ tool: 'rewst_graphql', args: { query: '{ user { id } }' } },
				deps({ isEnabled: () => false }),
			),
			/enableGraphqlTool/,
		);
		await assert.rejects(
			runGraphqlTool({ tool: 'rewst_graphql', args: { query: '{ user { id } }' } }, undefined),
			/enableGraphqlTool/,
		);
	});

	test('requires a query argument', async () => {
		await assert.rejects(runGraphqlTool({ tool: 'rewst_graphql', args: {} }, deps()), /requires a "query"/);
		await assert.rejects(
			runGraphqlTool({ tool: 'rewst_graphql', args: { query: '  ' } }, deps()),
			/requires a "query"/,
		);
	});

	test('rejects non-object variables', async () => {
		await assert.rejects(
			runGraphqlTool({ tool: 'rewst_graphql', args: { query: '{ user { id } }', variables: [1] } }, deps()),
			/must be a JSON object/,
		);
	});

	test('rejects subscriptions', async () => {
		await assert.rejects(
			runGraphqlTool({ tool: 'rewst_graphql', args: { query: 'subscription S { x }' } }, deps()),
			/does not support subscriptions/,
		);
	});

	test('runs queries without confirmation and passes variables through', async () => {
		let confirms = 0;
		const calls: { query: string; variables?: Record<string, unknown> }[] = [];
		const output = await runGraphqlTool(
			{
				tool: 'rewst_graphql',
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

	test('asks for confirmation before running a mutation', async () => {
		let confirmed = '';
		const output = await runGraphqlTool(
			{
				tool: 'rewst_graphql',
				args: { query: 'mutation U($id: ID!) { updateTemplate(id: $id) { id } }', variables: { id: 't-1' } },
			},
			deps({
				confirmMutation: async operation => {
					confirmed = operation;
					return true;
				},
			}),
		);
		assert.match(confirmed, /mutation U/);
		assert.match(confirmed, /"id": "t-1"/);
		assert.match(output, /"ok": true/);
	});

	test('does not run a declined mutation', async () => {
		let ran = false;
		await assert.rejects(
			runGraphqlTool(
				{ tool: 'rewst_graphql', args: { query: 'mutation D { deleteTemplate { id } }' } },
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
			{ tool: 'rewst_graphql', args: { query: '{ nope }' } },
			deps({ execute: async () => ({ data: null, errors: [{ message: 'Cannot query field "nope"' }] }) }),
		);
		assert.match(output, /Cannot query field/);
		assert.ok(!output.includes('"data"'));
	});

	test('truncates oversized responses', async () => {
		const output = await runGraphqlTool(
			{ tool: 'rewst_graphql', args: { query: '{ big }' } },
			deps({ execute: async () => ({ data: { big: 'x'.repeat(20_000) } }) }),
		);
		assert.ok(output.length < 9_000);
		assert.match(output, /output truncated/);
	});

	suite('rewst_graphql_schema', () => {
		test('lists root operation fields', async () => {
			const output = await runGraphqlTool(
				{ tool: 'rewst_graphql_schema', args: {} },
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
				{ tool: 'rewst_graphql_schema', args: { typeName: 'TemplateInput', includeDeprecated: true } },
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
				{ tool: 'rewst_graphql_schema', args: { search: 'template' } },
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
				runGraphqlTool({ tool: 'rewst_graphql_schema', args: { typeName: '', search: 'x' } }, deps()),
				/typeName/,
			);
			await assert.rejects(
				runGraphqlTool({ tool: 'rewst_graphql_schema', args: { typeName: 'A', search: 'B' } }, deps()),
				/either "typeName" or "search"/,
			);
		});
	});
});
