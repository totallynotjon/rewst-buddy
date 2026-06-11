import * as assert from 'assert';
import * as Mocha from 'mocha';
import {
	conversationLabel,
	formatConversationTranscript,
	TRANSCRIPT_MESSAGE_CAP,
	type TranscriptMessage,
} from './conversationTranscript';

const { suite, test } = Mocha;

const user = (content: string): TranscriptMessage => ({ role: 'USER', content });
const assistant = (content: string): TranscriptMessage => ({ role: 'ASSISTANT', content });

suite('Unit: conversationTranscript', () => {
	suite('formatConversationTranscript()', () => {
		test('renders user and assistant turns with title', () => {
			const text = formatConversationTranscript('Jinja help', [
				user('how do I loop?'),
				assistant('Use {% for %}.'),
			]);
			assert.match(text, /^\*\*Resumed conversation: Jinja help\*\*/);
			assert.match(text, /\*\*You:\*\* how do I loop\?/);
			assert.match(text, /Use \{% for %\}\./);
			assert.match(text, /Follow-up questions in this chat continue this conversation/);
		});

		test('filters SYSTEM and TOOL messages', () => {
			const text = formatConversationTranscript(undefined, [
				{ role: 'SYSTEM', content: 'system prompt' },
				{ role: 'TOOL', content: 'tool output' },
				user('hi'),
			]);
			assert.ok(!text.includes('system prompt'));
			assert.ok(!text.includes('tool output'));
			assert.match(text, /\*\*You:\*\* hi/);
		});

		test('caps long conversations and notes the omission', () => {
			const messages = Array.from({ length: 30 }, (_, i) => user(`message ${i + 1}`));
			const text = formatConversationTranscript(undefined, messages);
			assert.match(text, new RegExp(`showing the last ${TRANSCRIPT_MESSAGE_CAP} of 30 messages`));
			assert.ok(!text.includes('message 1\n'), 'oldest messages should be dropped');
			assert.ok(text.includes('message 30'));
		});

		test('handles empty conversations', () => {
			assert.strictEqual(formatConversationTranscript(undefined, []), 'This conversation has no messages yet.');
		});
	});

	suite('conversationLabel()', () => {
		test('prefers title, then first message, then placeholder', () => {
			assert.strictEqual(conversationLabel('My chat', 'question'), 'My chat');
			assert.strictEqual(conversationLabel(null, 'question'), 'question');
			assert.strictEqual(conversationLabel(null, undefined), '(untitled conversation)');
		});

		test('collapses whitespace and truncates long labels', () => {
			assert.strictEqual(conversationLabel('line\none', undefined), 'line one');
			const long = 'x'.repeat(80);
			assert.strictEqual(conversationLabel(long, undefined).length, 58);
			assert.match(conversationLabel(long, undefined), /…$/);
		});
	});
});
