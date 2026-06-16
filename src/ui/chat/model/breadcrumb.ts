import vscode from 'vscode';

/**
 * A hidden continuity breadcrumb embedded in each assistant turn we stream.
 *
 * VS Code echoes assistant messages back in the next request, so a marker in our
 * own output lets us recover the exact backend conversation a chat belongs to —
 * surviving the two weaknesses of the spine hash: it carries the per-chat
 * conversationId verbatim (so two same-org chats with byte-identical user spines
 * don't collide), and it stays in the transcript even if the in-memory map
 * evicts the key.
 *
 * The payload (conversationId, user-turn DEPTH, and the spine hash the next turn
 * will compute as its prefix) is encoded entirely in ZERO-WIDTH characters, so it
 * never renders in the chat — VS Code escapes raw HTML, so an HTML comment would
 * show as literal text. If VS Code ever strips the zero-width run, the breadcrumb
 * simply no-ops and the spine-hash backbone (conversationMap.ts) still carries
 * continuity.
 *
 * Recovery trusts a breadcrumb only when BOTH the current prefix hash matches the
 * embedded hash (no earlier message was edited) AND the depth still passes the
 * map's tip guard (the transcript was not rewound) — so a stale breadcrumb can
 * never re-attach to a rolled-back conversation.
 */

type RequestMessage = Pick<vscode.LanguageModelChatRequestMessage, 'role' | 'content'>;

export interface Breadcrumb {
	conversationId: string;
	depth: number;
	/** The spine hash (conversationMap.nextTurnKey) captured when this turn was emitted. */
	spineHash: string;
}

// Invisible code points (written as escapes so the source stays reviewable):
// two for bits, one to fence the run. All zero-width, so the run never renders.
const BIT_0 = String.fromCharCode(0x200b); // ZERO WIDTH SPACE
const BIT_1 = String.fromCharCode(0x200c); // ZERO WIDTH NON-JOINER
const FENCE = String.fromCharCode(0x2060); // WORD JOINER — brackets our encoded run
// Unit separator: splits payload fields without colliding with ids/hashes.
const FIELD_SEP = String.fromCharCode(0x1f);

// The payload is ASCII by construction (a Rewst conversation id, a digit depth,
// a hex spine hash, and the 0x1F separator), so 8 bits per char is sufficient.
// A code point above 0xFF would corrupt the run, but recovery re-validates the
// decoded spine hash against the current prefix, so a corrupt breadcrumb is
// simply ignored and the spine-hash backbone takes over.
function encode(payload: string): string {
	let bits = '';
	for (let i = 0; i < payload.length; i++) {
		bits += (payload.charCodeAt(i) & 0xff).toString(2).padStart(8, '0');
	}
	let run = FENCE;
	for (const bit of bits) run += bit === '1' ? BIT_1 : BIT_0;
	return run + FENCE;
}

function decodeLast(text: string): string | undefined {
	const end = text.lastIndexOf(FENCE);
	if (end <= 0) return undefined;
	const start = text.lastIndexOf(FENCE, end - 1);
	if (start === -1) return undefined;
	let bits = '';
	for (const ch of text.slice(start + 1, end)) {
		if (ch === BIT_0) bits += '0';
		else if (ch === BIT_1) bits += '1';
	}
	if (bits.length < 8) return undefined;
	let out = '';
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		out += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
	}
	return out;
}

/** The invisible marker to append to an assistant turn. */
export function formatBreadcrumb(conversationId: string, depth: number, spineHash: string): string {
	return encode([conversationId, String(depth), spineHash].join(FIELD_SEP));
}

function textOf(content: readonly unknown[]): string {
	let out = '';
	for (const part of content) {
		if (typeof part === 'string') out += part;
		else if (typeof (part as { value?: unknown })?.value === 'string') out += (part as { value: string }).value;
	}
	return out;
}

/**
 * The newest breadcrumb in the transcript, scanning assistant messages from the
 * end. Undefined when none is present (a fresh chat, or VS Code stripped it).
 */
export function parseLatestBreadcrumb(messages: readonly RequestMessage[]): Breadcrumb | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) continue;
		const decoded = decodeLast(textOf(message.content));
		if (decoded === undefined) continue;
		const [conversationId, depth, spineHash] = decoded.split(FIELD_SEP);
		if (!conversationId || !spineHash || !/^\d+$/.test(depth ?? '')) continue;
		return { conversationId, depth: Number(depth), spineHash };
	}
	return undefined;
}
