import { Session, SessionProfile, getSdk } from '@sessions';
import { GraphQLClient } from 'graphql-request';
import { MockWrapper, createMockWrapper, MockWrapperConfig } from './mockWrapper';
import { Fixtures } from './fixtures';
import { RegionConfig } from '../../sessions/RegionConfig';
import { Org } from '@models';

/**
 * Options for creating a mock session
 */
export interface MockSessionOptions {
	/** Configuration for the mock wrapper */
	wrapperConfig?: MockWrapperConfig;
	/** Partial profile overrides */
	profile?: Partial<SessionProfile> & {
		org?: Partial<Org>;
		allManagedOrgs?: Partial<Org>[];
	};
	/** Auto-configure default handlers (User, listTemplates) */
	setupDefaults?: boolean;
}

/**
 * Create a mock session with a mock SDK for testing
 *
 * @param options - Configuration options
 * @returns Object containing the session and wrapper for assertions
 *
 * @example
 * ```typescript
 * const { session, wrapper } = createMockSession();
 *
 * // Configure specific responses
 * wrapper.when('getTemplate', {
 *   data: Fixtures.getTemplateQuery({ name: 'My Template' })
 * });
 *
 * // Use session in tests
 * SessionManager._setSessionsForTesting([session]);
 * ```
 */
export function createMockSession(options: MockSessionOptions = {}): { session: Session; wrapper: MockWrapper } {
	const { wrapperConfig = {}, profile, setupDefaults = true } = options;

	// Create mock wrapper
	const wrapper = createMockWrapper(wrapperConfig);

	// Configure default handlers if requested
	if (setupDefaults) {
		const org = Fixtures.org(profile?.org);
		const user = Fixtures.user({
			orgId: org.id ?? undefined,
			organization: org,
			allManagedOrgs: [org],
		});

		wrapper
			.when('User', { data: { __typename: 'Query' as const, user } })
			.when('listTemplates', { data: Fixtures.listTemplatesQuery() });
	}

	// Create a dummy GraphQL client (won't be used since wrapper intercepts)
	const dummyClient = new GraphQLClient('http://localhost:9999/graphql');

	// Create SDK with mock wrapper
	const sdk = getSdk(dummyClient, wrapper.getWrapper());

	// Create session profile
	const orgFragment = Fixtures.org(profile?.org);
	const defaultOrg: Org = {
		id: orgFragment.id ?? '',
		name: orgFragment.name,
	};

	const defaultAllManagedOrgs: Org[] = profile?.allManagedOrgs
		? profile.allManagedOrgs.map(o => {
				const orgFrag = Fixtures.org(o);
				return { id: orgFrag.id ?? '', name: orgFrag.name };
			})
		: [defaultOrg];

	const defaultRegion: RegionConfig = {
		name: 'Test Region',
		cookieName: 'test_cookie',
		graphqlUrl: 'http://localhost:9999/graphql',
		loginUrl: 'http://localhost:9999/login',
	};

	const sessionProfile: SessionProfile = {
		region: defaultRegion,
		org: defaultOrg,
		allManagedOrgs: defaultAllManagedOrgs,
		label: 'Mock Session',
		user: Fixtures.userFragment({ orgId: defaultOrg.id }),
		...profile,
	};

	const session = new Session(sdk, sessionProfile);

	return { session, wrapper };
}
