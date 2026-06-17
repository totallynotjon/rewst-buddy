import * as assert from 'assert';
import fs from 'fs';
import * as Mocha from 'mocha';
import os from 'os';
import path from 'path';
import { readDiscovery, removeDiscovery, writeDiscovery, type McpDiscovery } from './discovery';

const { suite, test, setup, teardown } = Mocha;

const sample: McpDiscovery = {
	port: 27121,
	host: '127.0.0.1',
	token: 'deadbeef',
	pid: 4242,
	extensionVersion: '0.43.6',
	protocolVersion: 1,
	writtenAt: '2026-06-17T00:00:00.000Z',
};

suite('Unit: MCP discovery file', () => {
	let dir: string;
	let file: string;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewst-mcp-'));
		file = path.join(dir, 'mcp.json');
	});

	teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('write then read round-trips the discovery record', () => {
		writeDiscovery(sample, file);
		assert.deepStrictEqual(readDiscovery(file), sample);
	});

	test('the file is written with owner-only (0600) permissions', () => {
		writeDiscovery(sample, file);
		const mode = fs.statSync(file).mode & 0o777;
		assert.strictEqual(mode, 0o600);
	});

	test('reading a missing file returns undefined', () => {
		assert.strictEqual(readDiscovery(path.join(dir, 'absent.json')), undefined);
	});

	test('reading malformed or incomplete JSON returns undefined', () => {
		fs.writeFileSync(file, 'not json');
		assert.strictEqual(readDiscovery(file), undefined);
		fs.writeFileSync(file, JSON.stringify({ port: 1 }));
		assert.strictEqual(readDiscovery(file), undefined);
	});

	test('remove deletes the file and tolerates a missing one', () => {
		writeDiscovery(sample, file);
		removeDiscovery(file);
		assert.strictEqual(fs.existsSync(file), false);
		assert.doesNotThrow(() => removeDiscovery(file));
	});
});
