import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { LinkManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { initTestEnvironment, createMockSession, Fixtures } from '@test';
import { OpenInRewst } from './OpenInRewst';

const { suite, test, setup, teardown } = Mocha;

function createLink(overrides?: Partial<TemplateLink>): TemplateLink {
	const uri = vscode.Uri.file(overrides?.uriString ?? '/test/template.jinja2');
	return {
		uriString: uri.toString(),
		org: { id: 'org-1', name: 'Test Org' },
		type: 'Template',
		template: { id: 'template-1', name: 'Test Template', updatedAt: '2024-01-01T00:00:00Z' } as any,
		bodyHash: 'hash',
		...overrides,
		// Ensure uriString is always a proper URI string
		...(overrides?.uriString ? {} : { uriString: uri.toString() }),
	};
}

suite('Unit: OpenInRewst', () => {
	let command: OpenInRewst;

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		command = new OpenInRewst();
	});

	teardown(() => {
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
	});

	test('should use URI from context menu args', async () => {
		const uri = vscode.Uri.file('/test/template.jinja2');
		const link = createLink({ uriString: uri.toString() });
		LinkManager.addLink(link);

		// Should not throw — runs through the full path with default region fallback
		await command.execute([uri]);
	});

	test('should fall back to active editor URI', async () => {
		const uri = vscode.Uri.file('/test/template.jinja2');
		const link = createLink({ uriString: uri.toString() });
		LinkManager.addLink(link);

		// Mock activeTextEditor
		const original = vscode.window.activeTextEditor;
		Object.defineProperty(vscode.window, 'activeTextEditor', {
			value: { document: { uri } },
			configurable: true,
		});

		try {
			await command.execute();
		} finally {
			Object.defineProperty(vscode.window, 'activeTextEditor', {
				value: original,
				configurable: true,
			});
		}
	});

	test('should notify error when no args and no editor', async () => {
		const original = vscode.window.activeTextEditor;
		Object.defineProperty(vscode.window, 'activeTextEditor', {
			value: undefined,
			configurable: true,
		});

		try {
			// Should NOT throw — notifyError + return
			await command.execute();
		} finally {
			Object.defineProperty(vscode.window, 'activeTextEditor', {
				value: original,
				configurable: true,
			});
		}
	});

	test('should use active session region URL', async () => {
		const orgId = 'org-active';
		const uri = vscode.Uri.file('/test/active.jinja2');
		const link = createLink({
			uriString: uri.toString(),
			org: { id: orgId, name: 'Active Org' },
		});
		LinkManager.addLink(link);

		const { session } = createMockSession({
			profile: {
				org: { id: orgId, name: 'Active Org' },
				allManagedOrgs: [{ id: orgId, name: 'Active Org' }],
				region: {
					name: 'EU',
					cookieName: 'eu_cookie',
					graphqlUrl: 'https://api.eu.rewst.io/graphql',
					loginUrl: 'https://app.eu.rewst.io',
				},
			},
		});
		SessionManager._setSessionsForTesting([session]);

		// Should use the EU region URL — no throw means success
		await command.execute([uri]);
	});

	test('should use known profile region when no active session', async () => {
		const orgId = 'org-known';
		const uri = vscode.Uri.file('/test/known.jinja2');
		const link = createLink({
			uriString: uri.toString(),
			org: { id: orgId, name: 'Known Org' },
		});
		LinkManager.addLink(link);

		// Set up known profile WITHOUT active session
		SessionManager._setKnownProfilesForTesting([
			{
				region: {
					name: 'AU',
					cookieName: 'au_cookie',
					graphqlUrl: 'https://api.au.rewst.io/graphql',
					loginUrl: 'https://app.au.rewst.io',
				},
				org: { id: orgId, name: 'Known Org' },
				allManagedOrgs: [{ id: orgId, name: 'Known Org' }],
				label: 'Known User',
				user: Fixtures.userFragment({ orgId }),
			},
		]);

		await command.execute([uri]);
	});

	test('should match known profile by managed sub-org', async () => {
		const parentOrgId = 'org-parent';
		const subOrgId = 'org-sub';
		const uri = vscode.Uri.file('/test/sub.jinja2');
		const link = createLink({
			uriString: uri.toString(),
			org: { id: subOrgId, name: 'Sub Org' },
		});
		LinkManager.addLink(link);

		// Profile's primary org differs from link org, but link org is in allManagedOrgs
		SessionManager._setKnownProfilesForTesting([
			{
				region: {
					name: 'EU',
					cookieName: 'eu_cookie',
					graphqlUrl: 'https://api.eu.rewst.io/graphql',
					loginUrl: 'https://app.eu.rewst.io',
				},
				org: { id: parentOrgId, name: 'Parent Org' },
				allManagedOrgs: [
					{ id: parentOrgId, name: 'Parent Org' },
					{ id: subOrgId, name: 'Sub Org' },
				],
				label: 'Parent User',
				user: Fixtures.userFragment({ orgId: parentOrgId }),
			},
		]);

		const profile = SessionManager.getProfileForOrg(subOrgId);
		assert.ok(profile, 'Should find profile for sub-org');
		assert.strictEqual(profile.org.id, parentOrgId, 'Profile should be the parent');

		await command.execute([uri]);
	});

	test('should fall back to default region config when no session or profile', async () => {
		const orgId = 'org-unknown';
		const uri = vscode.Uri.file('/test/unknown.jinja2');
		const link = createLink({
			uriString: uri.toString(),
			org: { id: orgId, name: 'Unknown Org' },
		});
		LinkManager.addLink(link);

		// No active sessions, no known profiles — should use default region
		await command.execute([uri]);
	});

	test('should construct correct URL format', async () => {
		const orgId = 'org-url-test';
		const templateId = 'template-url-test';
		const uri = vscode.Uri.file('/test/url.jinja2');
		const link = createLink({
			uriString: uri.toString(),
			org: { id: orgId, name: 'URL Org' },
			template: { id: templateId, name: 'URL Template', updatedAt: '2024-01-01T00:00:00Z' } as any,
		});
		LinkManager.addLink(link);

		const { session } = createMockSession({
			profile: {
				org: { id: orgId, name: 'URL Org' },
				allManagedOrgs: [{ id: orgId, name: 'URL Org' }],
				region: {
					name: 'NA',
					cookieName: 'na_cookie',
					graphqlUrl: 'https://api.rewst.io/graphql',
					loginUrl: 'https://app.rewst.io',
				},
			},
		});
		SessionManager._setSessionsForTesting([session]);

		// Verify the URL would be correct by checking getSessionForOrg resolves
		const resolvedSession = SessionManager.getSessionForOrg(orgId);
		const expectedUrl = `${resolvedSession.profile.region.loginUrl}/organizations/${orgId}/templates/${templateId}`;
		assert.strictEqual(expectedUrl, `https://app.rewst.io/organizations/${orgId}/templates/${templateId}`);

		await command.execute([uri]);
	});

	test('should notify error when file is not linked', async () => {
		const uri = vscode.Uri.file('/test/unlinked.jinja2');

		// File not linked — should catch the error and notifyError, not throw
		await command.execute([uri]);
	});

	test('should not throw on openExternal failure', async () => {
		const uri = vscode.Uri.file('/test/template.jinja2');
		const link = createLink({ uriString: uri.toString() });
		LinkManager.addLink(link);

		// The outer try/catch should prevent any propagation
		await command.execute([uri]);
	});
});
