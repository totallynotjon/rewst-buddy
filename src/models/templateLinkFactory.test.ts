import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import { buildTemplateLink, orgFromTemplate } from './templateLinkFactory';
import { getHash } from '../utils/getHash';
import { findAllTemplateReferences } from '../providers/templatePatternUtils';
import type { TemplateFragment } from '@sessions';

type TemplateStubOverrides = {
	id?: string;
	orgId?: string;
	name?: string;
	organization?: { id?: string | null; name?: string | null } | null;
};

// Minimal TemplateFragment-compatible stub — only the fields the factory reads.
// Cast via unknown to avoid spelling out every optional GraphQL field.
function makeTemplate(overrides: TemplateStubOverrides = {}): TemplateFragment & { orgId: string } {
	return {
		id: overrides.id ?? 'tmpl-1',
		name: overrides.name ?? 'My Template',
		orgId: overrides.orgId ?? 'org-1',
		contentType: 'text/plain',
		language: 'jinja',
		createdAt: '2024-01-01T00:00:00Z',
		updatedAt: '2024-01-01T00:00:00Z',
		organization: overrides.organization !== undefined
			? (overrides.organization as TemplateFragment['organization'])
			: null,
		tags: [],
	} as unknown as TemplateFragment & { orgId: string };
}

suite('Unit: orgFromTemplate()', () => {
	test('uses template.orgId when organization relation is absent', () => {
		const t = makeTemplate({ orgId: 'org-abc' });
		const org = orgFromTemplate(t);
		assert.strictEqual(org.id, 'org-abc');
		assert.strictEqual(org.name, 'org-abc'); // falls back to id as name
	});

	test('uses organization.id when present', () => {
		const t = makeTemplate({
			orgId: 'org-abc',
			organization: { id: 'org-xyz', name: 'Acme' },
		});
		const org = orgFromTemplate(t);
		assert.strictEqual(org.id, 'org-abc'); // orgId takes priority per nonEmptyString order
		assert.strictEqual(org.name, 'Acme');
	});

	test('falls back to organization.id when orgId is empty string', () => {
		const t = makeTemplate({
			orgId: '',
			organization: { id: 'org-xyz', name: 'Acme' },
		});
		const org = orgFromTemplate(t);
		assert.strictEqual(org.id, 'org-xyz');
		assert.strictEqual(org.name, 'Acme');
	});

	test('falls back to orgId when organization.id is null', () => {
		const t = makeTemplate({
			orgId: 'org-abc',
			organization: { id: null, name: 'Acme' },
		});
		const org = orgFromTemplate(t);
		assert.strictEqual(org.id, 'org-abc');
	});

	test('uses id as name when organization.name is absent', () => {
		const t = makeTemplate({
			orgId: 'org-abc',
			organization: { id: 'org-abc', name: null },
		});
		const org = orgFromTemplate(t);
		assert.strictEqual(org.name, 'org-abc');
	});
});

suite('Unit: buildTemplateLink()', () => {
	const BODY = '// hello world';
	const URI = 'file:///workspace/templates/hello.jinja';

	test('sets type to Template', () => {
		const link = buildTemplateLink(makeTemplate({}), BODY, URI);
		assert.strictEqual(link.type, 'Template');
	});

	test('stores the uriString verbatim', () => {
		const link = buildTemplateLink(makeTemplate({}), BODY, URI);
		assert.strictEqual(link.uriString, URI);
	});

	test('bodyHash matches getHash(body)', () => {
		const link = buildTemplateLink(makeTemplate({}), BODY, URI);
		assert.strictEqual(link.bodyHash, getHash(BODY));
	});

	test('bodyHash changes when body changes', () => {
		const link1 = buildTemplateLink(makeTemplate({}), 'body A', URI);
		const link2 = buildTemplateLink(makeTemplate({}), 'body B', URI);
		assert.notStrictEqual(link1.bodyHash, link2.bodyHash);
	});

	test('referencedTemplateIds matches findAllTemplateReferences(body)', () => {
		const body = '{{ RWT.render_template("tmpl-aaa") }} {{ RWT.render_template("tmpl-bbb") }}';
		const link = buildTemplateLink(makeTemplate({}), body, URI);
		assert.deepStrictEqual(
			link.referencedTemplateIds,
			findAllTemplateReferences(body),
		);
	});

	test('referencedTemplateIds is empty for a body with no references', () => {
		const link = buildTemplateLink(makeTemplate({}), BODY, URI);
		assert.deepStrictEqual(link.referencedTemplateIds, []);
	});

	test('org is derived from the template', () => {
		const t = makeTemplate({ orgId: 'org-42', organization: { id: 'org-42', name: 'TestOrg' } });
		const link = buildTemplateLink(t, BODY, URI);
		assert.strictEqual(link.org.id, 'org-42');
		assert.strictEqual(link.org.name, 'TestOrg');
	});
});
