import * as assert from 'assert';
import * as Mocha from 'mocha';
import { findTemplateAtPosition, TEMPLATE_PATTERN } from './templatePatternUtils';

const { suite, test } = Mocha;

suite('Unit: TEMPLATE_PATTERN', () => {
	test('should match valid template() calls with double quotes', () => {
		const line = 'template("550e8400-e29b-41d4-a716-446655440000")';
		TEMPLATE_PATTERN.lastIndex = 0;
		const match = TEMPLATE_PATTERN.exec(line);
		assert.ok(match);
		assert.strictEqual(match[1], '550e8400-e29b-41d4-a716-446655440000');
	});

	test('should match valid template() calls with single quotes', () => {
		const line = "template('550e8400-e29b-41d4-a716-446655440000')";
		TEMPLATE_PATTERN.lastIndex = 0;
		const match = TEMPLATE_PATTERN.exec(line);
		assert.ok(match);
		assert.strictEqual(match[1], '550e8400-e29b-41d4-a716-446655440000');
	});

	test('should match with spaces after template', () => {
		const line = 'template  (  "550e8400-e29b-41d4-a716-446655440000"  )';
		TEMPLATE_PATTERN.lastIndex = 0;
		const match = TEMPLATE_PATTERN.exec(line);
		assert.ok(match);
		assert.strictEqual(match[1], '550e8400-e29b-41d4-a716-446655440000');
	});

	test('should match multiple templates in a line', () => {
		const line =
			'template("11111111-1111-1111-1111-111111111111") + template("22222222-2222-2222-2222-222222222222")';
		TEMPLATE_PATTERN.lastIndex = 0;
		const matches: string[] = [];
		let match: RegExpExecArray | null;
		while ((match = TEMPLATE_PATTERN.exec(line)) !== null) {
			matches.push(match[1]);
		}
		assert.strictEqual(matches.length, 2);
		assert.strictEqual(matches[0], '11111111-1111-1111-1111-111111111111');
		assert.strictEqual(matches[1], '22222222-2222-2222-2222-222222222222');
	});

	test('should not match invalid UUIDs', () => {
		const line = 'template("not-a-valid-uuid")';
		TEMPLATE_PATTERN.lastIndex = 0;
		const match = TEMPLATE_PATTERN.exec(line);
		assert.strictEqual(match, null);
	});

	test('should match case-insensitive UUIDs', () => {
		const line = 'template("550E8400-E29B-41D4-A716-446655440000")';
		TEMPLATE_PATTERN.lastIndex = 0;
		const match = TEMPLATE_PATTERN.exec(line);
		assert.ok(match);
	});
});

suite('Unit: findTemplateAtPosition()', () => {
	const templateId = '550e8400-e29b-41d4-a716-446655440000';
	const line = `some text template("${templateId}") more text`;

	test('should find template when cursor is at start of template()', () => {
		const result = findTemplateAtPosition(line, 10); // "t" in "template"
		assert.ok(result);
		assert.strictEqual(result.templateId, templateId);
	});

	test('should find template when cursor is in the UUID', () => {
		const result = findTemplateAtPosition(line, 25); // Inside the UUID
		assert.ok(result);
		assert.strictEqual(result.templateId, templateId);
	});

	test('should find template when cursor is at closing paren', () => {
		const result = findTemplateAtPosition(line, 56); // At the ")"
		assert.ok(result);
		assert.strictEqual(result.templateId, templateId);
	});

	test('should return null when cursor is before template()', () => {
		const result = findTemplateAtPosition(line, 5); // In "some text"
		assert.strictEqual(result, null);
	});

	test('should return null when cursor is after template()', () => {
		const result = findTemplateAtPosition(line, 65); // In "more text"
		assert.strictEqual(result, null);
	});

	test('should return null for line without template()', () => {
		const result = findTemplateAtPosition('no template here', 5);
		assert.strictEqual(result, null);
	});

	test('should return correct match for multiple templates', () => {
		const multiLine =
			'template("11111111-1111-1111-1111-111111111111") template("22222222-2222-2222-2222-222222222222")';

		// Test first template (position 20 is inside first template)
		const result1 = findTemplateAtPosition(multiLine, 20);
		assert.ok(result1);
		assert.strictEqual(result1.templateId, '11111111-1111-1111-1111-111111111111');

		// Test second template (position 70 is inside second template)
		const result2 = findTemplateAtPosition(multiLine, 70);
		assert.ok(result2);
		assert.strictEqual(result2.templateId, '22222222-2222-2222-2222-222222222222');
	});
});
