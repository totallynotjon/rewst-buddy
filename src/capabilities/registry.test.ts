import { SessionManager } from '@sessions';
import { initTestEnvironment } from '@test';
import {
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_DIAGNOSE_TOOL_NAME,
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SEARCH_TOOL_NAME,
	WORKFLOW_TOOL_SPECS,
} from '@workflow';
import * as assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import * as Mocha from 'mocha';
import { join } from 'path';
import { WORKSPACE_TOOL_SPECS } from '../ui/chat/tools/workspaceTools';
import { CAPABILITY_REGISTRY, getCapability, mcpCapabilities } from './registry';
import { RESULT_READ_TOOL_NAME } from './resultReadCapability';

const { suite, test, setup } = Mocha;

const WORKSPACE_MCP_CAPABILITIES = WORKSPACE_TOOL_SPECS.map(spec => spec.name);
const WORKFLOW_MCP_CAPABILITIES = WORKFLOW_TOOL_SPECS.map(spec => spec.name);
const WORKFLOW_WRITE_MCP_CAPABILITIES = [
	WORKFLOW_EDIT_TOOL_NAME,
	WORKFLOW_AUTOLAYOUT_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
];
const CAPABILITIES_DIR = join(process.cwd(), 'src/capabilities');

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

	test('capability args are generated from inputSchema', () => {
		for (const capability of CAPABILITY_REGISTRY) {
			assert.strictEqual(
				capability.spec.args,
				JSON.stringify(capability.spec.inputSchema ?? {}),
				`${capability.spec.name} args mirror inputSchema`,
			);
		}
	});

	test('capability modules use read/write factories instead of raw access literals', () => {
		const offenders = readdirSync(CAPABILITIES_DIR)
			.filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
			.filter(file => {
				const source = readFileSync(join(CAPABILITIES_DIR, file), 'utf8');
				return /^\s*access:\s*['"](read|write)['"]/m.test(source);
			});

		assert.deepStrictEqual(offenders, [], 'capability definitions should use readCapability/writeCapability');
	});

	test('capability modules import workflow definitions from @workflow, not the UI adapter', () => {
		const offenders = readdirSync(CAPABILITIES_DIR)
			.filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
			.filter(file => {
				const source = readFileSync(join(CAPABILITIES_DIR, file), 'utf8');
				return /ui\/chat\/tools\/workflowTools|\.\/workflowTools/.test(source);
			});

		assert.deepStrictEqual(offenders, [], 'capabilities should depend on @workflow instead of UI workflowTools');
	});

	test('tool output bounding is centralized at the MCP/Buddy boundary, not identity formatters', () => {
		const workflowTypes = readFileSync(join(process.cwd(), 'src/workflow/types.ts'), 'utf8');
		const graphqlTool = readFileSync(join(process.cwd(), 'src/ui/chat/tools/graphqlTool.ts'), 'utf8');
		const mcpActions = readFileSync(join(process.cwd(), 'src/mcp/McpActions.ts'), 'utf8');

		assert.doesNotMatch(workflowTypes, /function formatWorkflowOutput/);
		assert.doesNotMatch(graphqlTool, /function formatResultText/);
		assert.match(mcpActions, /formatMcpOutput\(params\.name, text\)/);
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
			const names = new Set(mcpCapabilities().map(capability => capability.spec.name));
			for (const name of WORKFLOW_WRITE_MCP_CAPABILITIES) {
				const capability = getCapability(name);
				assert.ok(capability, `${name} registered`);
				assert.ok(names.has(name), `${name} exposed to MCP`);
				assert.strictEqual(capability.access, 'write', `${name} remains write-gated`);
			}
		});

		test('promoted workflow helpers keep their existing org requirements', () => {
			for (const name of [
				WORKFLOW_SEARCH_TOOL_NAME,
				WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
				WORKFLOW_DIAGNOSE_TOOL_NAME,
			]) {
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

		test('buddy_search_template_links does not require an org', () => {
			const searchLinks = getCapability('buddy_search_template_links');
			assert.ok(searchLinks, 'buddy_search_template_links is registered');
			assert.strictEqual(
				searchLinks.requiresOrg,
				false,
				'link discovery spans all orgs, so it stays org-agnostic',
			);
		});

		test('MCP surface exposes the whole registry without intrinsic family filtering', () => {
			const registryNames = CAPABILITY_REGISTRY.map(capability => capability.spec.name);
			const surfaceNames = mcpCapabilities().map(capability => capability.spec.name);
			assert.deepStrictEqual(surfaceNames, registryNames);
		});
	});
});
