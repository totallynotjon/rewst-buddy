export function parseCookieString(cookieString: string): Record<string, string> {
	const cookies: Record<string, string> = {};

	cookieString.split(';').forEach(pair => {
		const trimmedPair = pair.trim();
		if (!trimmedPair) {
			return;
		}

		const separatorIndex = trimmedPair.indexOf('=');
		if (separatorIndex === -1) {
			return;
		}

		const key = trimmedPair.slice(0, separatorIndex).trim();
		const value = trimmedPair.slice(separatorIndex + 1);

		if (key) {
			Object.defineProperty(cookies, key, { value, enumerable: true, writable: true, configurable: true });
		}
	});

	return cookies;
}
