import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import type { CapabilitySettings } from './Capability';
import {
	CAPABILITY_REGISTRY,
	chatCapabilities,
	enabledMcpCapabilities,
	getCapability,
	mcpCapabilities,
} from './registry';

const { suite, test, setup } = Mocha;

const GRAPHQL_CHAT_CAPABILITIES = ['buddy_graphql_schema', 'buddy_graphql'];

function settings(overrides: Partial<CapabilitySettings> = {}): CapabilitySettings {
	return { enableGraphqlTool: false, ...overrides };
}

suite('Unit: capability registry', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	test('capability names are unique', () => {
		const names = CAPABILITY_REGISTRY.map(capability => capability.spec.name);
		assert.strictEqual(new Set(names).size, names.length, 'no duplicate capability names');
	});

	test('every capability declares an access level and an inputSchema', () => {
		for (const capability of CAPABILITY_REGISTRY) {
			assert.ok(['read', 'write'].includes(capability.access), `${capability.spec.name} access is read|write`);
			assert.ok(capability.spec.inputSchema, `${capability.spec.name} carries an inputSchema`);
		}
	});

	test('getCapability resolves by tool name', () => {
		const schema = getCapability('buddy_graphql_schema');
		assert.ok(schema, 'buddy_graphql_schema is registered');
		assert.strictEqual(schema.access, 'read');
		assert.strictEqual(getCapability('does_not_exist'), undefined);
	});

	test('buddy_graphql is a write capability (can mutate)', () => {
		const graphql = getCapability('buddy_graphql');
		assert.ok(graphql);
		assert.strictEqual(graphql.access, 'write');
	});

	suite('chat surface', () => {
		test('graphql tools are exposed on the chat surface', () => {
			const names = chatCapabilities().map(capability => capability.spec.name);
			assert.ok(names.includes('buddy_graphql_schema'));
			assert.ok(names.includes('buddy_graphql'));
		});

		test('chat graphql capabilities are gated by enableGraphqlTool', () => {
			const graphqlChatCapabilities = chatCapabilities().filter(capability =>
				GRAPHQL_CHAT_CAPABILITIES.includes(capability.spec.name),
			);
			for (const capability of graphqlChatCapabilities) {
				assert.strictEqual(capability.enabled(settings()), false, `${capability.spec.name} off by default`);
				assert.strictEqual(
					capability.enabled(settings({ enableGraphqlTool: true })),
					true,
					`${capability.spec.name} on when graphql enabled`,
				);
			}
		});
	});

	suite('mcp surface', () => {
		test('read tools and the dedicated mutation tool are exposed to MCP', () => {
			const names = mcpCapabilities().map(capability => capability.spec.name);
			for (const expected of [
				'list_orgs',
				'list_templates',
				'get_template',
				'list_workflows',
				'get_workflow',
				'rewst_graphql_query',
				'buddy_graphql_schema',
				'rewst_graphql_mutate',
			]) {
				assert.ok(names.includes(expected), `${expected} exposed to MCP`);
			}
			assert.strictEqual(getCapability('rewst_graphql_mutate')?.access, 'write');
			assert.ok(!names.includes('buddy_graphql'), 'combined chat write tool stays off MCP');
		});

		test('buddy_graphql_schema is also exposed to MCP, but buddy_graphql is not', () => {
			const names = mcpCapabilities().map(capability => capability.spec.name);
			assert.ok(!names.includes('buddy_graphql'));
			assert.ok(names.includes('buddy_graphql_schema'));
		});

		test('list_orgs does not require an org', () => {
			const listOrgs = getCapability('list_orgs');
			assert.ok(listOrgs);
			assert.strictEqual(listOrgs.requiresOrg, false);
		});

		test('buddy_graphql_schema does not require an org', () => {
			const schema = getCapability('buddy_graphql_schema');
			assert.ok(schema);
			assert.strictEqual(schema.requiresOrg, false);
		});

		test('raw GraphQL MCP tools are gated by enableGraphqlTool; structured reads are not', () => {
			const off = enabledMcpCapabilities(settings()).map(capability => capability.spec.name);
			assert.ok(!off.includes('rewst_graphql_query'), 'raw query off by default');
			assert.ok(!off.includes('buddy_graphql_schema'), 'schema off by default');
			assert.ok(!off.includes('rewst_graphql_mutate'), 'mutation off by default');
			assert.ok(off.includes('list_templates'), 'structured reads always available');
			const on = enabledMcpCapabilities(settings({ enableGraphqlTool: true })).map(
				capability => capability.spec.name,
			);
			assert.ok(on.includes('rewst_graphql_query'), 'raw query available when graphql enabled');
			assert.ok(on.includes('buddy_graphql_schema'), 'schema available when graphql enabled');
			assert.ok(on.includes('rewst_graphql_mutate'), 'mutation available when graphql enabled');
		});
	});
});
