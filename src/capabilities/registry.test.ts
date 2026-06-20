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
import { RESULT_READ_TOOL_SPECS } from '../ui/chat/tools/toolOutputCache';
import { WEB_TOOL_SPECS } from '../ui/chat/tools/webTools';
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

const GRAPHQL_CHAT_CAPABILITIES = ['buddy_graphql_schema', 'buddy_graphql'];
const WORKSPACE_CHAT_CAPABILITIES = WORKSPACE_TOOL_SPECS.map(spec => spec.name);
const WEB_CHAT_CAPABILITIES = WEB_TOOL_SPECS.map(spec => spec.name);
const WORKFLOW_CHAT_CAPABILITIES = WORKFLOW_TOOL_SPECS.map(spec => spec.name);
const WORKFLOW_READ_MCP_CAPABILITIES = [
	'buddy_workflow_get',
	WORKFLOW_SEARCH_TOOL_NAME,
	'buddy_action_search',
	'buddy_workflow_executions',
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	'buddy_render_jinja',
];
const WORKFLOW_WRITE_CHAT_CAPABILITIES = [
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
];
const RESULT_READ_CHAT_CAPABILITIES = RESULT_READ_TOOL_SPECS.map(spec => spec.name);
const CHAT_CAPABILITIES = [
	...WORKSPACE_CHAT_CAPABILITIES,
	...WEB_CHAT_CAPABILITIES,
	...WORKFLOW_CHAT_CAPABILITIES,
	...GRAPHQL_CHAT_CAPABILITIES,
	...RESULT_READ_CHAT_CAPABILITIES,
];

function settings(overrides: Partial<CapabilitySettings> = {}): CapabilitySettings {
	return {
		enableGraphqlTool: false,
		enableWorkflowTools: false,
		enableWebTools: false,
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

	test('buddy_graphql is a write capability (can mutate)', () => {
		const graphql = getCapability('buddy_graphql');
		assert.ok(graphql);
		assert.strictEqual(graphql.access, 'write');
	});

	suite('chat surface', () => {
		test('all VS Code chat tools are exposed on the chat surface', () => {
			const names = chatCapabilities().map(capability => capability.spec.name);
			assert.deepStrictEqual([...names].sort(), [...CHAT_CAPABILITIES].sort());
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

		test('chat-only categories are gated by their feature switches', () => {
			const byName = new Map(chatCapabilities().map(capability => [capability.spec.name, capability]));
			const cases: [string, string[], Partial<CapabilitySettings>][] = [
				['workspace', WORKSPACE_CHAT_CAPABILITIES, { enableWorkspaceTools: true }],
				['web', WEB_CHAT_CAPABILITIES, { enableWebTools: true }],
				['workflow', WORKFLOW_CHAT_CAPABILITIES, { enableWorkflowTools: true }],
			];

			for (const [label, names, on] of cases) {
				for (const name of names) {
					const capability = byName.get(name);
					assert.ok(capability, `${name} is registered`);
					assert.strictEqual(capability.enabled(settings()), false, `${name} off by default`);
					assert.strictEqual(capability.enabled(settings(on)), true, `${name} on when ${label} enabled`);
				}
			}
		});

		test('result reader is enabled when any chat tool category is enabled', () => {
			const byName = new Map(chatCapabilities().map(capability => [capability.spec.name, capability]));
			for (const name of RESULT_READ_CHAT_CAPABILITIES) {
				const capability = byName.get(name);
				assert.ok(capability, `${name} is registered`);
				assert.strictEqual(capability.enabled(settings()), false, `${name} off by default`);
				for (const on of [
					{ enableWorkspaceTools: true },
					{ enableWebTools: true },
					{ enableGraphqlTool: true },
					{ enableWorkflowTools: true },
				]) {
					assert.strictEqual(capability.enabled(settings(on)), true, `${name} on when any tools are enabled`);
				}
			}
		});
	});

	suite('tool-family groups', () => {
		test('every chat capability declares a group', () => {
			for (const capability of chatCapabilities()) {
				assert.ok(capability.group, `${capability.spec.name} has a group`);
			}
		});

		test('chatCapabilityNames returns the names in each family', () => {
			const expected: Record<CapabilityGroup, string[]> = {
				workspace: WORKSPACE_CHAT_CAPABILITIES,
				web: WEB_CHAT_CAPABILITIES,
				workflow: WORKFLOW_CHAT_CAPABILITIES,
				graphql: GRAPHQL_CHAT_CAPABILITIES,
				result: RESULT_READ_CHAT_CAPABILITIES,
			};
			for (const group of Object.keys(expected) as CapabilityGroup[]) {
				assert.deepStrictEqual(
					[...chatCapabilityNames(group)].sort(),
					[...expected[group]].sort(),
					`${group} family names`,
				);
			}
		});

		test('hasChatCapability matches only names in the family', () => {
			assert.ok(hasChatCapability('workflow', new Set(['buddy_workflow_edit'])));
			assert.ok(hasChatCapability('graphql', new Set(['buddy_graphql_schema'])));
			assert.ok(!hasChatCapability('workflow', new Set(['buddy_graphql'])));
			assert.ok(!hasChatCapability('graphql', new Set(['read_file', 'unknown_tool'])));
			assert.ok(!hasChatCapability('web', new Set<string>()));
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

		test('read-only workflow helpers are exposed to MCP', () => {
			const names = new Set(mcpCapabilities().map(capability => capability.spec.name));
			for (const name of WORKFLOW_READ_MCP_CAPABILITIES) {
				assert.ok(names.has(name), `${name} exposed to MCP`);
			}
		});

		test('workflow write helpers are not exposed to MCP', () => {
			const names = new Set(mcpCapabilities().map(capability => capability.spec.name));
			for (const name of WORKFLOW_WRITE_CHAT_CAPABILITIES) {
				assert.ok(!names.has(name), `${name} stays off MCP`);
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

		test('non-workflow chat-only tool categories are not exposed to MCP', () => {
			const names = new Set(mcpCapabilities().map(capability => capability.spec.name));
			for (const name of [
				...WORKSPACE_CHAT_CAPABILITIES,
				...WEB_CHAT_CAPABILITIES,
				...RESULT_READ_CHAT_CAPABILITIES,
			]) {
				assert.ok(!names.has(name), `${name} stays off MCP`);
			}
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
