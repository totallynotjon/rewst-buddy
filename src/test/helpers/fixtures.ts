import {
	UserQuery,
	FullTemplateFragment,
	TemplateFragment,
	OrgFragment,
	GetTemplateQuery,
	ListTemplatesQuery,
	UpdateTemplateBodyMutation,
	UpdateTemplateMutation,
	CreateTemplateMinimalMutation,
	UserFragment,
} from '@sessions';
import { Org } from '@models';

/**
 * Generate a random ID for test fixtures
 */
function randomId(prefix: string): string {
	return `${prefix}-test-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Type-safe fixture builders for GraphQL types
 *
 * @example
 * ```typescript
 * const org = Fixtures.org({ name: 'My Org' });
 * const user = Fixtures.user({ orgId: org.id });
 * const template = Fixtures.fullTemplate({ name: 'My Template' });
 * ```
 */
export const Fixtures = {
	/**
	 * Create an OrgFragment (GraphQL type with nullable id)
	 */
	org(overrides?: Partial<OrgFragment>): OrgFragment {
		return {
			__typename: 'Organization',
			id: randomId('org'),
			name: 'Test Organization',
			...overrides,
		};
	},

	/**
	 * Create an Org (model type with required id)
	 * Converts OrgFragment to Org by ensuring id is non-null
	 */
	orgModel(overrides?: Partial<Org>): Org {
		const fragment = Fixtures.org(overrides);
		return {
			id: fragment.id ?? randomId('org'),
			name: fragment.name,
		};
	},

	/**
	 * Create a UserFragment
	 */
	userFragment(overrides?: Partial<UserFragment>): UserFragment {
		return {
			__typename: 'User',
			id: randomId('user'),
			username: 'test-user@example.com',
			orgId: randomId('org'),
			createdAt: new Date().toISOString(),
			isApiUser: false,
			isTokenUser: true,
			isSuperuser: false,
			isTestUser: true,
			roleIds: ['role-user'],
			roles: [],
			sub: 'test-sub',
			parentUserId: null,
			parentUsername: null,
			...overrides,
		};
	},

	/**
	 * Create a full User query response with organization and allManagedOrgs
	 */
	user(
		overrides?: Partial<NonNullable<UserQuery['user']> & { allManagedOrgs?: OrgFragment[] }>,
	): NonNullable<UserQuery['user']> {
		const org = Fixtures.org(overrides?.organization === null ? undefined : overrides?.organization);
		const allManagedOrgs = overrides?.allManagedOrgs || [org];

		const baseUser = Fixtures.userFragment({
			orgId: org.id,
			...overrides,
		});

		return {
			...baseUser,
			organization: org,
			allManagedOrgs,
		};
	},

	/**
	 * Create a complete UserQuery response
	 */
	userQuery(overrides?: Partial<NonNullable<UserQuery['user']> & { allManagedOrgs?: OrgFragment[] }>): UserQuery {
		return {
			__typename: 'Query',
			user: Fixtures.user(overrides),
		};
	},

	/**
	 * Create a TemplateFragment (without body)
	 */
	template(overrides?: Partial<TemplateFragment>): TemplateFragment {
		const org = Fixtures.org(overrides?.organization);
		const now = new Date().toISOString();

		return {
			__typename: 'Template',
			id: randomId('template'),
			name: 'Test Template',
			description: null,
			contentType: 'jinja2',
			context: null,
			language: 'jinja2',
			cloneOverrides: null,
			clonedFromId: null,
			isShared: false,
			isSynchronized: false,
			orgId: org.id ?? randomId('org'),
			unpackedFromId: null,
			createdAt: now,
			updatedAt: now,
			updatedById: null,
			organization: org,
			tags: [],
			clonedFrom: null,
			updatedBy: null,
			unpackedFrom: null,
			...overrides,
		};
	},

	/**
	 * Create a FullTemplateFragment (with body)
	 */
	fullTemplate(overrides?: Partial<FullTemplateFragment>): FullTemplateFragment {
		const base = Fixtures.template(overrides);
		return {
			...base,
			body: '// Test template body\n{{ CTX }}',
			...overrides,
		};
	},

	/**
	 * Create a GetTemplateQuery response
	 */
	getTemplateQuery(overrides?: Partial<FullTemplateFragment>): GetTemplateQuery {
		return {
			__typename: 'Query',
			template: Fixtures.fullTemplate(overrides),
		};
	},

	/**
	 * Create a ListTemplatesQuery response
	 */
	listTemplatesQuery(templates?: TemplateFragment[]): ListTemplatesQuery {
		return {
			__typename: 'Query',
			templates: templates ?? [
				Fixtures.template({ name: 'Template 1' }),
				Fixtures.template({ name: 'Template 2' }),
				Fixtures.template({ name: 'Template 3' }),
			],
		};
	},

	/**
	 * Create an UpdateTemplateBodyMutation response
	 */
	updateTemplateBodyMutation(overrides?: Partial<FullTemplateFragment>): UpdateTemplateBodyMutation {
		return {
			__typename: 'Mutation',
			template: Fixtures.fullTemplate(overrides),
		};
	},

	/**
	 * Create an UpdateTemplateMutation response
	 */
	updateTemplateMutation(overrides?: Partial<TemplateFragment>): UpdateTemplateMutation {
		return {
			__typename: 'Mutation',
			template: Fixtures.template(overrides),
		};
	},

	/**
	 * Create a CreateTemplateMinimalMutation response
	 */
	createTemplateMinimalMutation(overrides?: Partial<TemplateFragment>): CreateTemplateMinimalMutation {
		return {
			__typename: 'Mutation',
			template: Fixtures.template(overrides),
		};
	},

	/**
	 * Create a network error
	 */
	networkError(message = 'Network request failed'): Error {
		const error = new Error(message);
		error.name = 'NetworkError';
		return error;
	},

	/**
	 * Create a GraphQL error
	 */
	graphqlError(message = 'GraphQL operation failed'): Error {
		const error = new Error(message);
		error.name = 'GraphQLError';
		return error;
	},

	/**
	 * Create a not found error
	 */
	notFoundError(resourceType = 'Resource'): Error {
		return new Error(`${resourceType} not found`);
	},

	/**
	 * Create a timeout error
	 */
	timeoutError(message = 'Operation timed out'): Error {
		const error = new Error(message);
		error.name = 'TimeoutError';
		return error;
	},
};
