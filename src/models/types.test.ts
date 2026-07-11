import * as assert from 'assert';
import * as Mocha from 'mocha';
import { nonEmptyString, orgForTemplateLink, type TemplateLink } from './types';

const { suite, test } = Mocha;

function link(template: Record<string, unknown>, org = { id: 'parent', name: 'Parent Org' }): TemplateLink {
	return {
		type: 'Template',
		uriString: 'file:///template.jinja',
		org,
		bodyHash: 'hash',
		template: { id: 'template-1', name: 'Template', ...template } as TemplateLink['template'],
	};
}

suite('Unit: model ownership helpers', () => {
	suite('nonEmptyString()', () => {
		test('accepts non-empty strings without rewriting them', () => {
			assert.strictEqual(nonEmptyString(' value '), ' value ');
		});

		test('rejects empty, whitespace-only, and non-string values', () => {
			for (const value of ['', '  \n\t ', null, undefined, 0, false, [], {}]) {
				assert.strictEqual(nonEmptyString(value), undefined);
			}
		});
	});

	suite('orgForTemplateLink()', () => {
		test('prefers the template owner over a stale parent org stored on the link', () => {
			assert.deepStrictEqual(
				orgForTemplateLink(link({ orgId: 'child', organization: { id: 'child', name: 'Child Org' } })),
				{ id: 'child', name: 'Child Org' },
			);
		});

		test('uses organization.id when the direct template orgId is absent', () => {
			assert.deepStrictEqual(orgForTemplateLink(link({ organization: { id: 'child', name: 'Child Org' } })), {
				id: 'child',
				name: 'Child Org',
			});
		});

		test('prefers a direct template orgId when organization metadata disagrees', () => {
			assert.deepStrictEqual(
				orgForTemplateLink(link({ orgId: 'direct', organization: { id: 'nested', name: 'Direct Org' } })),
				{ id: 'direct', name: 'Direct Org' },
			);
		});

		test('retains the known link name when owner ids agree but template name metadata is absent', () => {
			const knownOrg = { id: 'parent', name: 'Known Name' };
			assert.strictEqual(orgForTemplateLink(link({ orgId: 'parent' }, knownOrg)), knownOrg);
		});

		test('falls back to the owner id as its display name when no trusted name exists', () => {
			assert.deepStrictEqual(orgForTemplateLink(link({ orgId: 'child' })), { id: 'child', name: 'child' });
		});

		test('falls back to the original link org when owner metadata is empty or whitespace', () => {
			const original = { id: 'parent', name: 'Parent Org' };
			assert.strictEqual(
				orgForTemplateLink(link({ orgId: '  ', organization: { id: '', name: 'Ignored' } }, original)),
				original,
			);
		});
	});
});
