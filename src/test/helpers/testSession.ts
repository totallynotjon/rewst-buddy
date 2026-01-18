import { Session, SessionProfile, Sdk } from '@sessions';

let cachedSession: Session | undefined;

/**
 * Check if a test token is available in the environment.
 * Integration tests should skip if this returns false.
 */
export function hasTestToken(): boolean {
	return !!process.env.REWST_TEST_TOKEN;
}

/**
 * Get the test token from the environment.
 * Throws if not set.
 */
export function getTestToken(): string {
	const token = process.env.REWST_TEST_TOKEN;
	if (!token) {
		throw new Error('REWST_TEST_TOKEN not set. Run: REWST_TEST_TOKEN="your-token" npm test');
	}
	return token;
}

/**
 * Create a test session from the environment token.
 * Caches the session for reuse across tests.
 *
 * @throws Error if REWST_TEST_TOKEN is not set
 */
export async function getTestSession(): Promise<Session> {
	if (cachedSession) {
		return cachedSession;
	}

	const token = getTestToken();

	const [sdk, regionConfig, cookieString] = await Session.newSdk(token);

	const response = await sdk.User();
	if (!response.user) {
		throw new Error('Failed to get user from test token');
	}

	const profile: SessionProfile = {
		region: regionConfig,
		org: {
			id: response.user.orgId ?? '',
			name: response.user.organization?.name ?? 'Test Org',
		},
		allManagedOrgs: response.user.allManagedOrgs.map(org => ({
			id: org.id ?? '',
			name: org.name,
		})),
		label: 'Test Session',
		user: response.user,
	};

	cachedSession = new Session(sdk, profile);
	return cachedSession;
}

/**
 * Get the SDK from the test session for direct API calls.
 */
export async function getTestSdk(): Promise<Sdk> {
	const session = await getTestSession();
	if (!session.sdk) {
		throw new Error('Test session has no SDK');
	}
	return session.sdk;
}

/**
 * Clear the cached test session.
 * Call this in afterAll() if you need a fresh session.
 */
export function clearCachedSession(): void {
	cachedSession = undefined;
}

/**
 * Helper for skipping tests when no token is available.
 * Use in describe blocks: describe.skip(skipWithoutToken())
 */
export function skipWithoutToken(): string {
	return hasTestToken() ? '' : 'REWST_TEST_TOKEN not set - skipping integration tests';
}
