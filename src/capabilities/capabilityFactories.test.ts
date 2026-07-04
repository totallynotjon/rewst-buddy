import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import { readCapability, writeCapability } from './capabilityFactories';

const { suite, test, setup } = Mocha;

const SPEC: ToolSpecDefinition = {
	name: 'test_tool',
	description: 'A test tool.',
	// args is intentionally omitted — factories derive it from inputSchema via withGeneratedArgs
	inputSchema: {
		type: 'object',
		properties: {
			orgId: { type: 'string', description: 'The org id.' },
			query: { type: 'string', description: 'A search query.' },
		},
		required: ['orgId'],
	},
};

const noop = async (): Promise<string> => '';

suite('Unit: capabilityFactories', () => {
	setup(() => {
		initTestEnvironment();
	});

	suite('readCapability()', () => {
		test('sets access to "read"', () => {
			const cap = readCapability(SPEC, noop);
			assert.strictEqual(cap.access, 'read');
		});

		test('generates args from inputSchema', () => {
			const cap = readCapability(SPEC, noop);
			// withGeneratedArgs derives the args string from inputSchema — it should
			// include the property names declared in the schema.
			assert.ok(typeof cap.spec.args === 'string', 'args is a string');
			assert.ok(cap.spec.args.includes('orgId'), 'args includes orgId from inputSchema');
		});

		test('passes spec name and description through', () => {
			const cap = readCapability(SPEC, noop);
			assert.strictEqual(cap.spec.name, SPEC.name);
			assert.strictEqual(cap.spec.description, SPEC.description);
		});

		test('spreads opts onto the capability', () => {
			const cap = readCapability(SPEC, noop, { requiresOrg: false, scopedSessions: true });
			assert.strictEqual(cap.requiresOrg, false);
			assert.strictEqual(cap.scopedSessions, true);
		});

		test('defaults to no extra opts when none supplied', () => {
			const cap = readCapability(SPEC, noop);
			assert.strictEqual(cap.requiresOrg, undefined);
			assert.strictEqual(cap.scopedSessions, undefined);
			// dangerous is a write-only option; its absence here is enforced by the type system
		});

		test('wires the run function through', async () => {
			let called = false;
			const run = async (): Promise<string> => {
				called = true;
				return 'result';
			};
			const cap = readCapability(SPEC, run);
			const out = await cap.run({}, {} as never);
			assert.strictEqual(out, 'result');
			assert.ok(called);
		});
	});

	suite('writeCapability()', () => {
		test('sets access to "write"', () => {
			const cap = writeCapability(SPEC, noop);
			assert.strictEqual(cap.access, 'write');
		});

		test('generates args from inputSchema', () => {
			const cap = writeCapability(SPEC, noop);
			assert.ok(typeof cap.spec.args === 'string', 'args is a string');
			assert.ok(cap.spec.args.includes('orgId'), 'args includes orgId from inputSchema');
		});

		test('passes spec name and description through', () => {
			const cap = writeCapability(SPEC, noop);
			assert.strictEqual(cap.spec.name, SPEC.name);
			assert.strictEqual(cap.spec.description, SPEC.description);
		});

		test('spreads opts including dangerous and scopedSessions onto the capability', () => {
			const cap = writeCapability(SPEC, noop, { dangerous: true, requiresOrg: false, scopedSessions: true });
			assert.strictEqual(cap.dangerous, true);
			assert.strictEqual(cap.requiresOrg, false);
			assert.strictEqual(cap.scopedSessions, true);
		});

		test('defaults dangerous to undefined when not supplied', () => {
			const cap = writeCapability(SPEC, noop);
			assert.strictEqual(cap.dangerous, undefined);
		});

		test('wires the run function through', async () => {
			let called = false;
			const run = async (): Promise<string> => {
				called = true;
				return 'write-result';
			};
			const cap = writeCapability(SPEC, run);
			const out = await cap.run({}, {} as never);
			assert.strictEqual(out, 'write-result');
			assert.ok(called);
		});
	});
});
