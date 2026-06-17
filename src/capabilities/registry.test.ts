import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { CapabilitySettings } from './Capability';
import {
	CAPABILITY_REGISTRY,
	chatCapabilities,
	enabledMcpCapabilities,
	getCapability,
	mcpCapabilities,
} from './registry';

const { suite, test } = Mocha;

function settings(overrides: Partial<CapabilitySettings> = {}): CapabilitySettings {
	return { enableGraphqlTool: false, ...overrides };
}

suite('Unit: capability registry', () => {
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
		const schema = getCapability('rewst_graphql_schema');
		assert.ok(schema, 'rewst_graphql_schema is registered');
		assert.strictEqual(schema.access, 'read');
		assert.strictEqual(getCapability('does_not_exist'), undefined);
	});

	test('rewst_graphql is a write capability (can mutate)', () => {
		const graphql = getCapability('rewst_graphql');
		assert.ok(graphql);
		assert.strictEqual(graphql.access, 'write');
	});

	suite('chat surface', () => {
		test('graphql tools are exposed on the chat surface', () => {
			const names = chatCapabilities().map(capability => capability.spec.name);
			assert.ok(names.includes('rewst_graphql_schema'));
			assert.ok(names.includes('rewst_graphql'));
		});

		test('chat graphql capabilities are gated by enableGraphqlTool', () => {
			for (const capability of chatCapabilities()) {
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
		test('read tools are exposed to MCP and are all read access', () => {
			const names = mcpCapabilities().map(capability => capability.spec.name);
			for (const expected of [
				'list_orgs',
				'list_templates',
				'get_template',
				'list_workflows',
				'get_workflow',
				'rewst_graphql_query',
			]) {
				assert.ok(names.includes(expected), `${expected} exposed to MCP`);
			}
			for (const capability of mcpCapabilities()) {
				assert.strictEqual(capability.access, 'read', `${capability.spec.name} is read-only`);
			}
		});

		test('the GraphQL chat tools are not exposed to MCP (writes stay in the chat surface)', () => {
			const names = mcpCapabilities().map(capability => capability.spec.name);
			assert.ok(!names.includes('rewst_graphql'));
			assert.ok(!names.includes('rewst_graphql_schema'));
		});

		test('list_orgs does not require an org', () => {
			const listOrgs = getCapability('list_orgs');
			assert.ok(listOrgs);
			assert.strictEqual(listOrgs.requiresOrg, false);
		});

		test('rewst_graphql_query is gated by enableGraphqlTool; structured reads are not', () => {
			const off = enabledMcpCapabilities(settings()).map(capability => capability.spec.name);
			assert.ok(!off.includes('rewst_graphql_query'), 'raw query off by default');
			assert.ok(off.includes('list_templates'), 'structured reads always available');
			const on = enabledMcpCapabilities(settings({ enableGraphqlTool: true })).map(
				capability => capability.spec.name,
			);
			assert.ok(on.includes('rewst_graphql_query'), 'raw query available when graphql enabled');
		});
	});
});
