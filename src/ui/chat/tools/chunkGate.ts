import { TOOL_FENCE_MARKER } from './toolProtocol';

/**
 * Gates streamed answer chunks so vscode-tool request JSON never renders in
 * the chat. Chunks flow through nearly live, but the gate holds back any
 * trailing text that could be the start of a ```vscode-tool fence; once the
 * full marker appears, everything from the fence onward is suppressed.
 */
export class ChunkGate {
	private pending = '';
	private blockedAt = -1;
	private flushedAny = false;

	constructor(private readonly marker: string = TOOL_FENCE_MARKER) {}

	/** True once a tool fence has been detected; later chunks are suppressed. */
	get blocked(): boolean {
		return this.blockedAt >= 0;
	}

	/** True if any visible text has been released. */
	get streamedAny(): boolean {
		return this.flushedAny;
	}

	/** Accepts a streamed chunk and returns the portion safe to display. */
	push(text: string): string {
		if (this.blocked) return '';
		this.pending += text;

		const markerIndex = this.pending.indexOf(this.marker);
		if (markerIndex >= 0) {
			this.blockedAt = markerIndex;
			return this.release(this.pending.slice(0, markerIndex));
		}

		const holdback = this.partialMarkerSuffixLength();
		const flushable = this.pending.slice(0, this.pending.length - holdback);
		this.pending = this.pending.slice(this.pending.length - holdback);
		return this.release(flushable);
	}

	/** Releases held-back text once the answer is known to be final. */
	flush(): string {
		if (this.blocked) return '';
		const rest = this.pending;
		this.pending = '';
		return this.release(rest);
	}

	private release(text: string): string {
		if (text.length > 0) this.flushedAny = true;
		return text;
	}

	/** Length of the longest pending-suffix that is a prefix of the marker. */
	private partialMarkerSuffixLength(): number {
		const max = Math.min(this.pending.length, this.marker.length - 1);
		for (let len = max; len > 0; len--) {
			if (this.pending.endsWith(this.marker.slice(0, len))) return len;
		}
		return 0;
	}
}
