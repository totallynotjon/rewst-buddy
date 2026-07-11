import { Session, SessionProfile, Sdk } from '@sessions';
import { context } from '@global';

let cachedSession: Session | undefined;

/** Jon's sandbox. Override for another contributor's sandbox in `.env`. */
export const DEFAULT_REWST_TEST_ORG_ID = '01940973-8a88-7109-8ba7-d64bfbb18950';

/**
 * The only organization integration tests may target. This never falls back to
 * the authenticated user's primary organization: a production session token is
 * allowed, but every org-scoped operation must still point at an explicitly
 * configured sandbox.
 */
export function getTestOrgId(): string {
	const configured = process.env.REWST_TEST_ORG_ID?.trim();
	return configured || DEFAULT_REWST_TEST_ORG_ID;
}

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

	const targetOrgId = getTestOrgId();
	const visibleOrgs = [
		response.user.organization,
		...(response.user.allManagedOrgs ?? []),
		...(response.user.organization?.managedAndSubOrgs ?? []),
	].filter((org): org is NonNullable<typeof org> => org != null);
	const targetOrg = visibleOrgs.find(org => org.id === targetOrgId);
	if (!targetOrg) {
		throw new Error(
			`Refusing to run integration tests: REWST_TEST_ORG_ID ${targetOrgId} is not managed by this token. ` +
				`No fallback to the token's primary org is allowed.`,
		);
	}
	const scopedOrganization = { ...targetOrg, managedAndSubOrgs: [targetOrg] };
	const scopedUser = {
		...response.user,
		orgId: targetOrgId,
		organization: scopedOrganization,
		allManagedOrgs: [targetOrg],
	};

	const profile: SessionProfile = {
		region: regionConfig,
		org: {
			id: targetOrgId,
			name: targetOrg.name ?? `Sandbox ${targetOrgId}`,
		},
		allManagedOrgs: [{ id: targetOrgId, name: targetOrg.name }],
		label: 'Test Session',
		user: scopedUser,
	};

	if (profile.org.id !== targetOrgId) throw new Error('getTestSession: sandbox org binding failed closed.');
	const userId = profile.user.id;
	if (!userId) {
		throw new Error('getTestSession: the test token resolved no user id.');
	}
	// Store the validated cookie so session.rawGraphql (which reads the cookie from
	// secrets via getCookies, keyed by user id) works in integration tests, not just the typed SDK.
	await context.secrets.store(userId, cookieString.value);

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
