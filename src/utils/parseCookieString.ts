export function parseCookieString(cookieString: string): Record<string, string> {
	const cookies: Record<string, string> = {};

	cookieString.split(';').forEach(pair => {
		const trimmedPair = pair.trim();
		const [key, value] = trimmedPair.split('=');

		if (key && value) {
			cookies[key] = value;
		}
	});

	return cookies;
}
