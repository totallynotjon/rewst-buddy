import * as assert from 'assert';
import * as Mocha from 'mocha';
import { ChunkGate } from './chunkGate';
import { TOOL_FENCE_MARKER, TOOL_FENCE_TAG } from './toolProtocol';

const { suite, test } = Mocha;

function drive(gate: ChunkGate, chunks: string[]): string {
	return chunks.map(chunk => gate.push(chunk)).join('');
}

suite('Unit: ChunkGate', () => {
	test('passes ordinary text through, releasing the tail on flush', () => {
		const gate = new ChunkGate();
		const streamed = drive(gate, ['Hello ', 'world. Use `template()`', ' here.']);
		const all = streamed + gate.flush();
		assert.strictEqual(all, 'Hello world. Use `template()` here.');
		assert.strictEqual(gate.blocked, false);
		assert.ok(gate.streamedAny);
	});

	test('suppresses everything from the tool fence onward', () => {
		const gate = new ChunkGate();
		const streamed = drive(gate, [
			'Let me check.\n',
			TOOL_FENCE_MARKER + '\n{"tool":"list_files"}\n```',
			' trailing',
		]);
		assert.strictEqual(streamed, 'Let me check.\n');
		assert.strictEqual(gate.blocked, true);
		assert.strictEqual(gate.flush(), '');
	});

	test('detects a fence marker split across chunks', () => {
		const gate = new ChunkGate();
		// Marker arrives in pieces: the backtick run splits, then the tag splits mid-token.
		const streamed = drive(gate, [
			'Prose ',
			'``',
			'`' + TOOL_FENCE_TAG.slice(0, 4),
			TOOL_FENCE_TAG.slice(4) + '\n{"tool":"x"}',
		]);
		assert.strictEqual(streamed, 'Prose ');
		assert.strictEqual(gate.blocked, true);
	});

	test('releases held-back backticks that turn out not to be a fence', () => {
		const gate = new ChunkGate();
		const streamed = drive(gate, ['Run ', '``', '`bash\nls\n``', '` now']);
		assert.strictEqual(streamed + gate.flush(), 'Run ```bash\nls\n``` now');
		assert.strictEqual(gate.blocked, false);
	});

	test('reports streamedAny false when nothing visible was released', () => {
		const gate = new ChunkGate();
		gate.push(TOOL_FENCE_MARKER);
		assert.strictEqual(gate.streamedAny, false);
		assert.strictEqual(gate.blocked, true);
	});
});
