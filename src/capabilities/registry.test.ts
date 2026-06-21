import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import type { CapabilityGroup, CapabilitySettings } from './Capability';
import {
	CAPABILITY_REGISTRY,
	chatCapabilities,
	chatCapabilityNames,
	enabledMcpCapabilities,
	getCapability,
	hasChatCapability,
	mcpCapabilities,
} from './registry';
import {
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SEARCH_TOOL_NAME,
	WORKFLOW_TOOL_SPECS,
} from '../ui/chat/tools/workflowTools';
import { WORKSPACE_TOOL_SPECS } from '../ui/chat/tools/workspaceTools';

const { suite, test, setup } = Mocha;

const CAPABILITY_GROUPS: CapabilityGroup[] = ['workspace', 'workflow', 'graphql', 'result'];
const WORKSPACE_MCP_CAPABILITIES = WORKSPACE_TOOL_SPECS.map(spec => spec.name);
const WORKFLOW_MCP_CAPABILITIES = WORKFLOW_TOOL_SPECS.map(spec => spec.name);
const WORKFLOW_WRITE_MCP_CAPABILITIES = [
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
];

function settings(overrides: Partial<CapabilitySettings> = {}): CapabilitySettings {
	return {
		enableGraphqlTool: false,
		enableWorkflowTools: false,
		enableWorkspaceTools: false,
		...overrides,
	};
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

	test('buddy_graphql is retired from the registry surfaces', () => {
		assert.strictEqual(getCapability('buddy_graphql'), undefined);
	});

	suite('chat surface', () => {
		test('Rewst capabilities are not exposed on the VS Code chat LM surface', () => {
			assert.deepStrictEqual(chatCapabilities(), []);
		});
	});

	suite('tool-family groups', () => {
		test('every chat capability declares a group', () => {
			for (const capability of chatCapabilities()) {
				assert.ok(capability.group, `${capability.spec.name} has a group`);
			}
		});

		test('chatCapabilityNames returns no Rewst tool families', () => {
			for (const group of CAPABILITY_GROUPS) {
				assert.deepStrictEqual([...chatCapabilityNames(group)], [], `${group} has no chat names`);
			}
		});

		test('hasChatCapability never matches retired Rewst tool names', () => {
			assert.ok(!hasChatCapability('workflow', new Set(['buddy_workflow_edit'])));
			assert.ok(!hasChatCapability('graphql', new Set(['buddy_graphql_schema'])));
			assert.ok(!hasChatCapability('workflow', new Set(['buddy_graphql'])));
			assert.ok(!hasChatCapability('graphql', new Set(['read_file', 'unknown_tool'])));
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
				'list_template_links',
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

		test('all workflow helpers are exposed to MCP', () => {
			const names = new Set(mcpCapabilities().map(capability => capability.spec.name));
			for (const name of WORKFLOW_MCP_CAPABILITIES) {
				assert.ok(names.has(name), `${name} exposed to MCP`);
			}
		});

		test('workflow write helpers keep write access on MCP', () => {
			for (const name of WORKFLOW_WRITE_MCP_CAPABILITIES) {
				const capability = getCapability(name);
				assert.ok(capability, `${name} registered`);
				assert.strictEqual(capability.mcp, true, `${name} exposed to MCP`);
				assert.strictEqual(capability.access, 'write', `${name} remains write-gated`);
			}
		});

		test('promoted workflow helpers keep their existing org requirements', () => {
			for (const name of [WORKFLOW_SEARCH_TOOL_NAME, WORKFLOW_EXECUTION_LOGS_TOOL_NAME]) {
				assert.strictEqual(getCapability(name)?.requiresOrg, false, `${name} does not require org`);
			}
			for (const name of [
				'buddy_workflow_get',
				'buddy_action_search',
				'buddy_workflow_executions',
				'buddy_render_jinja',
			]) {
				assert.notStrictEqual(getCapability(name)?.requiresOrg, false, `${name} remains org-scoped`);
			}
		});

		test('workspace helpers are exposed to MCP and chat-only result reader is gone', () => {
			const names = new Set(mcpCapabilities().map(capability => capability.spec.name));
			for (const name of WORKSPACE_MCP_CAPABILITIES) {
				assert.ok(names.has(name), `${name} exposed to MCP`);
			}
			assert.ok(!names.has('buddy_result_read'), 'result reader stays off MCP');
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
