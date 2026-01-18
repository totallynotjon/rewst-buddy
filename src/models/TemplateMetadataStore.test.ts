import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment, createMockSession, Fixtures } from '@test';
import { SessionManager } from '@sessions';
import { TemplateMetadataStore } from './TemplateMetadataStore';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: TemplateMetadataStore', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		TemplateMetadataStore.dispose();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		TemplateMetadataStore.dispose();
	});

	test('should load templates from a single session', async () => {
		// Create test org and templates
		const org1 = Fixtures.orgModel({ id: 'org-1', name: 'Test Org 1' });
		const templates = [
			Fixtures.template({ id: 'template-1', name: 'Template 1', orgId: org1.id }),
			Fixtures.template({ id: 'template-2', name: 'Template 2', orgId: org1.id }),
			Fixtures.template({ id: 'template-3', name: 'Template 3', orgId: org1.id }),
		];

		// Create mock session with templates
		const { session, wrapper } = createMockSession({
			profile: { org: org1, allManagedOrgs: [org1] },
		});

		wrapper.when('listTemplates', { data: Fixtures.listTemplatesQuery(templates) });

		// Set the session
		SessionManager._setSessionsForTesting([session]);

		// Initialize the store (this triggers loading)
		TemplateMetadataStore.init();

		// Wait for async loading to complete
		await new Promise(resolve => setTimeout(resolve, 100));

		// Verify templates were loaded
		assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 1);

		// Verify we can retrieve templates
		const meta1 = TemplateMetadataStore.getTemplateMetadata('template-1');
		assert.ok(meta1, 'Template 1 metadata should exist');
		assert.strictEqual(meta1?.template.name, 'Template 1');
		assert.strictEqual(meta1?.org.id, org1.id);

		const meta2 = TemplateMetadataStore.getTemplateMetadata('template-2');
		assert.ok(meta2, 'Template 2 metadata should exist');
		assert.strictEqual(meta2?.template.name, 'Template 2');
	});

	test('should load templates from multiple sessions with different orgs', async () => {
		// Create orgs and templates
		const org1 = Fixtures.orgModel({ id: 'org-1', name: 'Org 1' });
		const org2 = Fixtures.orgModel({ id: 'org-2', name: 'Org 2' });

		const org1Templates = [
			Fixtures.template({ id: 'template-1-1', name: 'Org 1 Template 1', orgId: org1.id }),
			Fixtures.template({ id: 'template-1-2', name: 'Org 1 Template 2', orgId: org1.id }),
		];

		const org2Templates = [Fixtures.template({ id: 'template-2-1', name: 'Org 2 Template 1', orgId: org2.id })];

		// Create two mock sessions
		const { session: session1, wrapper: wrapper1 } = createMockSession({
			profile: { org: org1, allManagedOrgs: [org1] },
		});
		wrapper1.when('listTemplates', { data: Fixtures.listTemplatesQuery(org1Templates) });

		const { session: session2, wrapper: wrapper2 } = createMockSession({
			profile: { org: org2, allManagedOrgs: [org2] },
		});
		wrapper2.when('listTemplates', { data: Fixtures.listTemplatesQuery(org2Templates) });

		// Set both sessions
		SessionManager._setSessionsForTesting([session1, session2]);

		// Initialize the store
		TemplateMetadataStore.init();

		// Wait for async loading
		await new Promise(resolve => setTimeout(resolve, 100));

		// Verify both sessions were queried
		assert.strictEqual(wrapper1.getCallsFor('listTemplates').length, 1);
		assert.strictEqual(wrapper2.getCallsFor('listTemplates').length, 1);

		// Verify all templates are available
		const meta1_1 = TemplateMetadataStore.getTemplateMetadata('template-1-1');
		assert.strictEqual(meta1_1?.template.name, 'Org 1 Template 1');
		assert.strictEqual(meta1_1?.org.id, org1.id);

		const meta1_2 = TemplateMetadataStore.getTemplateMetadata('template-1-2');
		assert.strictEqual(meta1_2?.template.name, 'Org 1 Template 2');

		const meta2_1 = TemplateMetadataStore.getTemplateMetadata('template-2-1');
		assert.strictEqual(meta2_1?.template.name, 'Org 2 Template 1');
		assert.strictEqual(meta2_1?.org.id, org2.id);
	});

	test('should handle sessions with multiple managed orgs', async () => {
		// Create multiple orgs
		const org1 = Fixtures.orgModel({ id: 'org-1', name: 'Primary Org' });
		const org2 = Fixtures.orgModel({ id: 'org-2', name: 'Managed Org 1' });
		const org3 = Fixtures.orgModel({ id: 'org-3', name: 'Managed Org 2' });

		const org1Templates = [Fixtures.template({ id: 't1', name: 'T1', orgId: org1.id })];
		const org2Templates = [Fixtures.template({ id: 't2', name: 'T2', orgId: org2.id })];
		const org3Templates = [Fixtures.template({ id: 't3', name: 'T3', orgId: org3.id })];

		// Create session that manages all three orgs
		const { session, wrapper } = createMockSession({
			profile: {
				org: org1,
				allManagedOrgs: [org1, org2, org3],
			},
		});

		// Configure wrapper to return different templates for each org
		wrapper.when('listTemplates', vars => {
			if (vars.orgId === org1.id) {
				return { data: Fixtures.listTemplatesQuery(org1Templates) };
			} else if (vars.orgId === org2.id) {
				return { data: Fixtures.listTemplatesQuery(org2Templates) };
			} else if (vars.orgId === org3.id) {
				return { data: Fixtures.listTemplatesQuery(org3Templates) };
			}
			return { data: Fixtures.listTemplatesQuery([]) };
		});

		SessionManager._setSessionsForTesting([session]);
		TemplateMetadataStore.init();

		// Wait for async loading
		await new Promise(resolve => setTimeout(resolve, 100));

		// Should have queried all three orgs
		assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 3);

		// Verify templates from all orgs are available
		assert.strictEqual(TemplateMetadataStore.getTemplateMetadata('t1')?.template.name, 'T1');
		assert.strictEqual(TemplateMetadataStore.getTemplateMetadata('t2')?.template.name, 'T2');
		assert.strictEqual(TemplateMetadataStore.getTemplateMetadata('t3')?.template.name, 'T3');
	});

	test('should clear all templates when sessions are cleared', async () => {
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });
		const templates = [Fixtures.template({ id: 'template-1', name: 'Template 1', orgId: org.id })];

		const { session, wrapper } = createMockSession({
			profile: { org, allManagedOrgs: [org] },
		});
		wrapper.when('listTemplates', { data: Fixtures.listTemplatesQuery(templates) });

		SessionManager._setSessionsForTesting([session]);
		TemplateMetadataStore.init();

		await new Promise(resolve => setTimeout(resolve, 100));

		// Verify template is loaded
		assert.ok(TemplateMetadataStore.getTemplateMetadata('template-1'), 'Template should be loaded');

		// Clear sessions
		SessionManager._resetForTesting();

		// Template should be cleared
		assert.strictEqual(
			TemplateMetadataStore.getTemplateMetadata('template-1'),
			undefined,
			'Template should be cleared',
		);
	});

	test('should handle SDK errors gracefully', async () => {
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });

		const { session, wrapper } = createMockSession({
			profile: { org, allManagedOrgs: [org] },
		});

		// Configure wrapper to return an error
		wrapper.when('listTemplates', {
			error: Fixtures.networkError('Failed to load templates'),
		});

		SessionManager._setSessionsForTesting([session]);
		TemplateMetadataStore.init();

		await new Promise(resolve => setTimeout(resolve, 100));

		// Should have attempted to call listTemplates
		assert.strictEqual(wrapper.getCallsFor('listTemplates').length, 1);

		// But no templates should be loaded (error was handled gracefully)
		assert.strictEqual(
			TemplateMetadataStore.getTemplateMetadata('any-id'),
			undefined,
			'No templates should be loaded after error',
		);
	});
});
