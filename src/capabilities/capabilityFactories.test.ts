import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import { readCapability, writeCapability } from './capabilityFactories';

const { suite, test, setup } = Mocha;

const SPEC: ToolSpec = {
	name: 'test_tool',
	args: '', // overwritten by withGeneratedArgs inside the factories
	description: 'A test tool.',
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

		test('spreads opts onto the capability', () => {
			const cap = readCapability(SPEC, noop, { requiresOrg: false, scopedSessions: true });
			assert.strictEqual(cap.requiresOrg, false);
			assert.strictEqual(cap.scopedSessions, true);
		});

		test('defaults to no extra opts when none supplied', () => {
			const cap = readCapability(SPEC, noop);
			assert.strictEqual(cap.requiresOrg, undefined);
			assert.strictEqual(cap.scopedSessions, undefined);
			assert.strictEqual(cap.dangerous, undefined);
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

		test('spreads opts including dangerous onto the capability', () => {
			const cap = writeCapability(SPEC, noop, { dangerous: true, requiresOrg: false });
			assert.strictEqual(cap.dangerous, true);
			assert.strictEqual(cap.requiresOrg, false);
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
