import * as assert from 'assert';
import * as Mocha from 'mocha';
import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import type { CapabilityGroup } from './Capability';
import {
	CAPABILITY_REGISTRY,
	chatCapabilities,
	chatCapabilityNames,
	getCapability,
	hasChatCapability,
	mcpCapabilities,
} from './registry';
import { RESULT_READ_TOOL_NAME } from './resultReadCapability';
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

suite('Unit: capability registry', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	test('capability names are unique', () => {
		const names = CAPABILITY_REGISTRY.map(capability => capability.spec.name);
		assert.strictEqual(new Set(names).size, names.length, 'no duplicate capability names');
	});

	test('every Rewst Buddy capability uses the buddy_ tool-name prefix', () => {
		for (const capability of CAPABILITY_REGISTRY) {
			assert.ok(capability.spec.name.startsWith('buddy_'), `${capability.spec.name} starts with buddy_`);
		}
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
				'buddy_list_orgs',
				'buddy_list_templates',
				'buddy_get_template',
				'buddy_list_workflows',
				'buddy_get_workflow',
				'buddy_graphql_query',
				'buddy_search_template_links',
				'buddy_template_link_status',
				'buddy_graphql_schema',
				'buddy_graphql_mutate',
				RESULT_READ_TOOL_NAME,
			]) {
				assert.ok(names.includes(expected), `${expected} exposed to MCP`);
			}
			assert.strictEqual(getCapability('buddy_graphql_mutate')?.access, 'write');
			assert.strictEqual(getCapability('buddy_graphql_mutate')?.dangerous, true);
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
				const capability = getCapability(name);
				assert.ok(capability, `${name} is registered`);
				assert.notStrictEqual(capability.requiresOrg, false, `${name} remains org-scoped`);
			}
		});

		test('workspace helpers and the Buddy result reader are exposed to MCP', () => {
			const names = new Set(mcpCapabilities().map(capability => capability.spec.name));
			for (const name of WORKSPACE_MCP_CAPABILITIES) {
				assert.ok(names.has(name), `${name} exposed to MCP`);
			}
			assert.ok(names.has(RESULT_READ_TOOL_NAME), 'MCP result reader is Buddy-prefixed and exposed');
		});

		test('buddy_list_orgs does not require an org', () => {
			const listOrgs = getCapability('buddy_list_orgs');
			assert.ok(listOrgs);
			assert.strictEqual(listOrgs.requiresOrg, false);
		});

		test('buddy_graphql_schema does not require an org', () => {
			const schema = getCapability('buddy_graphql_schema');
			assert.ok(schema);
			assert.strictEqual(schema.requiresOrg, false);
		});

		test('MCP surface includes every mcp capability without intrinsic family filtering', () => {
			const registryNames = CAPABILITY_REGISTRY.filter(capability => capability.mcp).map(
				capability => capability.spec.name,
			);
			const surfaceNames = mcpCapabilities().map(capability => capability.spec.name);
			assert.deepStrictEqual(surfaceNames, registryNames);
		});
	});
});
