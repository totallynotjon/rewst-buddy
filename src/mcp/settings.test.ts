import type { Restore } from '@test';
import { initTestEnvironment, stub } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { readMcpSettings } from './settings';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: readMcpSettings()', () => {
	const restores: Restore[] = [];

	setup(() => {
		initTestEnvironment();
	});

	teardown(() => {
		while (restores.length) restores.pop()!();
	});

	function configure(values: Record<string, unknown>): string[] {
		const reads: string[] = [];
		restores.push(
			stub(vscode.workspace, 'getConfiguration', ((section: string) => {
				assert.strictEqual(section, 'rewst-buddy.mcp');
				return {
					get: (key: string, fallback: unknown) => {
						reads.push(key);
						return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
					},
				};
			}) as unknown as typeof vscode.workspace.getConfiguration),
		);
		return reads;
	}

	test('uses the secure defaults when no settings are present', () => {
		configure({});
		assert.deepStrictEqual(readMcpSettings(), {
			enable: false,
			enableWriteTools: false,
			enableDangerousGraphqlMutation: false,
			alwaysAllowedOrgs: [],
			workingOrgScope: 'strict',
		});
	});

	test('reads all independent feature gates without coupling dangerous mutations to writes', () => {
		configure({
			enable: true,
			enableWriteTools: false,
			enableDangerousGraphqlMutation: true,
			alwaysAllowedOrgs: ['org-1'],
			workingOrgScope: 'writes',
		});

		assert.deepStrictEqual(readMcpSettings(), {
			enable: true,
			enableWriteTools: false,
			enableDangerousGraphqlMutation: true,
			alwaysAllowedOrgs: ['org-1'],
			workingOrgScope: 'writes',
		});
	});

	test('trims org ids and discards empty or non-string allowlist entries', () => {
		configure({ alwaysAllowedOrgs: [' org-1 ', '', '  ', null, 7, 'org-2\n'] });
		assert.deepStrictEqual(readMcpSettings().alwaysAllowedOrgs, ['org-1', 'org-2']);
	});

	test('treats malformed non-array allowlists as empty', () => {
		for (const malformed of ['org-1', { org: 'org-1' }, null, 7]) {
			while (restores.length) restores.pop()!();
			configure({ alwaysAllowedOrgs: malformed });
			assert.deepStrictEqual(readMcpSettings().alwaysAllowedOrgs, [], JSON.stringify(malformed));
		}
	});

	test('falls back to the legacy writeOrgAllowlist when the renamed key is absent', () => {
		const reads = configure({ writeOrgAllowlist: [' legacy-org '] });
		assert.deepStrictEqual(readMcpSettings().alwaysAllowedOrgs, ['legacy-org']);
		assert.ok(reads.indexOf('alwaysAllowedOrgs') < reads.indexOf('writeOrgAllowlist'));
	});

	test('an explicit empty renamed allowlist overrides legacy values', () => {
		configure({ alwaysAllowedOrgs: [], writeOrgAllowlist: ['legacy-org'] });
		assert.deepStrictEqual(readMcpSettings().alwaysAllowedOrgs, []);
	});

	test('defaults unknown, malformed, and future working-scope values to strict', () => {
		for (const malformed of ['STRICT', 'read', '', null, true, 1]) {
			while (restores.length) restores.pop()!();
			configure({ workingOrgScope: malformed });
			assert.strictEqual(readMcpSettings().workingOrgScope, 'strict', JSON.stringify(malformed));
		}
	});
});
