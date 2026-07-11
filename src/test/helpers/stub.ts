/**
 * Stub a method on an object for the duration of a test and return a restore
 * function. Uses defineProperty so read-only vscode API surfaces can be
 * replaced too.
 *
 * @example
 * ```typescript
 * const restore = stub(vscode.window, 'showQuickPick', async () => undefined);
 * try {
 *   // ... exercise code that calls showQuickPick
 * } finally {
 *   restore();
 * }
 * ```
 */
/** A restore function returned by {@link stub}. Call it to undo the stub. */
export type Restore = () => void;

export function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): Restore {
	const original = obj[key];
	Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
	return () => Object.defineProperty(obj, key, { value: original, configurable: true, writable: true });
}
