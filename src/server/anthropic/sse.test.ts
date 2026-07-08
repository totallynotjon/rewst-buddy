import * as assert from 'assert';
import { suite, test } from '../../test/tdd';
import { sseEvent } from './sse';

suite('Unit: Anthropic SSE', () => {
	test('frames one event', () => {
		const result = sseEvent('message_stop', { type: 'message_stop' });
		assert.strictEqual(result, 'event: message_stop\ndata: {"type":"message_stop"}\n\n');
	});

	test('frames an event with complex data', () => {
		const data = { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
		const result = sseEvent('content_block_start', data);
		assert.strictEqual(result, `event: content_block_start\ndata: ${JSON.stringify(data)}\n\n`);
	});
});
