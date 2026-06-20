/**
 * Sliding-window rate limiter for MCP-originated calls. An external agent can
 * loop fast, and every call hits a real MSP org through the user's cookie
 * session, so MCP needs its own cap (the chat path has maxToolRounds). Pure and
 * injectable clock for tests.
 */
export class SlidingWindowThrottle {
	private readonly hits: number[] = [];

	constructor(
		private readonly limit: number,
		private readonly windowMs: number,
		private readonly now: () => number = Date.now,
	) {}

	/**
	 * Records a call and returns whether it is allowed. When it returns false the
	 * call should be rejected; the rejected call is not counted against the window.
	 */
	tryAcquire(): boolean {
		const cutoff = this.now() - this.windowMs;
		while (this.hits.length > 0 && this.hits[0] <= cutoff) this.hits.shift();
		if (this.hits.length >= this.limit) return false;
		this.hits.push(this.now());
		return true;
	}

	/** Milliseconds until the oldest in-window hit ages out (for retry hints). */
	retryAfterMs(): number {
		if (this.hits.length === 0) return 0;
		const remaining = this.hits[0] + this.windowMs - this.now();
		return remaining > 0 ? remaining : 0;
	}
}
