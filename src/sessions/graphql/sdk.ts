import { GraphQLClient, RequestOptions } from 'graphql-request';
import type {
	AddAllowedToolMutation,
	AddAllowedToolMutationVariables,
	CreateConversationMessageVoteMutation,
	CreateConversationMessageVoteMutationVariables,
	CreateTemplateMinimalMutation,
	CreateTemplateMinimalMutationVariables,
	DeleteConversationMutation,
	DeleteConversationMutationVariables,
	DeleteTemplateMutation,
	DeleteTemplateMutationVariables,
	GetConversationQuery,
	GetConversationQueryVariables,
	GetConversationsQuery,
	GetConversationsQueryVariables,
	GetTemplateQuery,
	GetTemplateQueryVariables,
	ListTemplatesQuery,
	ListTemplatesQueryVariables,
	MyRoboRewstyPreferencesQuery,
	MyRoboRewstyPreferencesQueryVariables,
	RemoveAllowedToolMutation,
	RemoveAllowedToolMutationVariables,
	UpdateTemplateBodyMutation,
	UpdateTemplateBodyMutationVariables,
	UpdateTemplateMutation,
	UpdateTemplateMutationVariables,
	UpdateTemplateNameMutation,
	UpdateTemplateNameMutationVariables,
	UserQuery,
	UserQueryVariables,
} from './generated/graphql';
import {
	AddAllowedToolDocument,
	CreateConversationMessageVoteDocument,
	CreateTemplateMinimalDocument,
	DeleteConversationDocument,
	DeleteTemplateDocument,
	GetConversationDocument,
	GetConversationsDocument,
	GetTemplateDocument,
	ListTemplatesDocument,
	MyRoboRewstyPreferencesDocument,
	RemoveAllowedToolDocument,
	UpdateTemplateBodyDocument,
	UpdateTemplateDocument,
	UpdateTemplateNameDocument,
	UserDocument,
} from './generated/graphql';

export type {
	AddAllowedToolMutation,
	AddAllowedToolMutationVariables,
	ConversationFragment,
	ConversationMessageFragment,
	CreateConversationMessageVoteMutation,
	CreateConversationMessageVoteMutationVariables,
	CreateTemplateMinimalMutation,
	CreateTemplateMinimalMutationVariables,
	DeleteConversationMutation,
	DeleteConversationMutationVariables,
	DeleteTemplateMutation,
	DeleteTemplateMutationVariables,
	FullTemplateFragment,
	GetConversationQuery,
	GetConversationQueryVariables,
	GetConversationsQuery,
	GetConversationsQueryVariables,
	GetTemplateQuery,
	GetTemplateQueryVariables,
	ListTemplatesQuery,
	ListTemplatesQueryVariables,
	MyRoboRewstyPreferencesQuery,
	MyRoboRewstyPreferencesQueryVariables,
	OrgFragment,
	RemoveAllowedToolMutation,
	RemoveAllowedToolMutationVariables,
	RoboRewstyPreferencesFragment,
	TemplateFragment,
	UpdateTemplateBodyMutation,
	UpdateTemplateBodyMutationVariables,
	UpdateTemplateMutation,
	UpdateTemplateMutationVariables,
	UpdateTemplateNameMutation,
	UpdateTemplateNameMutationVariables,
	UserFragment,
	UserQuery,
	UserQueryVariables,
} from './generated/graphql';

type GraphQLClientRequestHeaders = RequestOptions['requestHeaders'];

export type SdkFunctionWrapper = <T>(
	action: (requestHeaders?: Record<string, string>) => Promise<T>,
	operationName: string,
	operationType?: string,
	variables?: any,
) => Promise<T>;

const defaultWrapper: SdkFunctionWrapper = (action, _operationName, _operationType, _variables) => action();

export function getSdk(client: GraphQLClient, withWrapper: SdkFunctionWrapper = defaultWrapper) {
	return {
		getConversations(
			variables?: GetConversationsQueryVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<GetConversationsQuery> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<GetConversationsQuery>({
						document: GetConversationsDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'getConversations',
				'query',
				variables,
			);
		},
		getConversation(
			variables: GetConversationQueryVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<GetConversationQuery> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<GetConversationQuery>({
						document: GetConversationDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'getConversation',
				'query',
				variables,
			);
		},
		deleteConversation(
			variables: DeleteConversationMutationVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<DeleteConversationMutation> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<DeleteConversationMutation>({
						document: DeleteConversationDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'deleteConversation',
				'mutation',
				variables,
			);
		},
		createConversationMessageVote(
			variables: CreateConversationMessageVoteMutationVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<CreateConversationMessageVoteMutation> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<CreateConversationMessageVoteMutation>({
						document: CreateConversationMessageVoteDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'createConversationMessageVote',
				'mutation',
				variables,
			);
		},
		myRoboRewstyPreferences(
			variables?: MyRoboRewstyPreferencesQueryVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<MyRoboRewstyPreferencesQuery> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<MyRoboRewstyPreferencesQuery>({
						document: MyRoboRewstyPreferencesDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'myRoboRewstyPreferences',
				'query',
				variables,
			);
		},
		addAllowedTool(
			variables: AddAllowedToolMutationVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<AddAllowedToolMutation> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<AddAllowedToolMutation>({
						document: AddAllowedToolDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'addAllowedTool',
				'mutation',
				variables,
			);
		},
		removeAllowedTool(
			variables: RemoveAllowedToolMutationVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<RemoveAllowedToolMutation> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<RemoveAllowedToolMutation>({
						document: RemoveAllowedToolDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'removeAllowedTool',
				'mutation',
				variables,
			);
		},
		listTemplates(
			variables: ListTemplatesQueryVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<ListTemplatesQuery> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<ListTemplatesQuery>({
						document: ListTemplatesDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'listTemplates',
				'query',
				variables,
			);
		},
		createTemplateMinimal(
			variables: CreateTemplateMinimalMutationVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<CreateTemplateMinimalMutation> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<CreateTemplateMinimalMutation>({
						document: CreateTemplateMinimalDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'createTemplateMinimal',
				'mutation',
				variables,
			);
		},
		updateTemplate(
			variables: UpdateTemplateMutationVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<UpdateTemplateMutation> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<UpdateTemplateMutation>({
						document: UpdateTemplateDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'updateTemplate',
				'mutation',
				variables,
			);
		},
		updateTemplateBody(
			variables: UpdateTemplateBodyMutationVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<UpdateTemplateBodyMutation> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<UpdateTemplateBodyMutation>({
						document: UpdateTemplateBodyDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'updateTemplateBody',
				'mutation',
				variables,
			);
		},
		updateTemplateName(
			variables: UpdateTemplateNameMutationVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<UpdateTemplateNameMutation> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<UpdateTemplateNameMutation>({
						document: UpdateTemplateNameDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'updateTemplateName',
				'mutation',
				variables,
			);
		},
		getTemplate(
			variables: GetTemplateQueryVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<GetTemplateQuery> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<GetTemplateQuery>({
						document: GetTemplateDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'getTemplate',
				'query',
				variables,
			);
		},
		deleteTemplate(
			variables: DeleteTemplateMutationVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<DeleteTemplateMutation> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<DeleteTemplateMutation>({
						document: DeleteTemplateDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'deleteTemplate',
				'mutation',
				variables,
			);
		},
		User(
			variables?: UserQueryVariables,
			requestHeaders?: GraphQLClientRequestHeaders,
			signal?: RequestInit['signal'],
		): Promise<UserQuery> {
			return withWrapper(
				wrappedRequestHeaders =>
					client.request<UserQuery>({
						document: UserDocument,
						variables,
						requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
						signal,
					}),
				'User',
				'query',
				variables,
			);
		},
	};
}

export type Sdk = ReturnType<typeof getSdk>;
