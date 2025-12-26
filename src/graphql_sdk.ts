import { GraphQLClient, RequestOptions } from 'graphql-request';
import { gql } from 'graphql-request';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
type GraphQLClientRequestHeaders = RequestOptions['requestHeaders'];
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  JSON: { input: any; output: any; }
  Upload: { input: any; output: any; }
  Void: { input: any; output: any; }
};

export type Action = {
  __typename?: 'Action';
  actionOptions: Array<ActionOption>;
  category?: Maybe<Scalars['String']['output']>;
  className?: Maybe<Scalars['String']['output']>;
  defaultHumanSecondsSaved?: Maybe<Scalars['Int']['output']>;
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationMessage?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  entryPoint?: Maybe<Scalars['String']['output']>;
  hidden?: Maybe<Scalars['Boolean']['output']>;
  icon?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  orgId?: Maybe<Scalars['ID']['output']>;
  organization?: Maybe<Organization>;
  outputSchema?: Maybe<Scalars['JSON']['output']>;
  pack?: Maybe<Pack>;
  packId: Scalars['ID']['output'];
  parameters?: Maybe<Scalars['JSON']['output']>;
  ref?: Maybe<Scalars['String']['output']>;
  runner?: Maybe<Runner>;
  uid?: Maybe<Scalars['ID']['output']>;
  visibleForOrganizations: Array<Organization>;
  workflow?: Maybe<Workflow>;
};


export type ActionPackArgs = {
  where?: InputMaybe<PackInput>;
};


export type ActionParametersArgs = {
  populateOptions?: InputMaybe<Scalars['Boolean']['input']>;
};

export type ActionInput = {
  category?: InputMaybe<Scalars['String']['input']>;
  deprecated?: InputMaybe<Scalars['Boolean']['input']>;
  deprecationMessage?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  hidden?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  outputSchema?: InputMaybe<Scalars['JSON']['input']>;
  pack?: InputMaybe<PackInput>;
  packId?: InputMaybe<Scalars['ID']['input']>;
  parameters?: InputMaybe<Scalars['JSON']['input']>;
  ref?: InputMaybe<Scalars['String']['input']>;
  runner_type?: InputMaybe<Scalars['String']['input']>;
  uid?: InputMaybe<Scalars['ID']['input']>;
};

export type ActionOption = {
  __typename?: 'ActionOption';
  actions?: Maybe<Array<Action>>;
  id?: Maybe<Scalars['ID']['output']>;
  optionLabel?: Maybe<Scalars['String']['output']>;
  optionValue?: Maybe<Scalars['String']['output']>;
  organization?: Maybe<Organization>;
  organizationId?: Maybe<Scalars['ID']['output']>;
  packConfig?: Maybe<PackConfig>;
  packConfigId?: Maybe<Scalars['ID']['output']>;
  resourceName?: Maybe<Scalars['String']['output']>;
};

export type ActionOptionInput = {
  optionLabel?: InputMaybe<Scalars['String']['input']>;
  optionValue?: InputMaybe<Scalars['String']['input']>;
  organizationId?: InputMaybe<Scalars['ID']['input']>;
  packConfigId?: InputMaybe<Scalars['ID']['input']>;
  resourceName?: InputMaybe<Scalars['String']['input']>;
};

export type ActionOptionSearchInput = {
  optionLabel?: InputMaybe<String_Comparison_Exp>;
  optionValue?: InputMaybe<String_Comparison_Exp>;
  organizationId?: InputMaybe<Id_Comparison_Exp>;
  packConfig?: InputMaybe<PackConfigSearch>;
  packConfigId?: InputMaybe<Id_Comparison_Exp>;
  resourceName?: InputMaybe<String_Comparison_Exp>;
};

export type ActionOptionWhereInput = {
  optionLabel?: InputMaybe<Scalars['String']['input']>;
  optionValue?: InputMaybe<Scalars['String']['input']>;
  organizationId?: InputMaybe<Scalars['ID']['input']>;
  packConfig?: InputMaybe<PackConfigWhereInput>;
  packConfigId?: InputMaybe<Scalars['ID']['input']>;
  resourceName?: InputMaybe<Scalars['String']['input']>;
};

export type ActionSearch = {
  category?: InputMaybe<String_Comparison_Exp>;
  deprecated?: InputMaybe<Bool_Comparison_Exp>;
  description?: InputMaybe<String_Comparison_Exp>;
  enabled?: InputMaybe<Bool_Comparison_Exp>;
  hidden?: InputMaybe<Bool_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  outputSchema?: InputMaybe<Json_Comparison_Exp>;
  pack?: InputMaybe<PackSearchInput>;
  parameters?: InputMaybe<Json_Comparison_Exp>;
  ref?: InputMaybe<String_Comparison_Exp>;
  uid?: InputMaybe<Id_Comparison_Exp>;
};

export type ActionUpdateInput = {
  category?: InputMaybe<Scalars['String']['input']>;
  deprecated?: InputMaybe<Scalars['Boolean']['input']>;
  deprecationMessage?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  hidden?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  outputSchema?: InputMaybe<Scalars['JSON']['input']>;
  parameters?: InputMaybe<Scalars['JSON']['input']>;
  ref?: InputMaybe<Scalars['String']['input']>;
};

export type ApiClient = {
  __typename?: 'ApiClient';
  auth0ClientId: Scalars['String']['output'];
  clientType: ApiClientType;
  createdAt: Scalars['String']['output'];
  createdById?: Maybe<Scalars['ID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  impersonationUser?: Maybe<User>;
  impersonationUserId?: Maybe<Scalars['ID']['output']>;
  name: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
  organization: Organization;
  secretRotatedAt?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
  updatedById?: Maybe<Scalars['ID']['output']>;
};

export type ApiClientList = {
  __typename?: 'ApiClientList';
  apiClients: Array<ApiClient>;
  hasMore: Scalars['Boolean']['output'];
  totalCount: Scalars['Int']['output'];
};

export type ApiClientListInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};

export type ApiClientSecretRotation = {
  __typename?: 'ApiClientSecretRotation';
  auth0ClientId: Scalars['String']['output'];
  auth0ClientSecret: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  secretRotatedAt: Scalars['String']['output'];
};

export enum ApiClientStatus {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE'
}

export enum ApiClientType {
  Engine = 'ENGINE',
  Organization = 'ORGANIZATION'
}

export type ApiClientWhereInput = {
  clientType?: InputMaybe<ApiClientType>;
  id?: InputMaybe<Scalars['ID']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
};

export type ApiClientWithSecret = {
  __typename?: 'ApiClientWithSecret';
  auth0ClientId: Scalars['String']['output'];
  auth0ClientSecret: Scalars['String']['output'];
  clientType: ApiClientType;
  createdAt: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  impersonationUser?: Maybe<User>;
  impersonationUserId?: Maybe<Scalars['ID']['output']>;
  name: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
  organization: Organization;
  secretRotatedAt?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
};

export type AppPlatformReservedDomain = {
  __typename?: 'AppPlatformReservedDomain';
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  createdById?: Maybe<Scalars['ID']['output']>;
  domain?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isStaffAllowed?: Maybe<Scalars['Boolean']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
  useStrictMatch?: Maybe<Scalars['Boolean']['output']>;
};

export type AppPlatformReservedDomainCreateInput = {
  domain: Scalars['String']['input'];
  isStaffAllowed?: InputMaybe<Scalars['Boolean']['input']>;
};

export type AppPlatformReservedDomainSearchInput = {
  createdBy?: InputMaybe<UserSearchInput>;
  domain?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  isStaffAllowed?: InputMaybe<Bool_Comparison_Exp>;
  updatedBy?: InputMaybe<UserSearchInput>;
};

export type AppPlatformReservedDomainUpdateInput = {
  domain?: InputMaybe<Scalars['String']['input']>;
  isStaffAllowed?: InputMaybe<Scalars['Boolean']['input']>;
};

export type AppPlatformReservedDomainWhereInput = {
  createdBy?: InputMaybe<UserWhereInput>;
  domain?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isStaffAllowed?: InputMaybe<Scalars['Boolean']['input']>;
  updatedBy?: InputMaybe<UserWhereInput>;
  useStrictMatch?: InputMaybe<Scalars['Boolean']['input']>;
};

export type AssociatedPack = {
  __typename?: 'AssociatedPack';
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type AuthUrlResponse = {
  __typename?: 'AuthUrlResponse';
  authUrl?: Maybe<Scalars['String']['output']>;
  error?: Maybe<Scalars['String']['output']>;
};

export type AzureFunctionAppInterpreterDeploymentStreamEvent = AzureFunctionAppInterpreterDeploymentStreamFailureResponse | AzureFunctionAppInterpreterDeploymentStreamMessage | AzureFunctionAppInterpreterDeploymentStreamSuccessResponse;

export type AzureFunctionAppInterpreterDeploymentStreamFailureResponse = BaseStreamEvent & {
  __typename?: 'AzureFunctionAppInterpreterDeploymentStreamFailureResponse';
  didSucceed: Scalars['Boolean']['output'];
  error: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type AzureFunctionAppInterpreterDeploymentStreamMessage = BaseStreamEvent & {
  __typename?: 'AzureFunctionAppInterpreterDeploymentStreamMessage';
  isFinished: Scalars['Boolean']['output'];
  phase: Scalars['String']['output'];
};

export type AzureFunctionAppInterpreterDeploymentStreamSuccessResponse = BaseStreamEvent & {
  __typename?: 'AzureFunctionAppInterpreterDeploymentStreamSuccessResponse';
  didSucceed: Scalars['Boolean']['output'];
  isFinished: Scalars['Boolean']['output'];
  phase: Scalars['String']['output'];
};

export type BaseCloneObjectSuccessResponse = {
  id: Scalars['ID']['output'];
  orgId: Scalars['ID']['output'];
  type: CloneableObjectType;
};

export type BaseCloningResponse = {
  didSucceed: Scalars['Boolean']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type BaseMicrosoftCspConsentResponse = {
  event: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type BaseStreamEvent = {
  isFinished: Scalars['Boolean']['output'];
};

export type BaseStreamResponse = {
  didSucceed: Scalars['Boolean']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type CspApplicationGrant = {
  enterpriseApplicationId: Scalars['String']['input'];
  scope: Scalars['String']['input'];
};

export enum CspConsentAction {
  Create = 'CREATE',
  Revoke = 'REVOKE'
}

export type CspConsentResult = {
  __typename?: 'CSPConsentResult';
  action: CspConsentAction;
  errors: Array<Scalars['String']['output']>;
  packConfigId: Scalars['ID']['output'];
  tenantIdsWithConsent: Array<Scalars['ID']['output']>;
  updatedCustomers: Array<CspCustomerRecord>;
};

export type CspCustomerRecord = {
  __typename?: 'CSPCustomerRecord';
  companyName: Scalars['String']['output'];
  domain: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
};

export type CheckAuthorizationInput = {
  fullyConsistent?: InputMaybe<Scalars['Boolean']['input']>;
  objectId: Scalars['String']['input'];
  objectType: Scalars['String']['input'];
  relation: Scalars['String']['input'];
  userId: Scalars['ID']['input'];
};

export type CheckInput = {
  objectId: Scalars['String']['input'];
  objectType: Scalars['String']['input'];
  relation: Scalars['String']['input'];
};

export type CloneFormStreamSuccessResponse = BaseCloneObjectSuccessResponse & BaseCloningResponse & BaseStreamEvent & {
  __typename?: 'CloneFormStreamSuccessResponse';
  didSucceed: Scalars['Boolean']['output'];
  form: Form;
  id: Scalars['ID']['output'];
  isFinished: Scalars['Boolean']['output'];
  orgId: Scalars['ID']['output'];
  type: CloneableObjectType;
};

export type CloneObjectStreamEvent = CloneFormStreamSuccessResponse | CloneSiteStreamSuccessResponse | CloneTemplateStreamSuccessResponse | CloneWorkflowStreamSuccessResponse | CloningExportPhaseStreamFailureResponse | CloningExportPhaseStreamMessage | CloningImportPhaseStreamFailureResponse | CloningImportPhaseStreamMessage;

export enum ClonePhase {
  Exporting = 'EXPORTING',
  Importing = 'IMPORTING'
}

export type CloneSiteStreamSuccessResponse = BaseCloneObjectSuccessResponse & BaseCloningResponse & BaseStreamEvent & {
  __typename?: 'CloneSiteStreamSuccessResponse';
  didSucceed: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isFinished: Scalars['Boolean']['output'];
  orgId: Scalars['ID']['output'];
  site: Site;
  type: CloneableObjectType;
};

export type CloneTemplateStreamSuccessResponse = BaseCloneObjectSuccessResponse & BaseCloningResponse & BaseStreamEvent & {
  __typename?: 'CloneTemplateStreamSuccessResponse';
  didSucceed: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isFinished: Scalars['Boolean']['output'];
  orgId: Scalars['ID']['output'];
  template: Template;
  type: CloneableObjectType;
};

export type CloneWorkflowStreamSuccessResponse = BaseCloneObjectSuccessResponse & BaseCloningResponse & BaseStreamEvent & {
  __typename?: 'CloneWorkflowStreamSuccessResponse';
  didSucceed: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isFinished: Scalars['Boolean']['output'];
  orgId: Scalars['ID']['output'];
  type: CloneableObjectType;
  workflow: Workflow;
};

export enum CloneableObjectType {
  Form = 'form',
  Page = 'page',
  Site = 'site',
  Template = 'template',
  Trigger = 'trigger',
  Workflow = 'workflow'
}

export type CloningExportPhaseStreamFailureResponse = BaseCloningResponse & BaseStreamEvent & PhasedCloneEvent & {
  __typename?: 'CloningExportPhaseStreamFailureResponse';
  code?: Maybe<Scalars['String']['output']>;
  didSucceed: Scalars['Boolean']['output'];
  error?: Maybe<Scalars['String']['output']>;
  failures: Array<ExportErrorObject>;
  isFinished: Scalars['Boolean']['output'];
  phase: ClonePhase;
};

export type CloningExportPhaseStreamMessage = BaseStreamEvent & ExportObjectsProgressMessage & PhasedCloneEvent & {
  __typename?: 'CloningExportPhaseStreamMessage';
  errors?: Maybe<Array<Scalars['String']['output']>>;
  failed: Scalars['Boolean']['output'];
  identity: ExportObjectIdentifier;
  isFinished: Scalars['Boolean']['output'];
  object?: Maybe<IntermediateExportObject>;
  phase: ClonePhase;
  progress: ExportProgressInfo;
};

export type CloningImportPhaseStreamFailureResponse = BaseCloningResponse & BaseStreamEvent & PhasedCloneEvent & {
  __typename?: 'CloningImportPhaseStreamFailureResponse';
  code?: Maybe<Scalars['String']['output']>;
  didSucceed: Scalars['Boolean']['output'];
  error: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
  phase: ClonePhase;
};

export type CloningImportPhaseStreamMessage = BaseStreamEvent & ImportProgressMessage & PhasedCloneEvent & {
  __typename?: 'CloningImportPhaseStreamMessage';
  isFinished: Scalars['Boolean']['output'];
  object: ImportObject;
  phase: ClonePhase;
  progress: ImportProgressInfo;
};

export type CommonlyUsedAction = {
  __typename?: 'CommonlyUsedAction';
  category?: Maybe<Scalars['String']['output']>;
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationMessage?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  pack?: Maybe<Pack>;
  ref?: Maybe<Scalars['String']['output']>;
  usageCount?: Maybe<Scalars['Int']['output']>;
};

export type CompletionListenerCreateInput = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  handlerWorkflowId: Scalars['ID']['input'];
  listeningToWorkflowId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  packOverrides?: InputMaybe<Array<InputMaybe<PackOverrideInput>>>;
  triggerOnStatuses: Array<Scalars['String']['input']>;
};

export type CompletionListenerUpdateInput = {
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  handlerWorkflowId: Scalars['ID']['input'];
  listeningToWorkflowId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  packOverrides?: InputMaybe<Array<InputMaybe<PackOverrideInput>>>;
  triggerId: Scalars['ID']['input'];
  triggerOnStatuses: Array<Scalars['String']['input']>;
};

export type Component = {
  __typename?: 'Component';
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  createdById?: Maybe<Scalars['ID']['output']>;
  currentVersion?: Maybe<Scalars['Int']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
  versions?: Maybe<Array<ComponentVersion>>;
};

export type ComponentGeneratorResponse = {
  __typename?: 'ComponentGeneratorResponse';
  tsx: Scalars['String']['output'];
};

export type ComponentInstance = {
  __typename?: 'ComponentInstance';
  componentVersionId?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  pageId: Scalars['ID']['output'];
  pageNodes?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
};

export type ComponentInstanceCreateInput = {
  pageId: Scalars['ID']['input'];
  pageNodes: Scalars['String']['input'];
};

export type ComponentInstanceCreationResult = {
  __typename?: 'ComponentInstanceCreationResult';
  componentInstance?: Maybe<ComponentInstance>;
  componentVersionId: Scalars['ID']['output'];
};

export type ComponentInstanceInput = {
  componentVersionId?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  pageId: Scalars['ID']['input'];
  pageNodes?: InputMaybe<Scalars['String']['input']>;
};

export type ComponentInstanceResult = {
  __typename?: 'ComponentInstanceResult';
  componentInstances?: Maybe<Array<Maybe<ComponentInstance>>>;
  errors?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  message?: Maybe<Scalars['String']['output']>;
  success: Scalars['Boolean']['output'];
};

export type ComponentInstanceUpdateInput = {
  componentVersionId: Scalars['ID']['input'];
  pageId: Scalars['ID']['input'];
};

export type ComponentTree = {
  __typename?: 'ComponentTree';
  component: Component;
  createdAt?: Maybe<Scalars['String']['output']>;
  encoded: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  versionNumber?: Maybe<Scalars['Int']['output']>;
};

export type ComponentVersion = {
  __typename?: 'ComponentVersion';
  componentId: Scalars['ID']['output'];
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  createdById?: Maybe<Scalars['ID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
  versionNumber: Scalars['Int']['output'];
  workflows?: Maybe<Array<Maybe<Workflow>>>;
};

export enum ConfigFallbackModes {
  FailAction = 'FAIL_ACTION',
  FailWorkflow = 'FAIL_WORKFLOW',
  UseDefault = 'USE_DEFAULT'
}

export enum ConfigName {
  ChartGenerator = 'chart_generator',
  ComponentGenerator = 'component_generator'
}

export enum ConfigSelectionModes {
  UseDefault = 'USE_DEFAULT',
  UseNameSearch = 'USE_NAME_SEARCH',
  UseOrgMapping = 'USE_ORG_MAPPING',
  UseSelectedId = 'USE_SELECTED_ID'
}

export type Conversation = {
  __typename?: 'Conversation';
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  messages: Array<ConversationMessage>;
  metadata?: Maybe<Scalars['JSON']['output']>;
  orgId: Scalars['ID']['output'];
  organization: Organization;
  title?: Maybe<Scalars['String']['output']>;
  type: ConversationType;
  updatedAt: Scalars['String']['output'];
  user: User;
  userId: Scalars['ID']['output'];
};


export type ConversationMessagesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};

export type ConversationInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  orgId: Scalars['ID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<ConversationType>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};

export type ConversationMessage = {
  __typename?: 'ConversationMessage';
  content: Scalars['String']['output'];
  conversation: Conversation;
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  role: ConversationRole;
  updatedAt: Scalars['String']['output'];
  user?: Maybe<User>;
  userId?: Maybe<Scalars['ID']['output']>;
};

export type ConversationMessageInput = {
  content: Scalars['String']['input'];
  conversationId: Scalars['ID']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  role: ConversationRole;
  userId?: InputMaybe<Scalars['ID']['input']>;
};

export type ConversationMessageItemResponse = {
  __typename?: 'ConversationMessageItemResponse';
  content: Scalars['String']['output'];
  conversation: Conversation;
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  id?: Maybe<Scalars['ID']['output']>;
  metadata?: Maybe<Scalars['JSON']['output']>;
  role: ConversationRole;
  updatedAt: Scalars['String']['output'];
  user?: Maybe<User>;
  userId?: Maybe<Scalars['ID']['output']>;
};

export type ConversationMessageResponse = {
  __typename?: 'ConversationMessageResponse';
  conversation_id: Scalars['ID']['output'];
  error?: Maybe<Scalars['String']['output']>;
  message?: Maybe<ConversationMessage>;
  metadata?: Maybe<Scalars['JSON']['output']>;
  status: Scalars['String']['output'];
};

export type ConversationMessageVote = {
  __typename?: 'ConversationMessageVote';
  comment?: Maybe<Scalars['String']['output']>;
  conversationMessageId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  message?: Maybe<ConversationMessage>;
  reason?: Maybe<VoteReason>;
  updatedAt: Scalars['String']['output'];
  user?: Maybe<User>;
  userId: Scalars['ID']['output'];
  vote: VoteType;
};

export type ConversationMessageVoteInput = {
  comment?: InputMaybe<Scalars['String']['input']>;
  conversationMessageId: Scalars['ID']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
  reason?: InputMaybe<VoteReason>;
  vote: VoteType;
};

export type ConversationMessageVoteWhereInput = {
  conversationMessageId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  reason?: InputMaybe<VoteReason>;
  userId?: InputMaybe<Scalars['ID']['input']>;
  vote?: InputMaybe<VoteType>;
};

export enum ConversationRole {
  Assistant = 'ASSISTANT',
  System = 'SYSTEM',
  Tool = 'TOOL',
  User = 'USER'
}

export enum ConversationType {
  HelpDocs = 'HELP_DOCS',
  WorkflowAutoDocumentation = 'WORKFLOW_AUTO_DOCUMENTATION',
  WorkflowDiagnosis = 'WORKFLOW_DIAGNOSIS'
}

export type ConversationWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  type?: InputMaybe<ConversationType>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};

export type Crate = {
  __typename?: 'Crate';
  associatedPacks?: Maybe<Array<Pack>>;
  category?: Maybe<Scalars['String']['output']>;
  crateTriggers?: Maybe<Array<CrateTrigger>>;
  createdAt?: Maybe<Scalars['String']['output']>;
  createdById?: Maybe<Scalars['ID']['output']>;
  /** Description of the crate */
  description?: Maybe<Scalars['String']['output']>;
  gid?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  isPublic: Scalars['Boolean']['output'];
  isUnpackedForSelectedOrg?: Maybe<Scalars['Boolean']['output']>;
  lastPublishedAt?: Maybe<Scalars['String']['output']>;
  maturity?: Maybe<CrateMaturity>;
  /** Name of the crate */
  name: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
  overrides?: Maybe<Array<CrateOverride>>;
  primaryPack?: Maybe<Pack>;
  primaryPackId?: Maybe<Scalars['ID']['output']>;
  providedValue?: Maybe<Scalars['String']['output']>;
  replicationRegions?: Maybe<Array<CrateReplicationRegion>>;
  requiredOrgVariables?: Maybe<Array<Scalars['String']['output']>>;
  setupAssistance?: Maybe<Scalars['Boolean']['output']>;
  setupTime?: Maybe<Scalars['Int']['output']>;
  sourceEnvironment?: Maybe<Scalars['String']['output']>;
  status: CrateStatus;
  tagIds?: Maybe<Array<Scalars['ID']['output']>>;
  tags?: Maybe<Array<Tag>>;
  tokens: Array<CrateToken>;
  triggers?: Maybe<Array<Trigger>>;
  unpackedWorkflowId?: Maybe<Scalars['ID']['output']>;
  unpackingCount?: Maybe<Scalars['Int']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedById?: Maybe<Scalars['ID']['output']>;
  workflow?: Maybe<Workflow>;
  workflowId?: Maybe<Scalars['ID']['output']>;
};

export type CrateCreateInput = {
  associatedPacks?: InputMaybe<Array<Scalars['ID']['input']>>;
  category?: InputMaybe<Scalars['String']['input']>;
  createdAt?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  gid?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isPublic?: InputMaybe<Scalars['Boolean']['input']>;
  maturity?: InputMaybe<CrateMaturity>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
  primaryPackId?: InputMaybe<Scalars['ID']['input']>;
  providedValue?: InputMaybe<Scalars['String']['input']>;
  replicationRegions?: InputMaybe<Array<CrateReplicationRegion>>;
  requiredOrgVariables?: InputMaybe<Array<Scalars['String']['input']>>;
  setupAssistance?: InputMaybe<Scalars['Boolean']['input']>;
  setupTime?: InputMaybe<Scalars['Int']['input']>;
  sourceEnvironment?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<CrateStatus>;
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  tokens?: InputMaybe<Array<InputMaybe<CrateTokenInput>>>;
  triggers?: InputMaybe<Array<CrateTriggerInput>>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export enum CrateMaturity {
  Egg = 'EGG',
  Fledgling = 'FLEDGLING',
  Hatchling = 'HATCHLING',
  Migrating = 'MIGRATING',
  Nestling = 'NESTLING',
  Soaring = 'SOARING'
}

export type CrateOverride = {
  __typename?: 'CrateOverride';
  crate: Crate;
  crateId: Scalars['ID']['output'];
  crateTriggers?: Maybe<Array<CrateTrigger>>;
  crateUnpackingArgument?: Maybe<CrateUnpackingArgument>;
  crateUnpackingArgumentId?: Maybe<Scalars['ID']['output']>;
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  createdById?: Maybe<Scalars['ID']['output']>;
  defaultValue?: Maybe<Scalars['String']['output']>;
  entity?: Maybe<CrateOverrideEntityType>;
  id: Scalars['ID']['output'];
  isDynamic: Scalars['Boolean']['output'];
  isMultiselect: Scalars['Boolean']['output'];
  label: Scalars['String']['output'];
  name: Scalars['String']['output'];
  options: Array<CrateOverrideOption>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
};

export enum CrateOverrideEntityType {
  Parameter = 'parameter',
  Var = 'var'
}

export type CrateOverrideInput = {
  crateId?: InputMaybe<Scalars['ID']['input']>;
  crateTriggerIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  defaultValue?: InputMaybe<Scalars['String']['input']>;
  entity?: InputMaybe<CrateOverrideEntityType>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isDynamic?: InputMaybe<Scalars['Boolean']['input']>;
  isMultiselect?: InputMaybe<Scalars['Boolean']['input']>;
  label?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  options?: InputMaybe<Array<CrateOverrideOptionInput>>;
};

export type CrateOverrideOption = {
  __typename?: 'CrateOverrideOption';
  crateOverride: CrateOverride;
  crateOverrideId: Scalars['ID']['output'];
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  createdById?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  isDefault: Scalars['Boolean']['output'];
  label: Scalars['String']['output'];
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
  value: Scalars['String']['output'];
};

export type CrateOverrideOptionInput = {
  crateOverrideId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  label?: InputMaybe<Scalars['String']['input']>;
  value?: InputMaybe<Scalars['String']['input']>;
};

export enum CrateReplicationRegion {
  Au = 'AU',
  Dev = 'DEV',
  Eu = 'EU',
  Qa = 'QA',
  Staging = 'STAGING',
  Uk = 'UK',
  Us = 'US'
}

export type CrateSearchInput = {
  description?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  lastPublishedAt?: InputMaybe<String_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  primaryPack?: InputMaybe<PackSearchInput>;
  tokens?: InputMaybe<Json_Comparison_Exp>;
  workflow?: InputMaybe<WorkflowSearch>;
};

export enum CrateStatus {
  Draft = 'DRAFT',
  Published = 'PUBLISHED'
}

export type CrateTagInput = {
  id: Scalars['ID']['input'];
};

export type CrateToken = {
  __typename?: 'CrateToken';
  appliedToCrateTriggers?: Maybe<Array<CrateTrigger>>;
  children?: Maybe<Array<Maybe<CrateToken>>>;
  crate?: Maybe<Crate>;
  crateId: Scalars['ID']['output'];
  emptyLabel?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  index: Scalars['Int']['output'];
  isMultiselect?: Maybe<Scalars['Boolean']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  options: Array<CrateTokenOption>;
  parent?: Maybe<CrateToken>;
  parentId?: Maybe<Scalars['ID']['output']>;
  previewText?: Maybe<Scalars['String']['output']>;
  type?: Maybe<CrateTokenType>;
  value?: Maybe<Scalars['String']['output']>;
};

export type CrateTokenInput = {
  appliedToCrateTriggers?: InputMaybe<Array<Scalars['ID']['input']>>;
  appliedToTriggers?: InputMaybe<Array<Scalars['ID']['input']>>;
  crateId?: InputMaybe<Scalars['ID']['input']>;
  emptyLabel?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  index?: InputMaybe<Scalars['Int']['input']>;
  isMultiselect?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  options?: InputMaybe<Array<CrateTokenOptionInput>>;
  parentId?: InputMaybe<Scalars['ID']['input']>;
  previewText?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
  value?: InputMaybe<Scalars['String']['input']>;
};

export type CrateTokenOption = {
  __typename?: 'CrateTokenOption';
  crate: Crate;
  crateId: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  isDefault: Scalars['Boolean']['output'];
  label?: Maybe<Scalars['String']['output']>;
  pack?: Maybe<Pack>;
  packId?: Maybe<Scalars['ID']['output']>;
  token: CrateToken;
  tokenId: Scalars['ID']['output'];
  value?: Maybe<Scalars['String']['output']>;
};

export type CrateTokenOptionInput = {
  crateId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  label?: InputMaybe<Scalars['String']['input']>;
  packId?: InputMaybe<Scalars['ID']['input']>;
  tokenId?: InputMaybe<Scalars['ID']['input']>;
  value?: InputMaybe<Scalars['String']['input']>;
};

export enum CrateTokenType {
  InputTriggerParam = 'inputTriggerParam',
  InputVar = 'inputVar',
  Linebreak = 'linebreak',
  RequiresPackVar = 'requiresPackVar',
  RequiresPackVarLine = 'requiresPackVarLine',
  RequiresVar = 'requiresVar',
  RequiresVarLine = 'requiresVarLine',
  SelectPackVar = 'selectPackVar',
  SelectTriggerParam = 'selectTriggerParam',
  SelectVar = 'selectVar',
  Text = 'text'
}

export type CrateTrigger = {
  __typename?: 'CrateTrigger';
  crate: Crate;
  crateId: Scalars['ID']['output'];
  crateOverrides?: Maybe<Array<CrateOverride>>;
  defaultPackOverrides?: Maybe<Array<PackOverride>>;
  id: Scalars['ID']['output'];
  trigger: Trigger;
  triggerId: Scalars['ID']['output'];
};

export type CrateTriggerInput = {
  crateId?: InputMaybe<Scalars['ID']['input']>;
  defaultPackOverrides?: InputMaybe<Array<PackOverrideInput>>;
  triggerId: Scalars['ID']['input'];
};

export type CrateTriggerUnpacking = {
  __typename?: 'CrateTriggerUnpacking';
  activateForOrgIds?: Maybe<Array<Scalars['ID']['output']>>;
  activateForTagIds?: Maybe<Array<Scalars['ID']['output']>>;
  autoActivateManagedOrgs: Scalars['Boolean']['output'];
  crateTrigger: CrateTrigger;
  crateUnpackingArgumentSet: CrateUnpackingArgumentSet;
  criteria?: Maybe<Scalars['JSON']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isActivatedForOwner: Scalars['Boolean']['output'];
  packOverrides: Array<PackOverride>;
  triggerName: Scalars['String']['output'];
};

export type CrateTriggerUnpackingInput = {
  activateForOrgIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  activateForTagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  autoActivateManagedOrgs: Scalars['Boolean']['input'];
  crateTriggerId: Scalars['ID']['input'];
  criteria?: InputMaybe<Scalars['JSON']['input']>;
  enabled: Scalars['Boolean']['input'];
  isActivatedForOwner: Scalars['Boolean']['input'];
  packOverrides?: InputMaybe<Array<PackOverrideInput>>;
  parameters?: InputMaybe<Scalars['JSON']['input']>;
  triggerName: Scalars['String']['input'];
};

export type CrateUnpackingArgument = {
  __typename?: 'CrateUnpackingArgument';
  crateToken: CrateToken;
  crateUnpackingArgumentSet: CrateUnpackingArgumentSet;
  id: Scalars['ID']['output'];
  value: Scalars['String']['output'];
};

export type CrateUnpackingArgumentInput = {
  crateTokenId: Scalars['ID']['input'];
  value: Scalars['String']['input'];
};

export type CrateUnpackingArgumentSet = {
  __typename?: 'CrateUnpackingArgumentSet';
  arguments: Array<CrateUnpackingArgument>;
  crate: Crate;
  crateId: Scalars['ID']['output'];
  crateTriggerUnpackings: Array<CrateTriggerUnpacking>;
  createdAt: Scalars['String']['output'];
  createdBy: User;
  createdById: Scalars['ID']['output'];
  humanSecondsSaved: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  orgId: Scalars['ID']['output'];
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
  workflowName: Scalars['String']['output'];
};

export type CrateUnpackingArgumentSetWhereInput = {
  crateId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
};

export type CrateUpdateInput = {
  associatedPacks?: InputMaybe<Array<Scalars['ID']['input']>>;
  category?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  gid?: InputMaybe<Scalars['ID']['input']>;
  id: Scalars['ID']['input'];
  isPublic?: InputMaybe<Scalars['Boolean']['input']>;
  lastPublishedAt?: InputMaybe<Scalars['String']['input']>;
  maturity?: InputMaybe<CrateMaturity>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  primaryPackId?: InputMaybe<Scalars['ID']['input']>;
  providedValue?: InputMaybe<Scalars['String']['input']>;
  replicationRegions?: InputMaybe<Array<CrateReplicationRegion>>;
  requiredOrgVariables?: InputMaybe<Array<Scalars['String']['input']>>;
  setupAssistance?: InputMaybe<Scalars['Boolean']['input']>;
  setupTime?: InputMaybe<Scalars['Int']['input']>;
  sourceEnvironment?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<CrateStatus>;
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  tokens?: InputMaybe<Array<CrateTokenInput>>;
  triggers?: InputMaybe<Array<CrateTriggerInput>>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type CrateUseCase = {
  __typename?: 'CrateUseCase';
  crate: Crate;
  crateId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  createdBy?: Maybe<User>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  updatedBy?: Maybe<User>;
};

export type CrateUseCaseInput = {
  crateId: Scalars['ID']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
};

export type CrateUseCaseSearchInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type CrateUseCaseWhereInput = {
  crateId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type CrateWhereInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  gid?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isPublic?: InputMaybe<Scalars['Boolean']['input']>;
  lastPublishedAt?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  primaryPack?: InputMaybe<PackWhereInput>;
  status?: InputMaybe<Scalars['String']['input']>;
  tokens?: InputMaybe<Scalars['JSON']['input']>;
  workflow?: InputMaybe<WorkflowWhereInput>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type CreateApiClientInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};

export type CreateComponentInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  isSynced?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  nodeTree: Scalars['JSON']['input'];
  orgId: Scalars['ID']['input'];
  workflows?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};

export type CreateFeaturePreviewSettingInput = {
  description: Scalars['String']['input'];
  isStaffOnly: Scalars['Boolean']['input'];
  label: Scalars['String']['input'];
};

export type CreateForeignObjectReferenceInput = {
  actionId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  identifier?: InputMaybe<Scalars['ID']['input']>;
  orgId: Scalars['ID']['input'];
  packConfigId?: InputMaybe<Scalars['ID']['input']>;
  referenceId: Scalars['ID']['input'];
  workflowExecutionId?: InputMaybe<Scalars['ID']['input']>;
};

export type CreateUserInput = {
  isTestUser?: InputMaybe<Scalars['Boolean']['input']>;
  orgId: Scalars['ID']['input'];
  roleIds: Array<Scalars['String']['input']>;
  username: Scalars['String']['input'];
};

export type DnsValidationResponse = {
  __typename?: 'DNSValidationResponse';
  isValid?: Maybe<Scalars['Boolean']['output']>;
  message?: Maybe<Scalars['String']['output']>;
};

export type DatabaseNotificationError = {
  __typename?: 'DatabaseNotificationError';
  detail: Scalars['String']['output'];
  raised_at: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type DeleteOrgInterpreterResponse = {
  __typename?: 'DeleteOrgInterpreterResponse';
  id: Scalars['ID']['output'];
};

export type DiffExplanationResponse = {
  __typename?: 'DiffExplanationResponse';
  markdown: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type DocumentationGenerationResponse = {
  __typename?: 'DocumentationGenerationResponse';
  markdown: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type DropdownOption = {
  __typename?: 'DropdownOption';
  label?: Maybe<Scalars['String']['output']>;
  value?: Maybe<Scalars['String']['output']>;
};

export type EncodedPageNodes = {
  __typename?: 'EncodedPageNodes';
  encoded: Scalars['String']['output'];
  faviconUrl?: Maybe<Scalars['String']['output']>;
  page?: Maybe<Page>;
};

export type ErrorMessage = {
  __typename?: 'ErrorMessage';
  error: Scalars['String']['output'];
};

export type EvaluatedFormWhereInput = {
  orgId: Scalars['ID']['input'];
  triggerId: Scalars['ID']['input'];
};

export enum ExecuteContextType {
  AppBuilder = 'APP_BUILDER'
}

export type ExportBundle = {
  __typename?: 'ExportBundle';
  exportedAt: Scalars['String']['output'];
  objects: Scalars['JSON']['output'];
  signing: Scalars['JSON']['output'];
  version: Scalars['Int']['output'];
};

export type ExportDownloadPhaseStreamFailureResponse = BaseCloningResponse & BaseStreamEvent & PhasedCloneEvent & {
  __typename?: 'ExportDownloadPhaseStreamFailureResponse';
  code?: Maybe<Scalars['String']['output']>;
  didSucceed: Scalars['Boolean']['output'];
  error: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
  phase: ClonePhase;
};

export type ExportDownloadPhaseStreamMessage = BaseStreamEvent & PhasedCloneEvent & {
  __typename?: 'ExportDownloadPhaseStreamMessage';
  bundle: ExportBundle;
  isFinished: Scalars['Boolean']['output'];
  phase: ClonePhase;
};

export type ExportErrorObject = {
  __typename?: 'ExportErrorObject';
  dependents: Array<ExportObjectIdentifier>;
  errors: Array<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  paths: Array<Array<ExportObjectIdentifier>>;
  type: Scalars['String']['output'];
};

export type ExportObjectIdentifier = {
  __typename?: 'ExportObjectIdentifier';
  displayName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isSignificant: Scalars['Boolean']['output'];
  type: Scalars['String']['output'];
};

export enum ExportObjectType {
  Crate = 'crate',
  Form = 'form',
  Page = 'page',
  Site = 'site',
  Template = 'template',
  Workflow = 'workflow'
}

export type ExportObjectsProgressMessage = {
  errors?: Maybe<Array<Scalars['String']['output']>>;
  failed: Scalars['Boolean']['output'];
  identity: ExportObjectIdentifier;
  object?: Maybe<IntermediateExportObject>;
  progress: ExportProgressInfo;
};

export type ExportObjectsStreamEvent = ExportObjectsStreamFailureResponse | ExportObjectsStreamMessage | ExportObjectsStreamSuccessResponse;

export type ExportObjectsStreamFailureResponse = BaseStreamEvent & BaseStreamResponse & {
  __typename?: 'ExportObjectsStreamFailureResponse';
  didSucceed: Scalars['Boolean']['output'];
  failures: Array<ExportErrorObject>;
  isFinished: Scalars['Boolean']['output'];
};

export type ExportObjectsStreamMessage = BaseStreamEvent & ExportObjectsProgressMessage & {
  __typename?: 'ExportObjectsStreamMessage';
  errors?: Maybe<Array<Scalars['String']['output']>>;
  failed: Scalars['Boolean']['output'];
  identity: ExportObjectIdentifier;
  isFinished: Scalars['Boolean']['output'];
  object?: Maybe<IntermediateExportObject>;
  progress: ExportProgressInfo;
};

export type ExportObjectsStreamSuccessResponse = BaseStreamEvent & BaseStreamResponse & {
  __typename?: 'ExportObjectsStreamSuccessResponse';
  bundle: ExportBundle;
  didSucceed: Scalars['Boolean']['output'];
  isFinished: Scalars['Boolean']['output'];
  recommendedFilename: Scalars['String']['output'];
};

export type ExportProgressInfo = {
  __typename?: 'ExportProgressInfo';
  hasEncounteredErrors: Scalars['Boolean']['output'];
  processedCount: Scalars['Int']['output'];
  queuedCount: Scalars['Int']['output'];
  totalCount: Scalars['Int']['output'];
};

export type ExportRequestObject = {
  id: Scalars['ID']['input'];
  type: ExportObjectType;
};

export type ExportResponse = {
  __typename?: 'ExportResponse';
  bundle?: Maybe<ExportBundle>;
  failures?: Maybe<Array<Maybe<ExportErrorObject>>>;
  recommendedFilename?: Maybe<Scalars['String']['output']>;
};

export type FeaturePreviewSetting = {
  __typename?: 'FeaturePreviewSetting';
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isStaffOnly: Scalars['Boolean']['output'];
  label: Scalars['String']['output'];
};

export type FeaturePreviewSettingWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  label?: InputMaybe<Scalars['String']['input']>;
};

export type FieldCondition = {
  __typename?: 'FieldCondition';
  action: FormConditionAction;
  actionValue?: Maybe<Scalars['String']['output']>;
  conditionType?: Maybe<Scalars['String']['output']>;
  field: FormField;
  fieldId: Scalars['ID']['output'];
  index?: Maybe<Scalars['Int']['output']>;
  requiredValue?: Maybe<Scalars['JSON']['output']>;
  sourceField?: Maybe<FormField>;
  sourceFieldId?: Maybe<Scalars['ID']['output']>;
};

export type File = {
  __typename?: 'File';
  filename: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  mimetype: Scalars['String']['output'];
  path: Scalars['String']['output'];
};

export type ForeignObjectReference = {
  __typename?: 'ForeignObjectReference';
  action?: Maybe<Action>;
  actionId?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  identifier?: Maybe<Scalars['ID']['output']>;
  orgId: Scalars['ID']['output'];
  organization: Organization;
  packConfig?: Maybe<PackConfig>;
  packConfigId?: Maybe<Scalars['ID']['output']>;
  referenceId: Scalars['ID']['output'];
  workflowExecution?: Maybe<WorkflowExecution>;
  workflowExecutionId?: Maybe<Scalars['ID']['output']>;
};

export type ForeignObjectReferenceInput = {
  action?: InputMaybe<ActionInput>;
  actionId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  identifier?: InputMaybe<Scalars['ID']['input']>;
  packConfig?: InputMaybe<PackConfigWhereInput>;
  packConfigId?: InputMaybe<Scalars['ID']['input']>;
  referenceId?: InputMaybe<Scalars['ID']['input']>;
  workflowExecution?: InputMaybe<WorkflowExecutionWhereInput>;
  workflowExecutionId?: InputMaybe<Scalars['ID']['input']>;
};

export type ForeignObjectReferenceWhereInput = {
  action?: InputMaybe<ActionInput>;
  actionId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  identifier?: InputMaybe<Scalars['ID']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  packConfig?: InputMaybe<PackConfigWhereInput>;
  packConfigId?: InputMaybe<Scalars['ID']['input']>;
  referenceId?: InputMaybe<Scalars['ID']['input']>;
  workflowExecution?: InputMaybe<WorkflowExecutionWhereInput>;
};

export type Form = {
  __typename?: 'Form';
  cloneOverrides?: Maybe<Scalars['JSON']['output']>;
  clonedFrom?: Maybe<Form>;
  clonedFromId?: Maybe<Scalars['ID']['output']>;
  clones?: Maybe<Array<Maybe<Form>>>;
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  createdById?: Maybe<Scalars['ID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  fields?: Maybe<Array<Maybe<FormField>>>;
  id: Scalars['ID']['output'];
  isSynchronized?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
  organization: Organization;
  tags: Array<Tag>;
  triggers?: Maybe<Array<Trigger>>;
  unpackedFrom?: Maybe<Crate>;
  unpackedFromId?: Maybe<Scalars['ID']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
  warrant?: Maybe<Warrant>;
};


export type FormFieldsArgs = {
  orgContextId?: InputMaybe<Scalars['ID']['input']>;
};

export type FormCloneOverridesInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export enum FormConditionAction {
  Hide = 'hide',
  Required = 'required',
  Set = 'set',
  Show = 'show'
}

export type FormCreateInput = {
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  fields?: InputMaybe<Array<FormFieldInput>>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
};

export type FormField = {
  __typename?: 'FormField';
  conditions: Array<FieldCondition>;
  createdAt?: Maybe<Scalars['String']['output']>;
  form?: Maybe<Form>;
  formId: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  index?: Maybe<Scalars['Int']['output']>;
  schema?: Maybe<Scalars['JSON']['output']>;
  sourceFields: Array<SourceField>;
  type?: Maybe<FormFieldType>;
};

export type FormFieldConditionInput = {
  action: FormConditionAction;
  actionValue?: InputMaybe<Scalars['String']['input']>;
  conditionType?: InputMaybe<Scalars['String']['input']>;
  fieldId?: InputMaybe<Scalars['ID']['input']>;
  index?: InputMaybe<Scalars['Int']['input']>;
  requiredValue?: InputMaybe<Scalars['JSON']['input']>;
  sourceFieldId?: InputMaybe<Scalars['ID']['input']>;
};

export type FormFieldInput = {
  conditions?: InputMaybe<Array<FormFieldConditionInput>>;
  formId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  index?: InputMaybe<Scalars['Int']['input']>;
  schema?: InputMaybe<Scalars['JSON']['input']>;
  type?: InputMaybe<FormFieldType>;
};

export type FormFieldInstanceInput = {
  formFieldId: Scalars['ID']['input'];
  schema?: InputMaybe<Scalars['JSON']['input']>;
};

export type FormFieldSearchInput = {
  formId?: InputMaybe<Id_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  index?: InputMaybe<Int_Comparison_Exp>;
  schema?: InputMaybe<Json_Comparison_Exp>;
  type?: InputMaybe<FormFieldTypeSearchInput>;
};

export enum FormFieldType {
  Checkbox = 'CHECKBOX',
  Date = 'DATE',
  FileInput = 'FILE_INPUT',
  MultilineInput = 'MULTILINE_INPUT',
  Multiselect = 'MULTISELECT',
  NumberInput = 'NUMBER_INPUT',
  Radio = 'RADIO',
  Select = 'SELECT',
  Text = 'TEXT',
  TextInput = 'TEXT_INPUT'
}

export type FormFieldTypeSearchInput = {
  _eq?: InputMaybe<FormFieldType>;
  _in?: InputMaybe<Array<FormFieldType>>;
  _neq?: InputMaybe<FormFieldType>;
  _nin?: InputMaybe<Array<FormFieldType>>;
  _substr?: InputMaybe<FormFieldType>;
};

export type FormFieldWhereInput = {
  formId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  index?: InputMaybe<Scalars['Int']['input']>;
  schema?: InputMaybe<Scalars['JSON']['input']>;
  type?: InputMaybe<FormFieldType>;
};

export type FormSearchInput = {
  clonedFromId?: InputMaybe<Id_Comparison_Exp>;
  createdBy?: InputMaybe<UserSearchInput>;
  id?: InputMaybe<Id_Comparison_Exp>;
  isSynchronized?: InputMaybe<Bool_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  organization?: InputMaybe<OrganizationSearchInput>;
  organizationId?: InputMaybe<Id_Comparison_Exp>;
  triggerId?: InputMaybe<Id_Comparison_Exp>;
  unpackedFromId?: InputMaybe<Id_Comparison_Exp>;
  updatedBy?: InputMaybe<UserSearchInput>;
};

export type FormUpdateInput = {
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  fields?: InputMaybe<Array<FormFieldInput>>;
  id: Scalars['ID']['input'];
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
};

export type FormWhereInput = {
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  triggerId?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  triggers?: InputMaybe<TriggerWhereInput>;
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
};

export type GetUserWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  isApiUser?: InputMaybe<Scalars['Boolean']['input']>;
  isSuperuser?: InputMaybe<Scalars['Boolean']['input']>;
  isTestUser?: InputMaybe<Scalars['Boolean']['input']>;
  managedOrgs?: InputMaybe<OrganizationWhereInput>;
  orgId: Scalars['ID']['input'];
  organization?: InputMaybe<OrganizationWhereInput>;
  roleIds?: InputMaybe<Array<Scalars['String']['input']>>;
  sub?: InputMaybe<Scalars['String']['input']>;
  username?: InputMaybe<Scalars['String']['input']>;
};

export type GrantDelegatedAccessInput = {
  expiresAt?: InputMaybe<Scalars['String']['input']>;
  organizationId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
  userId: Scalars['ID']['input'];
};

/** Enumeration for HTTP Methods. */
export enum HttpMethod {
  Delete = 'DELETE',
  Get = 'GET',
  Patch = 'PATCH',
  Post = 'POST',
  Put = 'PUT'
}

export type ImportBundle = {
  exportedAt: Scalars['String']['input'];
  objects: Scalars['JSON']['input'];
  signing: Scalars['JSON']['input'];
  version: Scalars['Int']['input'];
};

export type ImportBundleStreamEvent = ImportBundleStreamMessage | ImportBundleStreamResponse | ImportBundleStreamResponseError;

export type ImportBundleStreamMessage = BaseStreamEvent & ImportProgressMessage & {
  __typename?: 'ImportBundleStreamMessage';
  isFinished: Scalars['Boolean']['output'];
  object: ImportObject;
  progress: ImportProgressInfo;
};

export type ImportBundleStreamResponse = BaseStreamEvent & {
  __typename?: 'ImportBundleStreamResponse';
  isFinished: Scalars['Boolean']['output'];
  objects: Array<ImportObject>;
};

export type ImportBundleStreamResponseError = BaseStreamEvent & {
  __typename?: 'ImportBundleStreamResponseError';
  error: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type ImportObject = {
  __typename?: 'ImportObject';
  contentHash: Scalars['String']['output'];
  displayName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isSignificant: Scalars['Boolean']['output'];
  name?: Maybe<Scalars['String']['output']>;
  serializableKey: Scalars['String']['output'];
  type: Scalars['String']['output'];
  wasCreated: Scalars['Boolean']['output'];
};

export type ImportProgressInfo = {
  __typename?: 'ImportProgressInfo';
  importedCount: Scalars['Int']['output'];
  requestId?: Maybe<Scalars['String']['output']>;
  totalCount: Scalars['Int']['output'];
  weightedImportedCount: Scalars['Int']['output'];
  weightedTotalCount: Scalars['Int']['output'];
};

export type ImportProgressMessage = {
  object: ImportObject;
  progress: ImportProgressInfo;
};

export type Integration = {
  __typename?: 'Integration';
  /** Description of the integration */
  description?: Maybe<Scalars['String']['output']>;
  /** Icon url of the integration */
  iconUrl?: Maybe<Scalars['String']['output']>;
  /** Indicates if the integration is feature-flagged */
  isFeatureFlagged?: Maybe<Scalars['Boolean']['output']>;
  /** Indicates if the integration should not be seen by the public */
  isPublic?: Maybe<Scalars['Boolean']['output']>;
  /** Name of the integration */
  name?: Maybe<Scalars['String']['output']>;
  /** Number of integration installations made by organizations */
  numInstalled?: Maybe<Scalars['Int']['output']>;
  /** Reference tag */
  tags?: Maybe<Array<IntegrationTag>>;
};

export type IntegrationTag = {
  __typename?: 'IntegrationTag';
  name?: Maybe<Scalars['String']['output']>;
};

export type IntegrationWorkflowOutput = {
  __typename?: 'IntegrationWorkflowOutput';
  description?: Maybe<Scalars['String']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  name?: Maybe<Scalars['String']['output']>;
};

export type IntermediateExportObject = {
  __typename?: 'IntermediateExportObject';
  contentHash: Scalars['String']['output'];
  fields: Scalars['JSON']['output'];
  isSignificant: Scalars['Boolean']['output'];
  name?: Maybe<Scalars['String']['output']>;
  nonfunctionalFields?: Maybe<Scalars['JSON']['output']>;
  serializableKey?: Maybe<Scalars['String']['output']>;
  type: Scalars['String']['output'];
};

export type InterpreterVersion = {
  __typename?: 'InterpreterVersion';
  id: Scalars['ID']['output'];
  language: Scalars['String']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  version: Scalars['String']['output'];
};

export type JParserConversionResult = {
  __typename?: 'JParserConversionResult';
  actions?: Maybe<Scalars['JSON']['output']>;
  auth_config?: Maybe<Scalars['JSON']['output']>;
  categories?: Maybe<Scalars['JSON']['output']>;
  config_schema?: Maybe<Scalars['JSON']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  errors?: Maybe<Scalars['JSON']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  pack_config?: Maybe<Scalars['JSON']['output']>;
  ref?: Maybe<Scalars['String']['output']>;
  version?: Maybe<Scalars['String']['output']>;
};

export type Jinja2Documentation = {
  __typename?: 'Jinja2Documentation';
  description?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  parameters?: Maybe<Array<Jinja2ParameterDocumentation>>;
  signature?: Maybe<Scalars['String']['output']>;
};

export type Jinja2ParameterDocumentation = {
  __typename?: 'Jinja2ParameterDocumentation';
  default?: Maybe<Scalars['JSON']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  required?: Maybe<Scalars['Boolean']['output']>;
  type?: Maybe<Scalars['String']['output']>;
};

export type JinjaRenderSession = {
  __typename?: 'JinjaRenderSession';
  context?: Maybe<Scalars['JSON']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  result?: Maybe<Scalars['JSON']['output']>;
  template?: Maybe<Scalars['String']['output']>;
};

export type JinjaTemplateMapInput = {
  id: Scalars['String']['input'];
  template: Scalars['String']['input'];
};

export type JobRequestedResponse = {
  __typename?: 'JobRequestedResponse';
  executionId: Scalars['ID']['output'];
};

export enum Loader {
  Bar = 'Bar',
  Beat = 'Beat',
  Bounce = 'Bounce',
  Clip = 'Clip',
  Dot = 'Dot',
  Fade = 'Fade',
  Grid = 'Grid',
  Moon = 'Moon',
  Pacman = 'Pacman',
  Propagate = 'Propagate',
  Puff = 'Puff',
  Pulse = 'Pulse',
  Scale = 'Scale',
  Sync = 'Sync'
}

export enum LocalReferenceModel {
  Crate = 'Crate',
  CustomDatabase = 'CustomDatabase',
  Form = 'Form',
  Organization = 'Organization',
  PackConfig = 'PackConfig',
  Page = 'Page',
  Role = 'Role',
  Site = 'Site',
  Template = 'Template',
  TemplateExport = 'TemplateExport',
  Trigger = 'Trigger',
  User = 'User',
  Workflow = 'Workflow'
}

export type Login = {
  __typename?: 'Login';
  /** Custom Domain, if present */
  customDomain?: Maybe<Scalars['String']['output']>;
  /** Name of the Domain */
  domain?: Maybe<Scalars['String']['output']>;
  /** Favorite icon URL */
  faviconUrl?: Maybe<Scalars['String']['output']>;
  /** Login page layout */
  layout?: Maybe<Scalars['String']['output']>;
  /** Login page loader enum */
  loader?: Maybe<Scalars['String']['output']>;
  /** Page Title */
  pageTitle?: Maybe<Scalars['String']['output']>;
  /** Site wide theme */
  theme?: Maybe<Scalars['JSON']['output']>;
  /** Whether to use the custom domain */
  useCustomDomain?: Maybe<Scalars['Boolean']['output']>;
};

export type MessageVoteStats = {
  __typename?: 'MessageVoteStats';
  downVotes: Scalars['Int']['output'];
  reasonCounts: Array<ReasonCount>;
  upVotes: Scalars['Int']['output'];
};

export type MicrosoftBundleAuthorizationRequestStreamEvent = MicrosoftBundleAuthorizationStreamFailureResponse | MicrosoftBundleAuthorizationStreamMessage | MicrosoftBundleAuthorizationStreamSuccessResponse;

export type MicrosoftBundleAuthorizationStreamFailureResponse = BaseStreamEvent & {
  __typename?: 'MicrosoftBundleAuthorizationStreamFailureResponse';
  didSucceed: Scalars['Boolean']['output'];
  error: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type MicrosoftBundleAuthorizationStreamMessage = BaseStreamEvent & {
  __typename?: 'MicrosoftBundleAuthorizationStreamMessage';
  isFinished: Scalars['Boolean']['output'];
  phase: Scalars['String']['output'];
  warning?: Maybe<Scalars['String']['output']>;
};

export type MicrosoftBundleAuthorizationStreamSuccessResponse = BaseStreamEvent & {
  __typename?: 'MicrosoftBundleAuthorizationStreamSuccessResponse';
  didSucceed: Scalars['Boolean']['output'];
  isFinished: Scalars['Boolean']['output'];
  phase: Scalars['String']['output'];
};

export type MicrosoftCspConsentRequestStreamEvent = MicrosoftCspConsentStreamFailureResponse | MicrosoftCspConsentStreamMessage | MicrosoftCspConsentStreamSuccessResponse;

export type MicrosoftCspConsentStreamFailureResponse = BaseMicrosoftCspConsentResponse & BaseStreamEvent & {
  __typename?: 'MicrosoftCSPConsentStreamFailureResponse';
  didSucceed: Scalars['Boolean']['output'];
  errors?: Maybe<Array<Scalars['String']['output']>>;
  event: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type MicrosoftCspConsentStreamMessage = BaseMicrosoftCspConsentResponse & BaseStreamEvent & {
  __typename?: 'MicrosoftCSPConsentStreamMessage';
  action?: Maybe<CspConsentAction>;
  errors?: Maybe<Array<Scalars['String']['output']>>;
  event: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
  updatedTenantIds?: Maybe<Array<Scalars['ID']['output']>>;
};

export type MicrosoftCspConsentStreamSuccessResponse = BaseMicrosoftCspConsentResponse & BaseStreamEvent & {
  __typename?: 'MicrosoftCSPConsentStreamSuccessResponse';
  didSucceed: Scalars['Boolean']['output'];
  event: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type MicrosoftCspCustomer = {
  __typename?: 'MicrosoftCSPCustomer';
  companyName: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  cspTenantId: Scalars['String']['output'];
  hasConsent: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  linkedOrganizations?: Maybe<Array<Organization>>;
  tenantId: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
};

export type MicrosoftCspCustomerSearchInput = {
  companyName?: InputMaybe<String_Comparison_Exp>;
  cspTenantId?: InputMaybe<String_Comparison_Exp>;
  hasConsent?: InputMaybe<Bool_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  linkedOrganizations?: InputMaybe<OrganizationSearchInput>;
  tenantId?: InputMaybe<String_Comparison_Exp>;
};

export type MicrosoftCspCustomerWhereInput = {
  companyName?: InputMaybe<Scalars['String']['input']>;
  cspTenantId?: InputMaybe<Scalars['String']['input']>;
  hasConsent?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  linkedOrganizations?: InputMaybe<OrganizationWhereInput>;
  tenantId?: InputMaybe<Scalars['String']['input']>;
};

export type MonacoCompletionItem = {
  __typename?: 'MonacoCompletionItem';
  commitCharacters?: Maybe<Array<Scalars['String']['output']>>;
  detail?: Maybe<Scalars['String']['output']>;
  documentation?: Maybe<MonacoMarkdownString>;
  insertText: Scalars['String']['output'];
  kind: Scalars['Int']['output'];
  label: MonacoCompletionItemLabel;
};

export type MonacoCompletionItemLabel = {
  __typename?: 'MonacoCompletionItemLabel';
  description?: Maybe<Scalars['String']['output']>;
  detail?: Maybe<Scalars['String']['output']>;
  label: Scalars['String']['output'];
};

export type MonacoMarkdownString = {
  __typename?: 'MonacoMarkdownString';
  value: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  addFavoriteAction?: Maybe<Scalars['Void']['output']>;
  adminCreateIntegrationTestWorkflow?: Maybe<IntegrationWorkflowOutput>;
  adminCreateOrUpdatePack?: Maybe<Pack>;
  adminCreateOrUpdatePackBundle?: Maybe<PackBundle>;
  bulkCreateOrganizations: Array<Organization>;
  bulkDeleteOrganizations?: Maybe<Scalars['Void']['output']>;
  bulkSetWorkflowTags: Array<Workflow>;
  bulkUpdateOrganizationFeaturePreviewSettingByLabel: Array<OrganizationFeaturePreviewSetting>;
  clearWorkflowOutputs?: Maybe<Scalars['Void']['output']>;
  createActionOptions?: Maybe<Array<Maybe<ActionOption>>>;
  createAppPlatformReservedDomain?: Maybe<AppPlatformReservedDomain>;
  createComponent?: Maybe<Component>;
  createComponentInstance?: Maybe<ComponentInstanceResult>;
  createConversation: Conversation;
  createConversationMessage: ConversationMessage;
  createConversationMessageVote: ConversationMessageVote;
  createCrate?: Maybe<Crate>;
  createCrateOverride?: Maybe<CrateOverride>;
  createCrateOverrideOption?: Maybe<CrateOverrideOption>;
  createFeaturePreviewSetting?: Maybe<FeaturePreviewSetting>;
  createForeignObjectReference?: Maybe<ForeignObjectReference>;
  createForm?: Maybe<Form>;
  createMicrosoftCSPCustomer: MicrosoftCspCustomer;
  createOrUpdateForeignObjectReference?: Maybe<ForeignObjectReference>;
  createOrUpdateOnboardingQuestionnaireResponse?: Maybe<OnboardingQuestionnaireResponse>;
  createOrUpdateOrgSupportAccess?: Maybe<Array<Maybe<OrgSupportAccess>>>;
  createOrUpdateOrganizationOnboardingRequirement?: Maybe<OrganizationOnboardingRequirement>;
  createOrgForCSPCustomer: Organization;
  createOrgVariable?: Maybe<OrgVariable>;
  createOrganization?: Maybe<Organization>;
  createOrganizationApiClient: ApiClientWithSecret;
  createOrganizations?: Maybe<Array<Maybe<Organization>>>;
  createPack?: Maybe<Pack>;
  createPackConfig?: Maybe<PackConfig>;
  createPage?: Maybe<Page>;
  createPermission: Permission;
  createReservedOrganizationName?: Maybe<ReservedOrganizationName>;
  createRole: Role;
  createSite?: Maybe<Site>;
  createTag: Tag;
  createTaskLog?: Maybe<TaskLog>;
  createTemplate?: Maybe<Template>;
  createTrigger?: Maybe<Trigger>;
  createUser?: Maybe<User>;
  createUserInvite?: Maybe<UserInvite>;
  createWorkflow?: Maybe<Workflow>;
  createWorkflowCompletionListener?: Maybe<Trigger>;
  createWorkflowPatch: WorkflowPatch;
  debug?: Maybe<Scalars['Boolean']['output']>;
  deleteAppPlatformReservedDomain?: Maybe<Scalars['Void']['output']>;
  deleteComponent?: Maybe<Scalars['Boolean']['output']>;
  deleteComponentInstance: Scalars['Boolean']['output'];
  deleteConversation: Scalars['ID']['output'];
  deleteConversationMessageVote: Scalars['ID']['output'];
  deleteCrate?: Maybe<Scalars['ID']['output']>;
  deleteCrateOverride?: Maybe<Scalars['Boolean']['output']>;
  deleteCrateOverrideOption?: Maybe<Scalars['Boolean']['output']>;
  deleteFeaturePreviewSetting?: Maybe<Scalars['Void']['output']>;
  deleteForm?: Maybe<Scalars['Void']['output']>;
  deleteMicrosoftCSPCustomer?: Maybe<Scalars['Void']['output']>;
  deleteMicrosoftCSPCustomerById?: Maybe<Scalars['Void']['output']>;
  deleteOrgFormFieldInstance: Scalars['Boolean']['output'];
  deleteOrgInterpreterSetting?: Maybe<DeleteOrgInterpreterResponse>;
  deleteOrgSupportAccess?: Maybe<Scalars['Void']['output']>;
  deleteOrgVariable?: Maybe<Scalars['ID']['output']>;
  deleteOrganization?: Maybe<Scalars['Void']['output']>;
  deleteOrganizationApiClient: Scalars['Boolean']['output'];
  deletePack?: Maybe<PackDeleteResponse>;
  deletePackConfig?: Maybe<Scalars['Void']['output']>;
  deletePage?: Maybe<Scalars['Void']['output']>;
  deletePermission?: Maybe<Scalars['ID']['output']>;
  deleteReservedOrganizationName?: Maybe<Scalars['Int']['output']>;
  deleteRole?: Maybe<Scalars['ID']['output']>;
  deleteSite?: Maybe<Scalars['Void']['output']>;
  deleteTag?: Maybe<Scalars['ID']['output']>;
  deleteTemplate?: Maybe<Scalars['ID']['output']>;
  deleteTrigger?: Maybe<Scalars['ID']['output']>;
  deleteUser?: Maybe<Scalars['Void']['output']>;
  deleteUserInvite?: Maybe<Scalars['Boolean']['output']>;
  deleteWorkflow?: Maybe<Scalars['ID']['output']>;
  deleteWorkflowCompletionListener?: Maybe<Scalars['Void']['output']>;
  deleteWorkflowExecution?: Maybe<Scalars['Boolean']['output']>;
  deleteWorkflowPatch?: Maybe<Scalars['Void']['output']>;
  deleteWorkflows?: Maybe<Array<Maybe<Scalars['ID']['output']>>>;
  duplicateComponent?: Maybe<Component>;
  findAndDeleteUserInvite?: Maybe<Scalars['Int']['output']>;
  generateComponent: ComponentGeneratorResponse;
  generateDiffExplanation: DiffExplanationResponse;
  generateDocumentation: DocumentationGenerationResponse;
  generatePackOrBundleAuthUrl?: Maybe<AuthUrlResponse>;
  generateThemeConfig: ThemeConfigGeneratorResponse;
  getPackInstallations?: Maybe<PackInstalledByResponse>;
  getPackPageUrl?: Maybe<Scalars['String']['output']>;
  grantDelegatedAccess: UserDelegatedAccess;
  installPack?: Maybe<Organization>;
  killConversation: Scalars['Boolean']['output'];
  killWorkflowExecution?: Maybe<Scalars['JSON']['output']>;
  linkMicrosoftCSPCustomer: MicrosoftCspCustomer;
  /** @deprecated Replaced with microsoftCSPConsentRequest subscription */
  modifyCSPConsent: CspConsentResult;
  openaiCompletionItems: OpenAiResponse;
  reassignCSPCustomer: MicrosoftCspCustomer;
  refetchPackConfigRefOptions?: Maybe<JobRequestedResponse>;
  removeFavoriteAction?: Maybe<Scalars['Void']['output']>;
  renderJinja?: Maybe<Scalars['JSON']['output']>;
  restoreOrganization: Organization;
  revertTriggerPatch: Scalars['JSON']['output'];
  revertWorkflowPatch: Scalars['JSON']['output'];
  revokeDelegatedAccess: Scalars['Boolean']['output'];
  rotateApiClientSecret: ApiClientSecretRotation;
  runTriggerWithMCP?: Maybe<JobRequestedResponse>;
  runWorkflowForOptions?: Maybe<WorkflowOptionsResponse>;
  setFavoriteActions: Array<UserFavoriteAction>;
  setFormTags?: Maybe<Form>;
  /** @deprecated Replaced with linkMicrosoftCSPCustomer and unlinkMicrosoftCSPCustomer mutations */
  setManagedOrgGraphTenantId?: Maybe<ForeignObjectReference>;
  setOrgFormFieldInstanceStatuses: Scalars['Boolean']['output'];
  setOrganizationTags?: Maybe<Organization>;
  setTestUserSession?: Maybe<Scalars['Void']['output']>;
  shallowCloneForm?: Maybe<Form>;
  shallowCloneSite?: Maybe<Site>;
  shallowCloneTemplate?: Maybe<Template>;
  shallowCloneWorkflow?: Maybe<Workflow>;
  skipOrganizationOnboardingCrateRequirement?: Maybe<OrganizationOnboardingCrateRequirement>;
  skipOrganizationOnboardingPackRequirement?: Maybe<OrganizationOnboardingPackRequirement>;
  stopTestUserSession?: Maybe<Scalars['Void']['output']>;
  submitForm?: Maybe<Scalars['JSON']['output']>;
  submitPendingTaskResponse?: Maybe<Scalars['JSON']['output']>;
  submitPendingTaskResponses?: Maybe<Scalars['JSON']['output']>;
  suggestCSPCustomerMatches?: Maybe<Scalars['JSON']['output']>;
  suggestOrgVarMatches?: Maybe<Scalars['JSON']['output']>;
  swaggerToOpenapiConversion: SwaggerToOpenapiConversionResult;
  synchronizePackBundleConfigs: Array<SynchronizedPackConfig>;
  testPackConfig?: Maybe<JobRequestedResponse>;
  testWorkflow?: Maybe<JobRequestedResponse>;
  testWorkflowTrigger?: Maybe<JobRequestedResponse>;
  trackWorkflowEvent?: Maybe<Scalars['Void']['output']>;
  uninstallPack?: Maybe<Scalars['Void']['output']>;
  uninstallPackBundle?: Maybe<Scalars['Void']['output']>;
  unlinkClone?: Maybe<Scalars['ID']['output']>;
  unlinkMicrosoftCSPCustomer?: Maybe<Scalars['Void']['output']>;
  unsyncClone?: Maybe<Scalars['ID']['output']>;
  updateAppPlatformReservedDomain?: Maybe<AppPlatformReservedDomain>;
  updateComponent?: Maybe<Component>;
  updateComponentInstance: ComponentInstance;
  updateConversation: Conversation;
  updateConversationMessageVote: ConversationMessageVote;
  updateCrate?: Maybe<Crate>;
  updateCrateOverride?: Maybe<CrateOverride>;
  updateCrateOverrideOption?: Maybe<CrateOverrideOption>;
  updateFeaturePreviewSetting?: Maybe<FeaturePreviewSetting>;
  updateForm?: Maybe<Form>;
  updateFormOverrides?: Maybe<Form>;
  updateManagedAndSubOrganizations?: Maybe<Scalars['Int']['output']>;
  updateMicrosoftCSPCustomer: MicrosoftCspCustomer;
  updateOrgTriggerInstance?: Maybe<OrgTriggerInstance>;
  updateOrgVariables: Array<OrgVariable>;
  updateOrganization?: Maybe<Organization>;
  updateOrganizationApiClient: ApiClient;
  updateOrganizationFeaturePreviewSetting?: Maybe<OrganizationFeaturePreviewSetting>;
  updatePack?: Maybe<Pack>;
  updatePackConfig?: Maybe<PackConfig>;
  updatePackConfigs: Array<PackConfig>;
  updatePage?: Maybe<Page>;
  updatePageNode?: Maybe<PageNode>;
  updatePageNodeByCraftId?: Maybe<PageNode>;
  updatePermission: Permission;
  updateReservedOrganizationName?: Maybe<ReservedOrganizationName>;
  updateRole: Role;
  updateSite?: Maybe<Site>;
  updateSites: Array<Site>;
  updateTag: Tag;
  updateTags: Array<Tag>;
  updateTemplate?: Maybe<Template>;
  updateTrigger?: Maybe<Trigger>;
  updateUserInviteRoles?: Maybe<UserInvite>;
  updateUserPreferences: User;
  updateUserRoles?: Maybe<User>;
  updateWorkflow?: Maybe<Workflow>;
  updateWorkflowCompletionListener?: Maybe<Trigger>;
  upsertOrgFormFieldInstances: Array<OrgFormFieldInstance>;
  upsertOrgInterpreterSetting?: Maybe<OrgInterpreterSetting>;
  validateSiteCustomDomainDNS?: Maybe<DnsValidationResponse>;
};


export type MutationAddFavoriteActionArgs = {
  actionId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationAdminCreateIntegrationTestWorkflowArgs = {
  includeFakeData?: InputMaybe<Scalars['Boolean']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  packId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationAdminCreateOrUpdatePackArgs = {
  actions?: InputMaybe<Array<Scalars['Upload']['input']>>;
  configSchema?: InputMaybe<Scalars['Upload']['input']>;
  isDryRun?: InputMaybe<Scalars['Boolean']['input']>;
  migrations?: InputMaybe<Array<Scalars['Upload']['input']>>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  pack?: InputMaybe<Scalars['Upload']['input']>;
  sensorTypes?: InputMaybe<Array<Scalars['Upload']['input']>>;
};


export type MutationAdminCreateOrUpdatePackBundleArgs = {
  configSchema?: InputMaybe<Scalars['Upload']['input']>;
  isDryRun?: InputMaybe<Scalars['Boolean']['input']>;
  packBundle?: InputMaybe<Scalars['Upload']['input']>;
};


export type MutationBulkCreateOrganizationsArgs = {
  organizations: Array<OrganizationInput>;
};


export type MutationBulkDeleteOrganizationsArgs = {
  organizationIds: Array<Scalars['ID']['input']>;
};


export type MutationBulkSetWorkflowTagsArgs = {
  tagIds: Array<Scalars['ID']['input']>;
  workflowIds: Array<Scalars['ID']['input']>;
};


export type MutationBulkUpdateOrganizationFeaturePreviewSettingByLabelArgs = {
  isEnabled: Scalars['Boolean']['input'];
  label: Scalars['String']['input'];
  orgIds: Array<Scalars['ID']['input']>;
};


export type MutationClearWorkflowOutputsArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCreateActionOptionsArgs = {
  actionOptions: Array<ActionOptionInput>;
  replace?: InputMaybe<Scalars['Boolean']['input']>;
};


export type MutationCreateAppPlatformReservedDomainArgs = {
  reservedDomain: AppPlatformReservedDomainCreateInput;
};


export type MutationCreateComponentArgs = {
  component: CreateComponentInput;
};


export type MutationCreateComponentInstanceArgs = {
  input: ComponentInstanceCreateInput;
};


export type MutationCreateConversationArgs = {
  conversation: ConversationInput;
};


export type MutationCreateConversationMessageArgs = {
  message: ConversationMessageInput;
};


export type MutationCreateConversationMessageVoteArgs = {
  vote: ConversationMessageVoteInput;
};


export type MutationCreateCrateArgs = {
  crate: CrateCreateInput;
};


export type MutationCreateCrateOverrideArgs = {
  crateOverride: CrateOverrideInput;
};


export type MutationCreateCrateOverrideOptionArgs = {
  option: CrateOverrideOptionInput;
};


export type MutationCreateFeaturePreviewSettingArgs = {
  featurePreviewSetting?: InputMaybe<CreateFeaturePreviewSettingInput>;
};


export type MutationCreateForeignObjectReferenceArgs = {
  foreignObjectReference?: InputMaybe<CreateForeignObjectReferenceInput>;
};


export type MutationCreateFormArgs = {
  form: FormCreateInput;
};


export type MutationCreateMicrosoftCspCustomerArgs = {
  companyName: Scalars['String']['input'];
  cspPackConfigId: Scalars['ID']['input'];
  cspTenantId: Scalars['String']['input'];
  tenantId: Scalars['String']['input'];
};


export type MutationCreateOrUpdateForeignObjectReferenceArgs = {
  foreignObjectReference?: InputMaybe<CreateForeignObjectReferenceInput>;
};


export type MutationCreateOrUpdateOnboardingQuestionnaireResponseArgs = {
  onboardingQuestionnaireResponse: OnboardingQuestionnaireResponseInput;
};


export type MutationCreateOrUpdateOrgSupportAccessArgs = {
  orgSupportAccess: OrgSupportAccessInput;
};


export type MutationCreateOrUpdateOrganizationOnboardingRequirementArgs = {
  organizationOnboardingRequirement: OrganizationOnboardingRequirementInput;
};


export type MutationCreateOrgForCspCustomerArgs = {
  cspPackConfigId: Scalars['ID']['input'];
  organization: OrganizationInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateOrgVariableArgs = {
  orgVariable: OrgVariableCreateInput;
};


export type MutationCreateOrganizationArgs = {
  organization?: InputMaybe<OrganizationInput>;
};


export type MutationCreateOrganizationApiClientArgs = {
  input: CreateApiClientInput;
};


export type MutationCreateOrganizationsArgs = {
  organizations: Array<OrganizationInput>;
};


export type MutationCreatePackArgs = {
  pack: PackCreateInput;
};


export type MutationCreatePackConfigArgs = {
  packConfig: PackConfigCreateInput;
};


export type MutationCreatePageArgs = {
  nodes?: InputMaybe<Array<InputMaybe<PageNodeInput>>>;
  page: PageCreateInput;
  preset?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreatePermissionArgs = {
  permission: PermissionCreateInput;
};


export type MutationCreateReservedOrganizationNameArgs = {
  name: Scalars['String']['input'];
};


export type MutationCreateRoleArgs = {
  role: RoleCreateInput;
};


export type MutationCreateSiteArgs = {
  site: SiteCreateInput;
};


export type MutationCreateTagArgs = {
  tag: TagCreateInput;
};


export type MutationCreateTaskLogArgs = {
  taskLog: TaskLogInput;
};


export type MutationCreateTemplateArgs = {
  template: TemplateCreateInput;
};


export type MutationCreateTriggerArgs = {
  createPatch?: InputMaybe<Scalars['Boolean']['input']>;
  trigger: TriggerCreateInput;
};


export type MutationCreateUserArgs = {
  user: CreateUserInput;
};


export type MutationCreateUserInviteArgs = {
  invite: UserInviteCreateInput;
};


export type MutationCreateWorkflowArgs = {
  workflow: WorkflowInput;
};


export type MutationCreateWorkflowCompletionListenerArgs = {
  listener: CompletionListenerCreateInput;
};


export type MutationCreateWorkflowPatchArgs = {
  comment: Scalars['String']['input'];
  commentDescription?: InputMaybe<Scalars['String']['input']>;
  foreignId?: InputMaybe<Scalars['ID']['input']>;
  patch: Scalars['JSON']['input'];
  patchType: PatchType;
  workflowId: Scalars['ID']['input'];
};


export type MutationDeleteAppPlatformReservedDomainArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteComponentArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteComponentInstanceArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteConversationArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteConversationMessageVoteArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCrateArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCrateOverrideArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCrateOverrideOptionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteFeaturePreviewSettingArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteFormArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteMicrosoftCspCustomerArgs = {
  cspPackConfigId: Scalars['ID']['input'];
  customerId: Scalars['ID']['input'];
};


export type MutationDeleteMicrosoftCspCustomerByIdArgs = {
  customerId: Scalars['ID']['input'];
};


export type MutationDeleteOrgFormFieldInstanceArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteOrgInterpreterSettingArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteOrgSupportAccessArgs = {
  orgId: Scalars['ID']['input'];
};


export type MutationDeleteOrgVariableArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteOrganizationArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteOrganizationApiClientArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeletePackArgs = {
  packId: Scalars['ID']['input'];
};


export type MutationDeletePackConfigArgs = {
  id: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
};


export type MutationDeletePageArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeletePermissionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteReservedOrganizationNameArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteRoleArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteSiteArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteTagArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteTemplateArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteTriggerArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteUserArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteUserInviteArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteWorkflowArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteWorkflowCompletionListenerArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteWorkflowExecutionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteWorkflowPatchArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteWorkflowsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDuplicateComponentArgs = {
  id: Scalars['ID']['input'];
};


export type MutationFindAndDeleteUserInviteArgs = {
  email: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};


export type MutationGenerateComponentArgs = {
  code?: InputMaybe<Scalars['String']['input']>;
  configName: ConfigName;
  prompt: Scalars['String']['input'];
};


export type MutationGenerateDiffExplanationArgs = {
  modified: Scalars['JSON']['input'];
  original: Scalars['JSON']['input'];
};


export type MutationGenerateDocumentationArgs = {
  tasks: Array<InputMaybe<Scalars['JSON']['input']>>;
};


export type MutationGeneratePackOrBundleAuthUrlArgs = {
  extra?: InputMaybe<Scalars['JSON']['input']>;
  orgId: Scalars['ID']['input'];
  packBundleId?: InputMaybe<Scalars['ID']['input']>;
  packConfigId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationGenerateThemeConfigArgs = {
  code?: InputMaybe<Scalars['String']['input']>;
  configName: ConfigName;
  prompt: Scalars['String']['input'];
};


export type MutationGetPackInstallationsArgs = {
  packId: Scalars['ID']['input'];
};


export type MutationGetPackPageUrlArgs = {
  integrationRef: Scalars['String']['input'];
  pagePath: Scalars['String']['input'];
};


export type MutationGrantDelegatedAccessArgs = {
  input: GrantDelegatedAccessInput;
};


export type MutationInstallPackArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
  packId: Scalars['ID']['input'];
};


export type MutationKillConversationArgs = {
  id: Scalars['ID']['input'];
};


export type MutationKillWorkflowExecutionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationLinkMicrosoftCspCustomerArgs = {
  cspPackConfigId: Scalars['ID']['input'];
  customerId: Scalars['ID']['input'];
  orgIds: Array<Scalars['ID']['input']>;
};


export type MutationModifyCspConsentArgs = {
  action?: InputMaybe<CspConsentAction>;
  applicationGrants?: InputMaybe<Array<CspApplicationGrant>>;
  packConfigId: Scalars['ID']['input'];
  tenantIds: Array<Scalars['ID']['input']>;
};


export type MutationOpenaiCompletionItemsArgs = {
  autocompleteOptions: Scalars['JSON']['input'];
  textUntilPosition: Scalars['String']['input'];
};


export type MutationReassignCspCustomerArgs = {
  cspTenantId: Scalars['ID']['input'];
  customerId: Scalars['ID']['input'];
};


export type MutationRefetchPackConfigRefOptionsArgs = {
  packConfigId: Scalars['ID']['input'];
  reference?: InputMaybe<Scalars['JSON']['input']>;
};


export type MutationRemoveFavoriteActionArgs = {
  actionId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationRenderJinjaArgs = {
  orgId: Scalars['ID']['input'];
  principalOrgId?: InputMaybe<Scalars['ID']['input']>;
  template: Scalars['String']['input'];
  triggerId?: InputMaybe<Scalars['ID']['input']>;
  vars?: InputMaybe<Scalars['JSON']['input']>;
};


export type MutationRestoreOrganizationArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRevertTriggerPatchArgs = {
  foreignId: Scalars['ID']['input'];
  patchId: Scalars['ID']['input'];
  workflowId: Scalars['ID']['input'];
};


export type MutationRevertWorkflowPatchArgs = {
  foreignId?: InputMaybe<Scalars['ID']['input']>;
  patchId: Scalars['ID']['input'];
  workflowId: Scalars['ID']['input'];
};


export type MutationRevokeDelegatedAccessArgs = {
  organizationId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationRotateApiClientSecretArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRunTriggerWithMcpArgs = {
  input?: InputMaybe<Scalars['JSON']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  workflowId: Scalars['ID']['input'];
};


export type MutationRunWorkflowForOptionsArgs = {
  input: Scalars['JSON']['input'];
  inputContext: Scalars['JSON']['input'];
  orgId: Scalars['ID']['input'];
  skipCache?: InputMaybe<Scalars['Boolean']['input']>;
  triggerId?: InputMaybe<Scalars['ID']['input']>;
  workflowId: Scalars['ID']['input'];
};


export type MutationSetFavoriteActionsArgs = {
  favoriteActions: Array<UserFavoriteActionInput>;
  userId: Scalars['ID']['input'];
};


export type MutationSetFormTagsArgs = {
  form: SetFormTagsInput;
};


export type MutationSetManagedOrgGraphTenantIdArgs = {
  orgId: Scalars['ID']['input'];
  tenantId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationSetOrgFormFieldInstanceStatusesArgs = {
  formId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  status: Scalars['Boolean']['input'];
};


export type MutationSetOrganizationTagsArgs = {
  orgId: Scalars['ID']['input'];
  tagIds: Array<Scalars['ID']['input']>;
};


export type MutationSetTestUserSessionArgs = {
  userId: Scalars['ID']['input'];
};


export type MutationShallowCloneFormArgs = {
  id: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  overrides?: InputMaybe<ShallowCloneOverridesInput>;
};


export type MutationShallowCloneSiteArgs = {
  id: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  overrides?: InputMaybe<ShallowCloneOverridesInput>;
};


export type MutationShallowCloneTemplateArgs = {
  id: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  overrides?: InputMaybe<ShallowCloneOverridesInput>;
};


export type MutationShallowCloneWorkflowArgs = {
  id: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  overrides?: InputMaybe<ShallowCloneOverridesInput>;
};


export type MutationSkipOrganizationOnboardingCrateRequirementArgs = {
  id: Scalars['ID']['input'];
  skip: Scalars['Boolean']['input'];
};


export type MutationSkipOrganizationOnboardingPackRequirementArgs = {
  id: Scalars['ID']['input'];
  skip: Scalars['Boolean']['input'];
};


export type MutationSubmitFormArgs = {
  id: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  triggerId: Scalars['ID']['input'];
  values: Scalars['JSON']['input'];
};


export type MutationSubmitPendingTaskResponseArgs = {
  orgId?: InputMaybe<Scalars['ID']['input']>;
  pendingTaskId: Scalars['ID']['input'];
  values: Scalars['JSON']['input'];
};


export type MutationSubmitPendingTaskResponsesArgs = {
  pendingTaskId: Scalars['ID']['input'];
  values: Scalars['JSON']['input'];
};


export type MutationSuggestCspCustomerMatchesArgs = {
  packConfigId: Scalars['ID']['input'];
};


export type MutationSuggestOrgVarMatchesArgs = {
  packConfigId: Scalars['ID']['input'];
};


export type MutationSwaggerToOpenapiConversionArgs = {
  swaggerDoc: Scalars['JSON']['input'];
};


export type MutationSynchronizePackBundleConfigsArgs = {
  orgId: Scalars['ID']['input'];
  packBundleId: Scalars['ID']['input'];
  primaryPackConfigId: Scalars['ID']['input'];
};


export type MutationTestPackConfigArgs = {
  packConfig: PackConfigTestInput;
};


export type MutationTestWorkflowArgs = {
  context?: InputMaybe<ExecuteContextType>;
  id: Scalars['ID']['input'];
  input?: InputMaybe<Scalars['JSON']['input']>;
  orgId: Scalars['ID']['input'];
};


export type MutationTestWorkflowTriggerArgs = {
  input?: InputMaybe<Scalars['JSON']['input']>;
  triggerInstance: OrgTriggerInstanceInput;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationTrackWorkflowEventArgs = {
  data?: InputMaybe<Scalars['JSON']['input']>;
  type: WorkflowEventType;
  workflowId: Scalars['ID']['input'];
};


export type MutationUninstallPackArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
  orgIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  packId: Scalars['ID']['input'];
};


export type MutationUninstallPackBundleArgs = {
  orgIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  packBundleId: Scalars['ID']['input'];
};


export type MutationUnlinkCloneArgs = {
  id: Scalars['ID']['input'];
  objectType: CloneableObjectType;
};


export type MutationUnlinkMicrosoftCspCustomerArgs = {
  cspPackConfigId: Scalars['ID']['input'];
  customerId: Scalars['ID']['input'];
  orgIds: Array<Scalars['ID']['input']>;
};


export type MutationUnsyncCloneArgs = {
  id: Scalars['ID']['input'];
  objectType: CloneableObjectType;
};


export type MutationUpdateAppPlatformReservedDomainArgs = {
  id: Scalars['ID']['input'];
  reservedDomain: AppPlatformReservedDomainUpdateInput;
};


export type MutationUpdateComponentArgs = {
  component: UpdateComponentInput;
};


export type MutationUpdateComponentInstanceArgs = {
  id: Scalars['ID']['input'];
  input: ComponentInstanceUpdateInput;
};


export type MutationUpdateConversationArgs = {
  conversation: ConversationInput;
};


export type MutationUpdateConversationMessageVoteArgs = {
  vote: ConversationMessageVoteInput;
};


export type MutationUpdateCrateArgs = {
  crate: CrateUpdateInput;
};


export type MutationUpdateCrateOverrideArgs = {
  crateOverride: CrateOverrideInput;
};


export type MutationUpdateCrateOverrideOptionArgs = {
  option: CrateOverrideOptionInput;
};


export type MutationUpdateFeaturePreviewSettingArgs = {
  featurePreviewSetting?: InputMaybe<UpdateFeaturePreviewSettingInput>;
};


export type MutationUpdateFormArgs = {
  form: FormUpdateInput;
};


export type MutationUpdateFormOverridesArgs = {
  id: Scalars['ID']['input'];
  overrides: Scalars['JSON']['input'];
};


export type MutationUpdateManagedAndSubOrganizationsArgs = {
  organization: OrganizationUpdateInput;
};


export type MutationUpdateMicrosoftCspCustomerArgs = {
  cspPackConfigId: Scalars['ID']['input'];
  customerId: Scalars['ID']['input'];
  hasConsent: Scalars['Boolean']['input'];
};


export type MutationUpdateOrgTriggerInstanceArgs = {
  orgTriggerInstance: OrgTriggerInstanceInput;
};


export type MutationUpdateOrgVariablesArgs = {
  orgVariables: Array<OrgVariableUpdateInput>;
};


export type MutationUpdateOrganizationArgs = {
  organization?: InputMaybe<OrganizationUpdateInput>;
};


export type MutationUpdateOrganizationApiClientArgs = {
  input: UpdateApiClientInput;
};


export type MutationUpdateOrganizationFeaturePreviewSettingArgs = {
  featurePreviewSettingId: Scalars['ID']['input'];
  isEnabled: Scalars['Boolean']['input'];
  orgId: Scalars['ID']['input'];
};


export type MutationUpdatePackArgs = {
  pack: PackUpdateInput;
};


export type MutationUpdatePackConfigArgs = {
  packConfig: PackConfigUpdateInput;
};


export type MutationUpdatePackConfigsArgs = {
  packConfigs: Array<PackConfigUpdateInput>;
};


export type MutationUpdatePageArgs = {
  nodes?: InputMaybe<Array<InputMaybe<PageNodeInput>>>;
  page: PageUpdateInput;
};


export type MutationUpdatePageNodeArgs = {
  id: Scalars['ID']['input'];
  props: Scalars['JSON']['input'];
};


export type MutationUpdatePageNodeByCraftIdArgs = {
  craftId: Scalars['String']['input'];
  pageId: Scalars['ID']['input'];
  props: Scalars['JSON']['input'];
};


export type MutationUpdatePermissionArgs = {
  permission: PermissionUpdateInput;
};


export type MutationUpdateReservedOrganizationNameArgs = {
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
};


export type MutationUpdateRoleArgs = {
  role: RoleUpdateInput;
};


export type MutationUpdateSiteArgs = {
  site: SiteUpdateInput;
};


export type MutationUpdateSitesArgs = {
  sites: Array<SiteUpdateInput>;
};


export type MutationUpdateTagArgs = {
  tag: TagUpdateInput;
};


export type MutationUpdateTagsArgs = {
  tags: Array<TagUpdateInput>;
};


export type MutationUpdateTemplateArgs = {
  template: TemplateUpdateInput;
};


export type MutationUpdateTriggerArgs = {
  comment?: InputMaybe<Scalars['String']['input']>;
  commentDescription?: InputMaybe<Scalars['String']['input']>;
  createPatch?: InputMaybe<Scalars['Boolean']['input']>;
  trigger: TriggerUpdateInput;
};


export type MutationUpdateUserInviteRolesArgs = {
  id: Scalars['ID']['input'];
  roleIds: Array<Scalars['String']['input']>;
};


export type MutationUpdateUserPreferencesArgs = {
  preferences: UserPreferencesInput;
  userId: Scalars['ID']['input'];
};


export type MutationUpdateUserRolesArgs = {
  user?: InputMaybe<UserRolesInput>;
};


export type MutationUpdateWorkflowArgs = {
  comment?: InputMaybe<Scalars['String']['input']>;
  commentDescription?: InputMaybe<Scalars['String']['input']>;
  createPatch?: InputMaybe<Scalars['Boolean']['input']>;
  overwrite?: InputMaybe<Scalars['Boolean']['input']>;
  overwritePatchId?: InputMaybe<Scalars['ID']['input']>;
  trigger?: InputMaybe<TriggerCreateInput>;
  workflow: WorkflowInput;
};


export type MutationUpdateWorkflowCompletionListenerArgs = {
  listener: CompletionListenerUpdateInput;
};


export type MutationUpsertOrgFormFieldInstancesArgs = {
  input: UpsertOrgFormFieldInstancesInput;
};


export type MutationUpsertOrgInterpreterSettingArgs = {
  config: Scalars['JSON']['input'];
  language: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};


export type MutationValidateSiteCustomDomainDnsArgs = {
  id: Scalars['ID']['input'];
};

export type NewWorkflowExecutionEvent = {
  __typename?: 'NewWorkflowExecutionEvent';
  eventId: Scalars['ID']['output'];
  isFinished?: Maybe<Scalars['Boolean']['output']>;
  payload?: Maybe<NewWorkflowExecutionLog>;
};

export type NewWorkflowExecutionLog = {
  __typename?: 'NewWorkflowExecutionLog';
  createdAt: Scalars['String']['output'];
  executionId: Scalars['ID']['output'];
  orgId: Scalars['ID']['output'];
  originatingExecutionId: Scalars['ID']['output'];
  workflowId: Scalars['ID']['output'];
  workflowType: WorkflowType;
};

export type OnboardingQuestionnaireResponse = {
  __typename?: 'OnboardingQuestionnaireResponse';
  createdAt: Scalars['String']['output'];
  createdBy?: Maybe<User>;
  id: Scalars['ID']['output'];
  onboardingRequirementId: Scalars['ID']['output'];
  questionField: Scalars['String']['output'];
  questionText?: Maybe<Scalars['String']['output']>;
  responseValue?: Maybe<Scalars['JSON']['output']>;
  updatedAt: Scalars['String']['output'];
  updatedBy?: Maybe<User>;
};

export type OnboardingQuestionnaireResponseInput = {
  onboardingRequirementId: Scalars['ID']['input'];
  questionField: Scalars['String']['input'];
  questionText?: InputMaybe<Scalars['String']['input']>;
  responseValue?: InputMaybe<Scalars['JSON']['input']>;
};

export type OnboardingQuestionnaireResponseWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  onboardingRequirementId?: InputMaybe<Scalars['ID']['input']>;
  questionField?: InputMaybe<Scalars['String']['input']>;
};

export enum OnboardingStatus {
  Completed = 'COMPLETED',
  InProgress = 'IN_PROGRESS',
  NotStarted = 'NOT_STARTED',
  RequirementsPopulated = 'REQUIREMENTS_POPULATED'
}

export type OpenAiChoice = {
  __typename?: 'OpenAIChoice';
  message: OpenAiMessage;
};

export type OpenAiFunctionCall = {
  __typename?: 'OpenAIFunctionCall';
  arguments?: Maybe<Scalars['JSON']['output']>;
  name: Scalars['String']['output'];
};

export type OpenAiMessage = {
  __typename?: 'OpenAIMessage';
  content?: Maybe<Scalars['String']['output']>;
  function_call: OpenAiFunctionCall;
};

export type OpenAiResponse = {
  __typename?: 'OpenAIResponse';
  choices?: Maybe<Array<OpenAiChoice>>;
};

export type OrgBreadcrumb = {
  __typename?: 'OrgBreadcrumb';
  id?: Maybe<Scalars['ID']['output']>;
  name: Scalars['String']['output'];
};

export type OrgFormFieldInstance = {
  __typename?: 'OrgFormFieldInstance';
  createdAt?: Maybe<Scalars['String']['output']>;
  formFieldId: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  isEnabled?: Maybe<Scalars['Boolean']['output']>;
  orgId: Scalars['ID']['output'];
  organization?: Maybe<Organization>;
  schema?: Maybe<Scalars['JSON']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
};

export type OrgInterpreterSetting = {
  __typename?: 'OrgInterpreterSetting';
  config?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  language: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
};

export type OrgInterpreterSettingSearchInput = {
  config?: InputMaybe<Json_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
};

export type OrgInterpreterSettingWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  language?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
};

export type OrgSearchResult = {
  __typename?: 'OrgSearchResult';
  breadcrumbs?: Maybe<Array<Maybe<OrgBreadcrumb>>>;
  hasChildren: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isInternal?: Maybe<Scalars['Boolean']['output']>;
  managingOrgId?: Maybe<Scalars['ID']['output']>;
  name: Scalars['String']['output'];
  supportAccessStatus?: Maybe<SupportAccessStatus>;
};

export type OrgSupportAccess = {
  __typename?: 'OrgSupportAccess';
  createdAt: Scalars['String']['output'];
  expiresAt?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  orgId: Scalars['ID']['output'];
  organization: Organization;
  supportOrgId: Scalars['ID']['output'];
  supportOrganization: Organization;
  updatedAt: Scalars['String']['output'];
};

export type OrgSupportAccessInput = {
  expiresAt?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
};

export type OrgTriggerInstance = {
  __typename?: 'OrgTriggerInstance';
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isManualActivation?: Maybe<Scalars['Boolean']['output']>;
  lastSearchedAt?: Maybe<Scalars['String']['output']>;
  orgId?: Maybe<Scalars['ID']['output']>;
  organization?: Maybe<Organization>;
  state?: Maybe<Scalars['JSON']['output']>;
  trigger?: Maybe<Trigger>;
  triggerId?: Maybe<Scalars['ID']['output']>;
  updatedAt: Scalars['String']['output'];
};

export type OrgTriggerInstanceInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  isManualActivation?: InputMaybe<Scalars['Boolean']['input']>;
  lastSearchedAt?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  organization?: InputMaybe<OrganizationInput>;
  state?: InputMaybe<Scalars['JSON']['input']>;
  trigger?: InputMaybe<TriggerUpdateInput>;
  triggerId?: InputMaybe<Scalars['ID']['input']>;
};

export type OrgTriggerInstanceSearchInput = {
  id?: InputMaybe<Id_Comparison_Exp>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
  organization?: InputMaybe<OrganizationInput>;
  trigger?: InputMaybe<TriggerSearchInput>;
  triggerId?: InputMaybe<Id_Comparison_Exp>;
};

export type OrgTriggerInstanceWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  organization?: InputMaybe<OrganizationInput>;
  trigger?: InputMaybe<TriggerWhereInput>;
  triggerId?: InputMaybe<Scalars['ID']['input']>;
};

export type OrgVariable = {
  __typename?: 'OrgVariable';
  cascade: Scalars['Boolean']['output'];
  category: OrgVariableCategory;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
  organization: Organization;
  packConfig?: Maybe<PackConfig>;
  packConfigId?: Maybe<Scalars['ID']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  value?: Maybe<Scalars['String']['output']>;
};

export enum OrgVariableCategory {
  Contact = 'contact',
  General = 'general',
  Secret = 'secret',
  System = 'system'
}

export type OrgVariableCategorySearchInput = {
  _eq?: InputMaybe<OrgVariableCategory>;
  _gt?: InputMaybe<OrgVariableCategory>;
  _gte?: InputMaybe<OrgVariableCategory>;
  _ilike?: InputMaybe<OrgVariableCategory>;
  _in?: InputMaybe<Array<OrgVariableCategory>>;
  _like?: InputMaybe<OrgVariableCategory>;
  _lt?: InputMaybe<OrgVariableCategory>;
  _lte?: InputMaybe<OrgVariableCategory>;
  _ne?: InputMaybe<OrgVariableCategory>;
  _nilike?: InputMaybe<OrgVariableCategory>;
  _nin?: InputMaybe<Array<OrgVariableCategory>>;
  _nlike?: InputMaybe<OrgVariableCategory>;
  _substr?: InputMaybe<OrgVariableCategory>;
};

export type OrgVariableCreateInput = {
  cascade: Scalars['Boolean']['input'];
  category?: InputMaybe<OrgVariableCategory>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  packConfigId?: InputMaybe<Scalars['ID']['input']>;
  value: Scalars['String']['input'];
};

export type OrgVariableSearchInput = {
  category?: InputMaybe<OrgVariableCategorySearchInput>;
  id?: InputMaybe<Id_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
  organization?: InputMaybe<OrganizationSearchInput>;
  packConfig?: InputMaybe<PackConfigSearch>;
  packConfigId?: InputMaybe<Id_Comparison_Exp>;
  value?: InputMaybe<String_Comparison_Exp>;
};

export type OrgVariableUpdateInput = {
  cascade?: InputMaybe<Scalars['Boolean']['input']>;
  category?: InputMaybe<OrgVariableCategory>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  orgId?: InputMaybe<Scalars['ID']['input']>;
  packConfigId?: InputMaybe<Scalars['ID']['input']>;
  value?: InputMaybe<Scalars['String']['input']>;
};

export type OrgVariableWhereInput = {
  category?: InputMaybe<OrgVariableCategory>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  organization?: InputMaybe<OrganizationWhereInput>;
  packConfig?: InputMaybe<PackConfigWhereInput>;
  packConfigId?: InputMaybe<Scalars['ID']['input']>;
  value?: InputMaybe<Scalars['String']['input']>;
};

export type Organization = {
  __typename?: 'Organization';
  actions: Array<Action>;
  activatedTriggers: Array<Trigger>;
  createdAt?: Maybe<Scalars['String']['output']>;
  createdTags: Array<Tag>;
  deletedAt?: Maybe<Scalars['String']['output']>;
  domain?: Maybe<Scalars['String']['output']>;
  featurePreviewSettings?: Maybe<Array<Maybe<OrganizationFeaturePreviewSetting>>>;
  forms: Array<Form>;
  id?: Maybe<Scalars['ID']['output']>;
  installedPacks: Array<Pack>;
  isDeleted?: Maybe<Scalars['Boolean']['output']>;
  isEnabled?: Maybe<Scalars['Boolean']['output']>;
  isInternal?: Maybe<Scalars['Boolean']['output']>;
  isMsp?: Maybe<Scalars['Boolean']['output']>;
  isOnboarding?: Maybe<Scalars['Boolean']['output']>;
  isStaff?: Maybe<Scalars['Boolean']['output']>;
  managedAndSubOrgs: Array<Organization>;
  managedOrgAutoInstallingWorkflows: Array<Workflow>;
  managedOrgs: Array<Organization>;
  managingOrg?: Maybe<Organization>;
  managingOrgId?: Maybe<Scalars['ID']['output']>;
  name: Scalars['String']['output'];
  orgSlug?: Maybe<Scalars['String']['output']>;
  packConfigs: Array<PackConfig>;
  resultsRetentionDays?: Maybe<Scalars['Int']['output']>;
  rocSiteId?: Maybe<Scalars['String']['output']>;
  supportAccessStatus?: Maybe<SupportAccessStatus>;
  tags: Array<Tag>;
  templates: Array<Template>;
  tid?: Maybe<Scalars['ID']['output']>;
  triggerInstances: Array<OrgTriggerInstance>;
  triggers: Array<Trigger>;
  users: Array<User>;
  variables: Array<OrgVariable>;
  visibleActions: Array<Action>;
  visiblePackConfigs: Array<PackConfig>;
  visibleWorkflows: Array<Workflow>;
  workflowExecutions: Array<WorkflowExecution>;
  workflows: Array<Workflow>;
};


export type OrganizationInstalledPacksArgs = {
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<PackSearchInput>;
  where?: InputMaybe<PackInput>;
};


export type OrganizationManagedAndSubOrgsArgs = {
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
};

export type OrganizationFeaturePreviewSetting = {
  __typename?: 'OrganizationFeaturePreviewSetting';
  featurePreviewSetting?: Maybe<FeaturePreviewSetting>;
  featurePreviewSettingId?: Maybe<Scalars['ID']['output']>;
  isEnabled?: Maybe<Scalars['Boolean']['output']>;
  orgId?: Maybe<Scalars['ID']['output']>;
};

export type OrganizationInput = {
  domain?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  isOnboarding?: InputMaybe<Scalars['Boolean']['input']>;
  managingOrgId?: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  orgSlug?: InputMaybe<Scalars['String']['input']>;
  rocSiteId?: InputMaybe<Scalars['String']['input']>;
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  tid?: InputMaybe<Scalars['String']['input']>;
};

export type OrganizationOnboardingCrateRequirement = {
  __typename?: 'OrganizationOnboardingCrateRequirement';
  crate: Crate;
  crateId: Scalars['ID']['output'];
  crateName: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  createdBy?: Maybe<User>;
  id: Scalars['ID']['output'];
  installedAt?: Maybe<Scalars['String']['output']>;
  installedBy?: Maybe<User>;
  installedById?: Maybe<Scalars['ID']['output']>;
  isInstalled: Scalars['Boolean']['output'];
  isOrgSetupRequirement?: Maybe<Scalars['Boolean']['output']>;
  isSkipped?: Maybe<Scalars['Boolean']['output']>;
  onboardingRequirement: OrganizationOnboardingRequirement;
  onboardingRequirementId: Scalars['ID']['output'];
  orgId: Scalars['ID']['output'];
  organization: Organization;
  skippedAt?: Maybe<Scalars['String']['output']>;
  skippedById?: Maybe<Scalars['ID']['output']>;
  updatedAt: Scalars['String']['output'];
  updatedBy?: Maybe<User>;
  workflow?: Maybe<Workflow>;
  workflowId?: Maybe<Scalars['ID']['output']>;
};

export type OrganizationOnboardingCrateRequirementInput = {
  crateId: Scalars['ID']['input'];
  crateName: Scalars['String']['input'];
  installedAt?: InputMaybe<Scalars['String']['input']>;
  installedById?: InputMaybe<Scalars['ID']['input']>;
  isInstalled?: InputMaybe<Scalars['Boolean']['input']>;
  onboardingRequirementId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type OrganizationOnboardingCrateRequirementSearchInput = {
  crateName?: InputMaybe<Scalars['String']['input']>;
  isInstalled?: InputMaybe<Scalars['Boolean']['input']>;
};

export type OrganizationOnboardingCrateRequirementWhereInput = {
  crateId?: InputMaybe<Scalars['ID']['input']>;
  crateName?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isInstalled?: InputMaybe<Scalars['Boolean']['input']>;
  onboardingRequirementId?: InputMaybe<Scalars['ID']['input']>;
  orgId: Scalars['ID']['input'];
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type OrganizationOnboardingPackRequirement = {
  __typename?: 'OrganizationOnboardingPackRequirement';
  configuredAt?: Maybe<Scalars['String']['output']>;
  configuredBy?: Maybe<User>;
  configuredById?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['String']['output'];
  createdBy?: Maybe<User>;
  id: Scalars['ID']['output'];
  installedAt?: Maybe<Scalars['String']['output']>;
  installedBy?: Maybe<User>;
  installedById?: Maybe<Scalars['ID']['output']>;
  isConfigured: Scalars['Boolean']['output'];
  isInstalled: Scalars['Boolean']['output'];
  isRequired: Scalars['Boolean']['output'];
  isSkipped?: Maybe<Scalars['Boolean']['output']>;
  onboardingRequirement: OrganizationOnboardingRequirement;
  onboardingRequirementId: Scalars['ID']['output'];
  orgId: Scalars['ID']['output'];
  organization: Organization;
  packType: PackType;
  selectedPack?: Maybe<Pack>;
  selectedPackId?: Maybe<Scalars['ID']['output']>;
  skippedAt?: Maybe<Scalars['String']['output']>;
  skippedById?: Maybe<Scalars['ID']['output']>;
  updatedAt: Scalars['String']['output'];
  updatedBy?: Maybe<User>;
};

export type OrganizationOnboardingPackRequirementInput = {
  configuredAt?: InputMaybe<Scalars['String']['input']>;
  configuredById?: InputMaybe<Scalars['ID']['input']>;
  installedAt?: InputMaybe<Scalars['String']['input']>;
  installedById?: InputMaybe<Scalars['ID']['input']>;
  isConfigured?: InputMaybe<Scalars['Boolean']['input']>;
  isInstalled?: InputMaybe<Scalars['Boolean']['input']>;
  onboardingRequirementId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  packType: PackType;
  selectedPackId?: InputMaybe<Scalars['ID']['input']>;
};

export type OrganizationOnboardingPackRequirementSearchInput = {
  isConfigured?: InputMaybe<Scalars['Boolean']['input']>;
  isInstalled?: InputMaybe<Scalars['Boolean']['input']>;
  packType?: InputMaybe<PackType>;
};

export type OrganizationOnboardingPackRequirementWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  isConfigured?: InputMaybe<Scalars['Boolean']['input']>;
  isInstalled?: InputMaybe<Scalars['Boolean']['input']>;
  onboardingRequirementId?: InputMaybe<Scalars['ID']['input']>;
  orgId: Scalars['ID']['input'];
  packType?: InputMaybe<PackType>;
  selectedPackId?: InputMaybe<Scalars['ID']['input']>;
};

export type OrganizationOnboardingRequirement = {
  __typename?: 'OrganizationOnboardingRequirement';
  crateRequirements?: Maybe<Array<OrganizationOnboardingCrateRequirement>>;
  createdAt: Scalars['String']['output'];
  createdBy?: Maybe<User>;
  currentCustomerCount?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  onboardingCompletedAt?: Maybe<Scalars['String']['output']>;
  onboardingStartedAt?: Maybe<Scalars['String']['output']>;
  orgId: Scalars['ID']['output'];
  organization: Organization;
  organizationType?: Maybe<OrganizationType>;
  packRequirements?: Maybe<Array<OrganizationOnboardingPackRequirement>>;
  questionnaireResponses?: Maybe<Array<OnboardingQuestionnaireResponse>>;
  requirementsCompleted?: Maybe<Scalars['Boolean']['output']>;
  requirementsPopulated?: Maybe<Scalars['Boolean']['output']>;
  status?: Maybe<OnboardingStatus>;
  targetCustomerCount?: Maybe<Scalars['Int']['output']>;
  updatedAt: Scalars['String']['output'];
  updatedBy?: Maybe<User>;
};

export type OrganizationOnboardingRequirementInput = {
  onboardingCompletedAt?: InputMaybe<Scalars['String']['input']>;
  onboardingStartedAt?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
  organizationType?: InputMaybe<OrganizationType>;
  requirementsCompleted?: InputMaybe<Scalars['Boolean']['input']>;
  requirementsPopulated?: InputMaybe<Scalars['Boolean']['input']>;
  status?: InputMaybe<OnboardingStatus>;
  targetCustomerCount?: InputMaybe<Scalars['Int']['input']>;
};

export type OrganizationOnboardingRequirementSearchInput = {
  organizationType?: InputMaybe<OrganizationType>;
  status?: InputMaybe<OnboardingStatus>;
  targetCustomerCount?: InputMaybe<Scalars['Int']['input']>;
};

export type OrganizationOnboardingRequirementWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  orgId: Scalars['ID']['input'];
  organizationType?: InputMaybe<OrganizationType>;
  requirementsCompleted?: InputMaybe<Scalars['Boolean']['input']>;
  requirementsPopulated?: InputMaybe<Scalars['Boolean']['input']>;
  status?: InputMaybe<OnboardingStatus>;
};

export type OrganizationSearchInput = {
  createdAt?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  installedPacks?: InputMaybe<PackSearchInput>;
  isDeleted?: InputMaybe<Bool_Comparison_Exp>;
  isEnabled?: InputMaybe<Bool_Comparison_Exp>;
  isInternal?: InputMaybe<Bool_Comparison_Exp>;
  isOnboarding?: InputMaybe<Bool_Comparison_Exp>;
  isStaff?: InputMaybe<Bool_Comparison_Exp>;
  managedOrgs?: InputMaybe<OrganizationSearchInput>;
  managingOrg?: InputMaybe<OrganizationSearchInput>;
  managingOrgId?: InputMaybe<Id_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  orgSlug?: InputMaybe<String_Comparison_Exp>;
  resultsRetentionDays?: InputMaybe<Int_Comparison_Exp>;
  rocSiteId?: InputMaybe<String_Comparison_Exp>;
  tags?: InputMaybe<TagSearchInput>;
  users?: InputMaybe<UserSearchInput>;
};

export type OrganizationTagsWhereInput = {
  id?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export enum OrganizationType {
  Direct = 'DIRECT',
  Enterprise = 'ENTERPRISE',
  Msp = 'MSP',
  Other = 'OTHER'
}

export type OrganizationUpdateInput = {
  deletedAt?: InputMaybe<Scalars['String']['input']>;
  domain?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  isDeleted?: InputMaybe<Scalars['Boolean']['input']>;
  isEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  isInternal?: InputMaybe<Scalars['Boolean']['input']>;
  isOnboarding?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgSlug?: InputMaybe<Scalars['String']['input']>;
  resultsRetentionDays?: InputMaybe<Scalars['Int']['input']>;
  rocSiteId?: InputMaybe<Scalars['String']['input']>;
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  tid?: InputMaybe<Scalars['ID']['input']>;
};

export type OrganizationWhereInput = {
  domain?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isStaff?: InputMaybe<Scalars['Boolean']['input']>;
  managedOrgs?: InputMaybe<OrganizationWhereInput>;
  managingOrg?: InputMaybe<OrganizationWhereInput>;
  managingOrgId?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgSlug?: InputMaybe<Scalars['String']['input']>;
  rocSiteId?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<OrganizationTagsWhereInput>;
  users?: InputMaybe<UserWhereInput>;
};

export type Pack = {
  __typename?: 'Pack';
  actions: Array<Action>;
  configFormSchema?: Maybe<Scalars['JSON']['output']>;
  configSchema?: Maybe<Scalars['JSON']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  icon?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  installedBy?: Maybe<Array<Maybe<Organization>>>;
  isDefault?: Maybe<Scalars['Boolean']['output']>;
  isMultitenancyEnabled?: Maybe<Scalars['Boolean']['output']>;
  isOauthConfiguration?: Maybe<Scalars['Boolean']['output']>;
  metadata?: Maybe<Scalars['JSON']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  orgId?: Maybe<Scalars['ID']['output']>;
  orgVariables?: Maybe<Scalars['JSON']['output']>;
  packBundle?: Maybe<PackBundle>;
  packBundleId?: Maybe<Scalars['ID']['output']>;
  packConfigs: Array<PackConfig>;
  packOverrides?: Maybe<Array<Maybe<PackOverride>>>;
  packTestAction?: Maybe<Action>;
  packType?: Maybe<PackType>;
  ref?: Maybe<Scalars['String']['output']>;
  sensorTypes: Array<SensorType>;
  setupInstructions?: Maybe<Scalars['String']['output']>;
  status: PackStatus;
  tags: Array<Tag>;
  triggerTypes: Array<TriggerType>;
  uid?: Maybe<Scalars['String']['output']>;
  version?: Maybe<Scalars['String']['output']>;
};


export type PackActionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  search?: InputMaybe<ActionSearch>;
  where?: InputMaybe<ActionInput>;
};


export type PackInstalledByArgs = {
  filter?: InputMaybe<OrganizationInput>;
  where?: InputMaybe<OrganizationInput>;
};


export type PackPackConfigsArgs = {
  where?: InputMaybe<PackConfigWhereInput>;
};


export type PackTriggerTypesArgs = {
  search?: InputMaybe<TriggerTypesSearchInput>;
  where?: InputMaybe<TriggerTypeWhereInput>;
};

/** Defines the structure for making an API request configuration. */
export type PackActionOption = {
  __typename?: 'PackActionOption';
  headers?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  labelIsTemplate?: Maybe<Scalars['Boolean']['output']>;
  maxPages?: Maybe<Scalars['Int']['output']>;
  method?: Maybe<HttpMethod>;
  name: Scalars['String']['output'];
  packId: Scalars['ID']['output'];
  pageSize?: Maybe<Scalars['Int']['output']>;
  paginate?: Maybe<Scalars['Boolean']['output']>;
  path: Scalars['String']['output'];
  pathParams?: Maybe<Scalars['JSON']['output']>;
  queryParams?: Maybe<Scalars['JSON']['output']>;
  requiredHeaderVars?: Maybe<Array<Scalars['String']['output']>>;
  requiredPathVars?: Maybe<Array<Scalars['String']['output']>>;
  requiredQueryVars?: Maybe<Array<Scalars['String']['output']>>;
  resultsKey?: Maybe<Scalars['String']['output']>;
  valueField: Scalars['String']['output'];
  valueFieldIsPath?: Maybe<Scalars['Boolean']['output']>;
};

export type PackActionOptionInput = {
  headers?: InputMaybe<Scalars['JSON']['input']>;
  label?: Scalars['String']['input'];
  labelIsTemplate?: InputMaybe<Scalars['Boolean']['input']>;
  maxPages?: InputMaybe<Scalars['Int']['input']>;
  method?: InputMaybe<HttpMethod>;
  name: Scalars['String']['input'];
  packId: Scalars['ID']['input'];
  pageSize?: InputMaybe<Scalars['Int']['input']>;
  paginate?: InputMaybe<Scalars['Boolean']['input']>;
  path: Scalars['String']['input'];
  pathParams?: InputMaybe<Scalars['JSON']['input']>;
  queryParams?: InputMaybe<Scalars['JSON']['input']>;
  requiredHeaderVars?: InputMaybe<Array<Scalars['String']['input']>>;
  requiredPathVars?: InputMaybe<Array<Scalars['String']['input']>>;
  requiredQueryVars?: InputMaybe<Array<Scalars['String']['input']>>;
  resultsKey?: InputMaybe<Scalars['String']['input']>;
  valueField?: Scalars['String']['input'];
  valueFieldIsPath?: InputMaybe<Scalars['Boolean']['input']>;
};

export type PackActionOptionWhereInput = {
  headers?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  label?: InputMaybe<Scalars['String']['input']>;
  labelIsTemplate?: InputMaybe<Scalars['Boolean']['input']>;
  method?: InputMaybe<HttpMethod>;
  name?: InputMaybe<Scalars['String']['input']>;
  packId?: InputMaybe<Scalars['ID']['input']>;
  paginate?: InputMaybe<Scalars['Boolean']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  pathParams?: InputMaybe<Scalars['JSON']['input']>;
  queryParams?: InputMaybe<Scalars['JSON']['input']>;
  requiredHeaderVars?: InputMaybe<Array<Scalars['String']['input']>>;
  requiredPathVars?: InputMaybe<Array<Scalars['String']['input']>>;
  requiredQueryVars?: InputMaybe<Array<Scalars['String']['input']>>;
  resultsKey?: InputMaybe<Scalars['String']['input']>;
  valueField?: InputMaybe<Scalars['String']['input']>;
  valueFieldIsPath?: InputMaybe<Scalars['Boolean']['input']>;
};

export type PackBundle = {
  __typename?: 'PackBundle';
  configSchema?: Maybe<Scalars['JSON']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  packs: Array<Pack>;
  ref: Scalars['String']['output'];
};

export type PackBundleIncludedPack = {
  __typename?: 'PackBundleIncludedPack';
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isInstalled: Scalars['Boolean']['output'];
  isRequired: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  ref: Scalars['String']['output'];
  updatedAt?: Maybe<Scalars['String']['output']>;
};

export type PackBundleSearchInput = {
  description?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  packs?: InputMaybe<PackSearchInput>;
  ref?: InputMaybe<Scalars['String']['input']>;
};

export type PackBundleWhereInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  packs?: InputMaybe<PackWhereInput>;
  ref?: InputMaybe<Scalars['String']['input']>;
};

export type PackConfig = {
  __typename?: 'PackConfig';
  actionOptions: Array<ActionOption>;
  appliedToTriggers: Array<Trigger>;
  config?: Maybe<Scalars['JSON']['output']>;
  createdAt?: Maybe<Scalars['String']['output']>;
  default?: Maybe<Scalars['Boolean']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  foreignObjectReferences: Array<ForeignObjectReference>;
  id?: Maybe<Scalars['ID']['output']>;
  metadata?: Maybe<Scalars['JSON']['output']>;
  name: Scalars['String']['output'];
  orgId?: Maybe<Scalars['ID']['output']>;
  orgVariables: Array<OrgVariable>;
  organization?: Maybe<Organization>;
  pack?: Maybe<Pack>;
  packId?: Maybe<Scalars['ID']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  visibleForOrganizations: Array<Organization>;
};


export type PackConfigActionOptionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<ActionOptionSearchInput>;
  where?: InputMaybe<ActionOptionWhereInput>;
};

export type PackConfigApplyInput = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
  packId: Scalars['ID']['input'];
};

export type PackConfigCreateInput = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  default?: InputMaybe<Scalars['Boolean']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  packId: Scalars['ID']['input'];
};

export type PackConfigDeleteInput = {
  id: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
};

export type PackConfigSearch = {
  config?: InputMaybe<Json_Comparison_Exp>;
  default?: InputMaybe<Bool_Comparison_Exp>;
  description?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  metadata?: InputMaybe<Json_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
  pack?: InputMaybe<PackSearchInput>;
  packId?: InputMaybe<Id_Comparison_Exp>;
};

export type PackConfigTestInput = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  packId?: InputMaybe<Scalars['ID']['input']>;
};

export type PackConfigUpdateInput = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  default?: InputMaybe<Scalars['Boolean']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  packId?: InputMaybe<Scalars['ID']['input']>;
};

export type PackConfigWhereInput = {
  actionOptions?: InputMaybe<ActionOptionWhereInput>;
  config?: InputMaybe<Scalars['JSON']['input']>;
  default?: InputMaybe<Scalars['Boolean']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  pack?: InputMaybe<PackWhereInput>;
  packId?: InputMaybe<Scalars['ID']['input']>;
  ref?: InputMaybe<Scalars['ID']['input']>;
};

export type PackCreateInput = {
  actions?: InputMaybe<Array<ActionInput>>;
  configSchema: Scalars['JSON']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  isMultitenancyEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  isOauthConfiguration?: InputMaybe<Scalars['Boolean']['input']>;
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  name: Scalars['String']['input'];
  orgId?: InputMaybe<Scalars['ID']['input']>;
  orgVariables?: InputMaybe<Scalars['JSON']['input']>;
  packTestActionId?: InputMaybe<ActionInput>;
  packType?: InputMaybe<PackType>;
  ref: Scalars['String']['input'];
  status?: InputMaybe<PackStatus>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  uid?: InputMaybe<Scalars['String']['input']>;
  version?: InputMaybe<Scalars['String']['input']>;
};

export type PackDeleteResponse = {
  __typename?: 'PackDeleteResponse';
  installedBy?: Maybe<Array<Scalars['ID']['output']>>;
  message?: Maybe<Scalars['String']['output']>;
  success: Scalars['Boolean']['output'];
};

export type PackInput = {
  actions?: InputMaybe<Array<ActionInput>>;
  description?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  installedBy?: InputMaybe<OrganizationInput>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  packTestActionId?: InputMaybe<Scalars['ID']['input']>;
  packType?: InputMaybe<PackType>;
  ref?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<PackStatus>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  uid?: InputMaybe<Scalars['String']['input']>;
  version?: InputMaybe<Scalars['String']['input']>;
};

export type PackInstalledByResponse = {
  __typename?: 'PackInstalledByResponse';
  installedBy?: Maybe<Array<Scalars['ID']['output']>>;
  message?: Maybe<Scalars['String']['output']>;
  success: Scalars['Boolean']['output'];
};

export type PackOrError = ErrorMessage | Pack;

export type PackOrPackBundle = {
  __typename?: 'PackOrPackBundle';
  description?: Maybe<Scalars['String']['output']>;
  icon?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  includedPacks?: Maybe<Array<PackBundleIncludedPack>>;
  isBundle: Scalars['Boolean']['output'];
  isDefault?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  orgId?: Maybe<Scalars['ID']['output']>;
  packType?: Maybe<PackType>;
  ref: Scalars['String']['output'];
  status?: Maybe<PackStatus>;
  tags?: Maybe<Array<Tag>>;
  updatedAt?: Maybe<Scalars['String']['output']>;
};

export type PackOverride = {
  __typename?: 'PackOverride';
  configFallbackMode?: Maybe<ConfigFallbackModes>;
  configSelectionMode?: Maybe<ConfigSelectionModes>;
  crateTrigger?: Maybe<CrateTrigger>;
  crateTriggerId?: Maybe<Scalars['ID']['output']>;
  crateTriggerUnpacking?: Maybe<CrateTriggerUnpacking>;
  crateTriggerUnpackingId?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  pack: Pack;
  packConfig?: Maybe<PackConfig>;
  packConfigId?: Maybe<Scalars['ID']['output']>;
  packId: Scalars['ID']['output'];
  searchInput?: Maybe<Scalars['String']['output']>;
  trigger?: Maybe<Trigger>;
  triggerId?: Maybe<Scalars['ID']['output']>;
  workflowTask?: Maybe<WorkflowTask>;
  workflowTaskId?: Maybe<Scalars['ID']['output']>;
};

export type PackOverrideInput = {
  configFallbackMode?: InputMaybe<ConfigFallbackModes>;
  configSelectionMode?: InputMaybe<ConfigSelectionModes>;
  packConfigId?: InputMaybe<Scalars['ID']['input']>;
  packId: Scalars['ID']['input'];
  searchInput?: InputMaybe<Scalars['String']['input']>;
};

export type PackOverrideSearchInput = {
  pack?: InputMaybe<PackSearchInput>;
  packConfig?: InputMaybe<PackConfigSearch>;
  packConfigId?: InputMaybe<Id_Comparison_Exp>;
  packId?: InputMaybe<Id_Comparison_Exp>;
  trigger?: InputMaybe<TriggerSearchInput>;
  triggerId?: InputMaybe<Id_Comparison_Exp>;
  workflowTask?: InputMaybe<WorkflowTaskSearchInput>;
  workflowTaskId?: InputMaybe<Id_Comparison_Exp>;
};

export type PackResourceTypesContainer = {
  __typename?: 'PackResourceTypesContainer';
  id: Scalars['ID']['output'];
  packName: Scalars['String']['output'];
  resourceTypes: Array<Scalars['String']['output']>;
};

export type PackSearchInput = {
  actions?: InputMaybe<ActionSearch>;
  description?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  installedBy?: InputMaybe<OrganizationSearchInput>;
  isOauthConfiguration?: InputMaybe<Bool_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
  packBundleId?: InputMaybe<Id_Comparison_Exp>;
  packOverrides?: InputMaybe<PackOverrideSearchInput>;
  packType?: InputMaybe<PackTypeSearch>;
  ref?: InputMaybe<String_Comparison_Exp>;
  status?: InputMaybe<PackStatusSearch>;
  tags?: InputMaybe<String_Comparison_Exp>;
  uid?: InputMaybe<String_Comparison_Exp>;
  version?: InputMaybe<String_Comparison_Exp>;
};

export enum PackStatus {
  Deprecated = 'deprecated',
  Draft = 'draft',
  Hidden = 'hidden',
  Published = 'published'
}

export type PackStatusSearch = {
  _eq?: InputMaybe<PackStatus>;
  _in?: InputMaybe<Array<PackStatus>>;
  _ne?: InputMaybe<PackStatus>;
  _nin?: InputMaybe<Array<PackStatus>>;
};

export enum PackType {
  Backup = 'BACKUP',
  Billing = 'BILLING',
  Documentation = 'DOCUMENTATION',
  IdentityProvider = 'IDENTITY_PROVIDER',
  IdentityProviderLicensing = 'IDENTITY_PROVIDER_LICENSING',
  Monitoring = 'MONITORING',
  Psa = 'PSA',
  Rmm = 'RMM',
  Security = 'SECURITY',
  Custom = 'custom',
  Default = 'default',
  Openapi = 'openapi'
}

export type PackTypeSearch = {
  _eq?: InputMaybe<PackType>;
  _in?: InputMaybe<Array<PackType>>;
  _ne?: InputMaybe<PackType>;
  _nin?: InputMaybe<Array<PackType>>;
};

export type PackUpdateInput = {
  actions?: InputMaybe<Array<ActionUpdateInput>>;
  configSchema?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  isMultitenancyEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  isOauthConfiguration?: InputMaybe<Scalars['Boolean']['input']>;
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  orgVariables?: InputMaybe<Scalars['JSON']['input']>;
  packTestActionId?: InputMaybe<Scalars['ID']['input']>;
  ref?: InputMaybe<Scalars['String']['input']>;
  setupInstructions?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<PackStatus>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  uid?: InputMaybe<Scalars['String']['input']>;
  version?: InputMaybe<Scalars['String']['input']>;
};

export type PackWhereInput = {
  actions?: InputMaybe<ActionInput>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  installedBy?: InputMaybe<OrganizationWhereInput>;
  isOauthConfiguration?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  packBundleId?: InputMaybe<Scalars['ID']['input']>;
  packType?: InputMaybe<PackType>;
  ref?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<PackStatus>;
};

export type PacksAndBundlesByInstalledState = {
  __typename?: 'PacksAndBundlesByInstalledState';
  installedPacksAndBundles?: Maybe<Array<PackOrPackBundle>>;
  marketplacePacksAndBundles?: Maybe<Array<PackOrPackBundle>>;
};

export type Page = {
  __typename?: 'Page';
  cloneOverrides?: Maybe<Scalars['JSON']['output']>;
  clonedFrom?: Maybe<Site>;
  clonedFromId?: Maybe<Scalars['ID']['output']>;
  clones?: Maybe<Array<Maybe<Page>>>;
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  createdById?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  isSynchronized?: Maybe<Scalars['Boolean']['output']>;
  loader?: Maybe<Loader>;
  name: Scalars['String']['output'];
  nodes?: Maybe<Array<Maybe<PageNode>>>;
  orgId?: Maybe<Scalars['ID']['output']>;
  organization?: Maybe<Organization>;
  path: Scalars['String']['output'];
  permission?: Maybe<Permission>;
  site?: Maybe<Site>;
  siteId?: Maybe<Scalars['ID']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
  variables?: Maybe<Array<Maybe<Scalars['JSON']['output']>>>;
  workflows: Array<Workflow>;
};

export type PageCreateInput = {
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  loader?: InputMaybe<Loader>;
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  siteId?: InputMaybe<Scalars['ID']['input']>;
  variables?: InputMaybe<Array<InputMaybe<Scalars['JSON']['input']>>>;
  workflows?: InputMaybe<Array<InputMaybe<WorkflowInput>>>;
};

export type PageNode = {
  __typename?: 'PageNode';
  componentId?: Maybe<Scalars['ID']['output']>;
  craftId: Scalars['String']['output'];
  custom?: Maybe<Scalars['JSON']['output']>;
  displayName: Scalars['String']['output'];
  formId?: Maybe<Scalars['ID']['output']>;
  hidden?: Maybe<Scalars['Boolean']['output']>;
  id: Scalars['ID']['output'];
  isCanvas: Scalars['Boolean']['output'];
  linkedNodes: Scalars['JSON']['output'];
  linkedPages?: Maybe<Array<Page>>;
  nodes: Array<Maybe<Scalars['String']['output']>>;
  pageId: Scalars['ID']['output'];
  parentId?: Maybe<Scalars['ID']['output']>;
  props: Scalars['JSON']['output'];
  templates?: Maybe<Array<Template>>;
  triggers?: Maybe<Array<Trigger>>;
  type: Scalars['JSON']['output'];
  workflows?: Maybe<Array<Workflow>>;
};

export type PageNodeInput = {
  componentId?: InputMaybe<Scalars['ID']['input']>;
  craftId: Scalars['String']['input'];
  custom?: InputMaybe<Scalars['JSON']['input']>;
  displayName: Scalars['String']['input'];
  formId?: InputMaybe<Scalars['ID']['input']>;
  hidden?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
  isCanvas: Scalars['Boolean']['input'];
  linkedNodes: Scalars['JSON']['input'];
  linkedPages?: InputMaybe<Array<PageCreateInput>>;
  nodes: Array<InputMaybe<Scalars['String']['input']>>;
  pageId?: InputMaybe<Scalars['ID']['input']>;
  parentId?: InputMaybe<Scalars['ID']['input']>;
  props: Scalars['JSON']['input'];
  templates?: InputMaybe<Array<TemplateInput>>;
  triggers?: InputMaybe<Array<TriggerCreateInput>>;
  type: Scalars['JSON']['input'];
  workflows: Array<WorkflowInput>;
};

export type PageSearchInput = {
  name?: InputMaybe<Scalars['String']['input']>;
  siteId?: InputMaybe<Scalars['ID']['input']>;
};

export type PageUpdateInput = {
  componentInstances?: InputMaybe<Array<InputMaybe<ComponentInstanceInput>>>;
  id: Scalars['ID']['input'];
  loader?: InputMaybe<Loader>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  pageNodes?: InputMaybe<Scalars['String']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  siteId: Scalars['ID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
  variables?: InputMaybe<Array<InputMaybe<Scalars['JSON']['input']>>>;
  workflows?: InputMaybe<Array<InputMaybe<WorkflowInput>>>;
};

export type PageWhereInput = {
  _?: InputMaybe<Scalars['String']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  domain?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  site?: InputMaybe<SitePropertiesInput>;
  siteId?: InputMaybe<Scalars['ID']['input']>;
};

export type PagesImportInput = {
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  path: Scalars['String']['input'];
};

export enum PatchType {
  Form = 'form',
  Template = 'template',
  Trigger = 'trigger',
  Workflow = 'workflow'
}

export type PendingTask = {
  __typename?: 'PendingTask';
  expiresAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  status: PendingTaskStatus;
  workflowExecution: WorkflowExecution;
  workflowTask: PendingTaskWorkflowTask;
};

export type PendingTaskInput = {
  expiresAt?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<PendingTaskStatus>;
  workflowExecutionId?: InputMaybe<Scalars['ID']['input']>;
};

export type PendingTaskSearchInput = {
  id?: InputMaybe<Id_Comparison_Exp>;
  status?: InputMaybe<PendingTaskStatusSearchInput>;
  workflowExecution?: InputMaybe<WorkflowExecutionSearchInput>;
  workflowExecutionId?: InputMaybe<Id_Comparison_Exp>;
};

export enum PendingTaskStatus {
  Canceled = 'canceled',
  Delayed = 'delayed',
  Expired = 'expired',
  Pending = 'pending',
  Success = 'success'
}

export type PendingTaskStatusSearchInput = {
  _eq?: InputMaybe<PendingTaskStatus>;
  _gt?: InputMaybe<PendingTaskStatus>;
  _gte?: InputMaybe<PendingTaskStatus>;
  _ilike?: InputMaybe<PendingTaskStatus>;
  _in?: InputMaybe<Array<PendingTaskStatus>>;
  _like?: InputMaybe<PendingTaskStatus>;
  _lt?: InputMaybe<PendingTaskStatus>;
  _lte?: InputMaybe<PendingTaskStatus>;
  _neq?: InputMaybe<PendingTaskStatus>;
  _nilike?: InputMaybe<PendingTaskStatus>;
  _nin?: InputMaybe<Array<PendingTaskStatus>>;
  _nlike?: InputMaybe<PendingTaskStatus>;
  _substr?: InputMaybe<PendingTaskStatus>;
};

export type PendingTaskWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<PendingTaskStatus>;
  workflowExecution?: InputMaybe<WorkflowExecutionWhereInput>;
  workflowExecutionId?: InputMaybe<Scalars['ID']['input']>;
};

export type PendingTaskWorkflowTask = {
  __typename?: 'PendingTaskWorkflowTask';
  action_item?: Maybe<Scalars['JSON']['output']>;
  action_metadata?: Maybe<Scalars['JSON']['output']>;
  action_params?: Maybe<Scalars['JSON']['output']>;
  execution_id?: Maybe<Scalars['ID']['output']>;
  originating_execution_id?: Maybe<Scalars['ID']['output']>;
  pack_params?: Maybe<Scalars['JSON']['output']>;
  runner_params?: Maybe<Scalars['JSON']['output']>;
  spec?: Maybe<Scalars['JSON']['output']>;
  started_at?: Maybe<Scalars['String']['output']>;
  task?: Maybe<Scalars['JSON']['output']>;
};

export type PendingTasksAggregate = {
  __typename?: 'PendingTasksAggregate';
  count: Scalars['Int']['output'];
};

export type PendingTasksAggregateInput = {
  status?: InputMaybe<PendingTaskStatus>;
  workflowExecution?: InputMaybe<WorkflowExecutionWhereInput>;
};

export type Permission = {
  __typename?: 'Permission';
  authorizedForOrganizations?: Maybe<Array<Maybe<Organization>>>;
  authorizedForSubOrganizations?: Maybe<Array<Maybe<Organization>>>;
  excludeOrganizations?: Maybe<Array<Maybe<Organization>>>;
  id?: Maybe<Scalars['ID']['output']>;
  objectId?: Maybe<Scalars['String']['output']>;
  objectType?: Maybe<Scalars['String']['output']>;
  orgId?: Maybe<Scalars['ID']['output']>;
  override?: Maybe<Scalars['String']['output']>;
  permissionType?: Maybe<Scalars['String']['output']>;
  relation?: Maybe<Scalars['String']['output']>;
  roleIds?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  subjectId?: Maybe<Scalars['String']['output']>;
  subjectType?: Maybe<Scalars['String']['output']>;
  templateId?: Maybe<Scalars['ID']['output']>;
};

export type PermissionCreateInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  objectId?: InputMaybe<Scalars['String']['input']>;
  objectType?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  orgIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  override?: InputMaybe<Scalars['String']['input']>;
  relation?: InputMaybe<Scalars['String']['input']>;
  roleIds?: InputMaybe<Array<Scalars['String']['input']>>;
  templateId?: InputMaybe<Scalars['ID']['input']>;
};

export type PermissionUpdateInput = {
  excludeOrgIds?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  objectId: Scalars['String']['input'];
  orgIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  override?: InputMaybe<Scalars['String']['input']>;
  relation?: InputMaybe<Scalars['String']['input']>;
  roleIds?: InputMaybe<Array<Scalars['String']['input']>>;
  subOrgIds?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};

export type PermissionWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  objectId?: InputMaybe<Scalars['String']['input']>;
  objectType?: InputMaybe<Scalars['String']['input']>;
  permissionType?: InputMaybe<Scalars['String']['input']>;
  templateId?: InputMaybe<Scalars['ID']['input']>;
};

export type PhasedCloneEvent = {
  phase: ClonePhase;
};

export type PublicCrate = {
  __typename?: 'PublicCrate';
  associatedPacks?: Maybe<Array<Maybe<AssociatedPack>>>;
  category?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  gid?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  maturity?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  providedValue?: Maybe<Scalars['String']['output']>;
  setupAssistance?: Maybe<Scalars['String']['output']>;
  setupTime?: Maybe<Scalars['String']['output']>;
};

export type PublishCrateStreamEvent = PublishCrateStreamFailureResponse | PublishCrateStreamSuccessResponse;

export type PublishCrateStreamFailureResponse = BaseStreamEvent & {
  __typename?: 'PublishCrateStreamFailureResponse';
  code: Scalars['String']['output'];
  didSucceed: Scalars['Boolean']['output'];
  error: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type PublishCrateStreamSuccessResponse = BaseStreamEvent & {
  __typename?: 'PublishCrateStreamSuccessResponse';
  crateId: Scalars['ID']['output'];
  didSucceed: Scalars['Boolean']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type Query = {
  __typename?: 'Query';
  action?: Maybe<Action>;
  actionOption?: Maybe<ActionOption>;
  actionOptions: Array<ActionOption>;
  actions: Array<Action>;
  actionsForOrg: Array<Action>;
  apiClient?: Maybe<ApiClient>;
  apiClients: ApiClientList;
  appPlatformReservedDomain?: Maybe<AppPlatformReservedDomain>;
  appPlatformReservedDomains: Array<AppPlatformReservedDomain>;
  check?: Maybe<Scalars['JSON']['output']>;
  checkAuthorization?: Maybe<Scalars['JSON']['output']>;
  commonlyUsedIntegrationActions: Array<CommonlyUsedAction>;
  component?: Maybe<Component>;
  componentInstance?: Maybe<ComponentInstance>;
  componentInstances?: Maybe<Array<Maybe<ComponentInstance>>>;
  componentInstancesByComponentVersion?: Maybe<Array<Maybe<ComponentInstance>>>;
  componentInstancesByPage?: Maybe<Array<Maybe<ComponentInstance>>>;
  componentTree?: Maybe<ComponentTree>;
  components?: Maybe<Array<Maybe<Component>>>;
  componentsByRoots?: Maybe<Array<Maybe<Component>>>;
  conversation?: Maybe<Conversation>;
  conversationMessageVotes: Array<ConversationMessageVote>;
  conversations: Array<Conversation>;
  crate?: Maybe<Crate>;
  crateCategories?: Maybe<Scalars['JSON']['output']>;
  crateExportInfo?: Maybe<Scalars['JSON']['output']>;
  crateTags: Array<Tag>;
  crateTokenTypes: Array<Scalars['String']['output']>;
  crateUnpackingArgumentSet?: Maybe<CrateUnpackingArgumentSet>;
  crateUseCase?: Maybe<CrateUseCase>;
  crateUseCases: Array<CrateUseCase>;
  /** This public query returns all available crates within the Rewst platform. */
  crates: Array<Crate>;
  cratesForForm?: Maybe<Array<Maybe<Crate>>>;
  cratesForTemplate?: Maybe<Array<Maybe<Crate>>>;
  dailyTaskCountsByDateRange: Array<TaskCountByDate>;
  dailyTimeSavedByDateRange: Array<TimeSavedByDate>;
  debug?: Maybe<Scalars['Boolean']['output']>;
  evaluatedForm?: Maybe<Form>;
  extractJinjaValues?: Maybe<Scalars['JSON']['output']>;
  featurePreviewSetting?: Maybe<FeaturePreviewSetting>;
  featurePreviewSettings?: Maybe<Array<Maybe<FeaturePreviewSetting>>>;
  foreignObjectReference?: Maybe<ForeignObjectReference>;
  foreignObjectReferences: Array<ForeignObjectReference>;
  form?: Maybe<Form>;
  forms: Array<Form>;
  getAppPermissions: Array<Site>;
  getCannyToken?: Maybe<Scalars['String']['output']>;
  getHaloLiveChatToken?: Maybe<Scalars['String']['output']>;
  getSiteTheme?: Maybe<Scalars['JSON']['output']>;
  getSkilljarLoginToken?: Maybe<Scalars['String']['output']>;
  getTestUserSession?: Maybe<User>;
  getTestUsers: Array<User>;
  getTriggerErrorStatus: Scalars['JSON']['output'];
  home: Scalars['String']['output'];
  hourlyTaskCountByDate: Array<TaskCountByHour>;
  hourlyTimeSavedByDate: Array<TimeSavedByHour>;
  /** This public query returns all available integrations within the Rewst platform. */
  integrations: Array<Integration>;
  isOrgManagedBy?: Maybe<Scalars['Boolean']['output']>;
  jinjaFilterDocumentation?: Maybe<Jinja2Documentation>;
  jinjaFiltersDocumentation: Array<Jinja2Documentation>;
  jinjaRenderSession?: Maybe<JinjaRenderSession>;
  jinjaTemplate?: Maybe<Template>;
  latestInterpreterVersions?: Maybe<Array<InterpreterVersion>>;
  listDelegatedAccess: Array<UserDelegatedAccess>;
  livePage?: Maybe<EncodedPageNodes>;
  localReferenceOptions: Array<DropdownOption>;
  login: Login;
  managedAndSubOrganizations: Array<Organization>;
  /** @deprecated Replaced with microsoftCSPCustomer query */
  managedOrgMsGraphTenantIdReferences: Array<ForeignObjectReference>;
  me?: Maybe<User>;
  messageVoteStats: MessageVoteStats;
  microsoftAllCSPCustomers: Array<MicrosoftCspCustomer>;
  microsoftCSPCustomer?: Maybe<MicrosoftCspCustomer>;
  microsoftCSPCustomers: Array<MicrosoftCspCustomer>;
  monacoFilterCompletionItems: Array<MonacoCompletionItem>;
  myAccessibleOrganizations: Array<Organization>;
  onboardingQuestionnaireResponse?: Maybe<OnboardingQuestionnaireResponse>;
  onboardingQuestionnaireResponses: Array<OnboardingQuestionnaireResponse>;
  orgFormFieldInstance?: Maybe<OrgFormFieldInstance>;
  orgFormFieldInstanceStatus?: Maybe<Scalars['Boolean']['output']>;
  orgFormFieldInstances?: Maybe<Array<OrgFormFieldInstance>>;
  orgInterpreterSetting?: Maybe<OrgInterpreterSetting>;
  orgInterpreterSettings: Array<OrgInterpreterSetting>;
  orgSearch: Array<OrgSearchResult>;
  orgTriggerInstance?: Maybe<OrgTriggerInstance>;
  orgTriggerInstances: Array<OrgTriggerInstance>;
  orgVariable?: Maybe<OrgVariable>;
  orgVariables: Array<OrgVariable>;
  organization?: Maybe<Organization>;
  organizationApiClients: ApiClientList;
  organizationOnboardingCrateRequirement?: Maybe<OrganizationOnboardingCrateRequirement>;
  organizationOnboardingCrateRequirements: Array<OrganizationOnboardingCrateRequirement>;
  organizationOnboardingPackRequirement?: Maybe<OrganizationOnboardingPackRequirement>;
  organizationOnboardingPackRequirements: Array<OrganizationOnboardingPackRequirement>;
  organizationOnboardingRequirement?: Maybe<OrganizationOnboardingRequirement>;
  organizations: Array<Organization>;
  organizationsWithFeaturePreviewSettingEnabled: Array<Organization>;
  pack?: Maybe<Pack>;
  packActionOption?: Maybe<PackActionOption>;
  packActionOptions: Array<PackActionOption>;
  packAuthUrl?: Maybe<Scalars['String']['output']>;
  packBundle?: Maybe<PackBundle>;
  packBundles: Array<Maybe<PackBundle>>;
  packConfig?: Maybe<PackConfig>;
  packConfigs: Array<PackConfig>;
  packConfigsForForm: Array<PackConfig>;
  packConfigsForOrg: Array<PackConfig>;
  packs: Array<Pack>;
  packsAndBundlesByInstalledState: PacksAndBundlesByInstalledState;
  packsByTag: Array<Pack>;
  packsForOrg: Array<Pack>;
  page?: Maybe<Page>;
  pageElements: Array<PageNode>;
  pageNode?: Maybe<PageNode>;
  pageNodes?: Maybe<EncodedPageNodes>;
  pageVars?: Maybe<Scalars['JSON']['output']>;
  pages: Array<Page>;
  pendingTasksAggregate: PendingTasksAggregate;
  permission?: Maybe<Permission>;
  permissions: Array<Permission>;
  publicCrates: Array<PublicCrate>;
  recentComponentVersions: Array<ComponentTree>;
  reservedOrganizationName?: Maybe<ReservedOrganizationName>;
  reservedOrganizationNames?: Maybe<Array<Maybe<ReservedOrganizationName>>>;
  resourceTypesByPack: Array<PackResourceTypesContainer>;
  roboRewstyConfigOption: RoboRewstyConfigValue;
  roboRewstyConfigOptions: Array<RoboRewstyConfigValue>;
  roles: Array<Role>;
  runner?: Maybe<Runner>;
  runners: Array<Runner>;
  searchInstalledPackActions: Array<Pack>;
  sensorType?: Maybe<SensorType>;
  sensorTypes: Array<SensorType>;
  site?: Maybe<Site>;
  sites: Array<Site>;
  softDeletedOrgs: Array<Organization>;
  tag?: Maybe<Tag>;
  tags: Array<Tag>;
  taskExecutionStats: Scalars['Int']['output'];
  taskLog?: Maybe<TaskLog>;
  taskLogs: Array<TaskLog>;
  /**
   * Query daily tasks executed and time saved statistics from Redshift data lake.
   * Returns aggregated task counts and time saved by date for an organization and its sub-orgs.
   */
  tasksExecutedAndTimeSavedStats?: Maybe<TasksExecutedAndTimeSavedStats>;
  template?: Maybe<Template>;
  templates: Array<Template>;
  timeSavedGroupBySubOrg: Array<TimeSavedGroupByOrg>;
  timeSavedGroupByWorkflow: Array<TimeSavedGroupByWorkflow>;
  trigger?: Maybe<Trigger>;
  triggerDbNotificationErrors: Array<DatabaseNotificationError>;
  triggerType?: Maybe<TriggerType>;
  triggerTypes: Array<TriggerType>;
  triggers: Array<Trigger>;
  user?: Maybe<User>;
  userInvite?: Maybe<UserInvite>;
  userInvites?: Maybe<Array<Maybe<UserInvite>>>;
  userOrganization?: Maybe<Organization>;
  users: Array<User>;
  validateSiteDomain?: Maybe<SiteDomainValid>;
  visibleOrgVariables: Array<OrgVariable>;
  visibleOrgVariablesCount: Scalars['Int']['output'];
  visibleWorkflows: Array<Workflow>;
  warrants?: Maybe<Scalars['JSON']['output']>;
  workflow?: Maybe<Workflow>;
  workflowCompletionListeners: Array<Trigger>;
  workflowExecution?: Maybe<WorkflowExecution>;
  workflowExecutionContexts?: Maybe<Scalars['JSON']['output']>;
  workflowExecutionStats?: Maybe<WorkflowExecutionStats>;
  workflowExecutions?: Maybe<Array<Maybe<WorkflowExecution>>>;
  workflowIOConfigurations: Array<Workflow>;
  workflowNote?: Maybe<WorkflowNote>;
  workflowNotes: Array<WorkflowNote>;
  workflowPatch: WorkflowPatch;
  workflowPatches: Array<WorkflowPatch>;
  workflowStatsByOrg: Array<WorkflowStatsByOrg>;
  workflowTask?: Maybe<WorkflowTask>;
  workflowTasks: Array<WorkflowTask>;
  workflows: Array<Workflow>;
};


export type QueryActionArgs = {
  search?: InputMaybe<ActionSearch>;
  where?: InputMaybe<ActionInput>;
};


export type QueryActionOptionArgs = {
  where?: InputMaybe<ActionOptionWhereInput>;
};


export type QueryActionOptionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  where?: InputMaybe<ActionOptionWhereInput>;
};


export type QueryActionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<ActionSearch>;
  where?: InputMaybe<ActionInput>;
};


export type QueryActionsForOrgArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  search?: InputMaybe<ActionSearch>;
  where?: InputMaybe<ActionInput>;
};


export type QueryApiClientArgs = {
  id: Scalars['ID']['input'];
};


export type QueryApiClientsArgs = {
  pagination?: InputMaybe<ApiClientListInput>;
  where?: InputMaybe<ApiClientWhereInput>;
};


export type QueryAppPlatformReservedDomainArgs = {
  search?: InputMaybe<AppPlatformReservedDomainSearchInput>;
  where?: InputMaybe<AppPlatformReservedDomainWhereInput>;
};


export type QueryAppPlatformReservedDomainsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  search?: InputMaybe<AppPlatformReservedDomainSearchInput>;
  where?: InputMaybe<AppPlatformReservedDomainWhereInput>;
};


export type QueryCheckArgs = {
  where: Array<CheckInput>;
};


export type QueryCheckAuthorizationArgs = {
  where: CheckAuthorizationInput;
};


export type QueryCommonlyUsedIntegrationActionsArgs = {
  integrationId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryComponentArgs = {
  id: Scalars['ID']['input'];
};


export type QueryComponentInstanceArgs = {
  id: Scalars['ID']['input'];
};


export type QueryComponentInstancesArgs = {
  orgId: Scalars['ID']['input'];
};


export type QueryComponentInstancesByComponentVersionArgs = {
  componentVersionId: Scalars['ID']['input'];
};


export type QueryComponentInstancesByPageArgs = {
  pageId: Scalars['ID']['input'];
};


export type QueryComponentTreeArgs = {
  id: Scalars['ID']['input'];
};


export type QueryComponentsArgs = {
  orgId: Scalars['ID']['input'];
};


export type QueryComponentsByRootsArgs = {
  rootIds: Array<InputMaybe<Scalars['ID']['input']>>;
};


export type QueryConversationArgs = {
  id: Scalars['ID']['input'];
};


export type QueryConversationMessageVotesArgs = {
  where?: InputMaybe<ConversationMessageVoteWhereInput>;
};


export type QueryConversationsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<InputMaybe<Array<Scalars['String']['input']>>>>;
  where?: InputMaybe<ConversationWhereInput>;
};


export type QueryCrateArgs = {
  search?: InputMaybe<CrateSearchInput>;
  selectedOrgId?: InputMaybe<Scalars['ID']['input']>;
  where?: InputMaybe<CrateWhereInput>;
};


export type QueryCrateCategoriesArgs = {
  selectedOrgId: Scalars['ID']['input'];
};


export type QueryCrateExportInfoArgs = {
  workflowId: Scalars['ID']['input'];
};


export type QueryCrateTagsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<TagSearchInput>;
  where?: InputMaybe<TagWhereInput>;
};


export type QueryCrateUnpackingArgumentSetArgs = {
  where?: InputMaybe<CrateUnpackingArgumentSetWhereInput>;
};


export type QueryCrateUseCaseArgs = {
  where?: InputMaybe<CrateUseCaseWhereInput>;
};


export type QueryCrateUseCasesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<CrateUseCaseSearchInput>;
  where?: InputMaybe<CrateUseCaseWhereInput>;
};


export type QueryCratesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<CrateSearchInput>;
  selectedOrgId?: InputMaybe<Scalars['ID']['input']>;
  where?: InputMaybe<CrateWhereInput>;
};


export type QueryCratesForFormArgs = {
  formId: Scalars['ID']['input'];
};


export type QueryCratesForTemplateArgs = {
  templateId: Scalars['ID']['input'];
};


export type QueryDailyTaskCountsByDateRangeArgs = {
  endDate: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  startDate: Scalars['String']['input'];
};


export type QueryDailyTimeSavedByDateRangeArgs = {
  endDate: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  startDate: Scalars['String']['input'];
};


export type QueryEvaluatedFormArgs = {
  orgContextId?: InputMaybe<Scalars['ID']['input']>;
  where?: InputMaybe<EvaluatedFormWhereInput>;
};


export type QueryExtractJinjaValuesArgs = {
  fields: Scalars['JSON']['input'];
  orgId: Scalars['ID']['input'];
};


export type QueryFeaturePreviewSettingArgs = {
  where?: InputMaybe<FeaturePreviewSettingWhereInput>;
};


export type QueryFeaturePreviewSettingsArgs = {
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  where?: InputMaybe<FeaturePreviewSettingWhereInput>;
};


export type QueryForeignObjectReferenceArgs = {
  where?: InputMaybe<ForeignObjectReferenceWhereInput>;
};


export type QueryForeignObjectReferencesArgs = {
  where?: InputMaybe<ForeignObjectReferenceWhereInput>;
};


export type QueryFormArgs = {
  orgContextId?: InputMaybe<Scalars['ID']['input']>;
  search?: InputMaybe<FormSearchInput>;
  where?: InputMaybe<FormWhereInput>;
};


export type QueryFormsArgs = {
  hasTagIds?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<FormSearchInput>;
  where?: InputMaybe<FormWhereInput>;
};


export type QueryGetAppPermissionsArgs = {
  orgId: Scalars['ID']['input'];
};


export type QueryGetSiteThemeArgs = {
  domain?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryGetTestUsersArgs = {
  where?: InputMaybe<GetUserWhereInput>;
};


export type QueryGetTriggerErrorStatusArgs = {
  triggerIds?: InputMaybe<Array<Scalars['ID']['input']>>;
};


export type QueryHomeArgs = {
  domain: Scalars['String']['input'];
};


export type QueryHourlyTaskCountByDateArgs = {
  date: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};


export type QueryHourlyTimeSavedByDateArgs = {
  date: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};


export type QueryIntegrationsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryIsOrgManagedByArgs = {
  orgId: Scalars['ID']['input'];
  parentOrgId: Scalars['ID']['input'];
};


export type QueryJinjaFilterDocumentationArgs = {
  filterName: Scalars['String']['input'];
};


export type QueryJinjaRenderSessionArgs = {
  conversationId?: InputMaybe<Scalars['ID']['input']>;
  id: Scalars['ID']['input'];
};


export type QueryJinjaTemplateArgs = {
  where?: InputMaybe<TemplateInput>;
};


export type QueryLatestInterpreterVersionsArgs = {
  language?: InputMaybe<Scalars['String']['input']>;
};


export type QueryListDelegatedAccessArgs = {
  organizationId: Scalars['ID']['input'];
};


export type QueryLivePageArgs = {
  domain?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  path: Scalars['String']['input'];
  query?: InputMaybe<Scalars['JSON']['input']>;
};


export type QueryLocalReferenceOptionsArgs = {
  filterArg?: InputMaybe<Scalars['JSON']['input']>;
  modelName: LocalReferenceModel;
  orgId: Scalars['ID']['input'];
};


export type QueryLoginArgs = {
  domain: Scalars['String']['input'];
};


export type QueryManagedAndSubOrganizationsArgs = {
  hasTagIds?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  parentOrgId: Scalars['ID']['input'];
  search?: InputMaybe<OrganizationSearchInput>;
};


export type QueryManagedOrgMsGraphTenantIdReferencesArgs = {
  orgId: Scalars['ID']['input'];
};


export type QueryMessageVoteStatsArgs = {
  conversationMessageId: Scalars['ID']['input'];
};


export type QueryMicrosoftAllCspCustomersArgs = {
  search?: InputMaybe<MicrosoftCspCustomerSearchInput>;
  where?: InputMaybe<MicrosoftCspCustomerWhereInput>;
};


export type QueryMicrosoftCspCustomerArgs = {
  cspPackConfigId: Scalars['ID']['input'];
  where?: InputMaybe<MicrosoftCspCustomerWhereInput>;
};


export type QueryMicrosoftCspCustomersArgs = {
  cspPackConfigId: Scalars['ID']['input'];
  search?: InputMaybe<MicrosoftCspCustomerSearchInput>;
  where?: InputMaybe<MicrosoftCspCustomerWhereInput>;
};


export type QueryOnboardingQuestionnaireResponseArgs = {
  where?: InputMaybe<OnboardingQuestionnaireResponseWhereInput>;
};


export type QueryOnboardingQuestionnaireResponsesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  where?: InputMaybe<OnboardingQuestionnaireResponseWhereInput>;
};


export type QueryOrgFormFieldInstanceArgs = {
  id: Scalars['ID']['input'];
};


export type QueryOrgFormFieldInstanceStatusArgs = {
  formId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
};


export type QueryOrgFormFieldInstancesArgs = {
  formFieldId: Scalars['ID']['input'];
};


export type QueryOrgInterpreterSettingArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
  language?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryOrgInterpreterSettingsArgs = {
  orgId: Scalars['ID']['input'];
};


export type QueryOrgSearchArgs = {
  breadcrumbRootOrgId: Scalars['ID']['input'];
  rootOrgId: Scalars['ID']['input'];
  search?: InputMaybe<Scalars['String']['input']>;
};


export type QueryOrgTriggerInstanceArgs = {
  search?: InputMaybe<OrgTriggerInstanceSearchInput>;
  where?: InputMaybe<OrgTriggerInstanceWhereInput>;
};


export type QueryOrgTriggerInstancesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<OrgTriggerInstanceSearchInput>;
  where?: InputMaybe<OrgTriggerInstanceWhereInput>;
};


export type QueryOrgVariableArgs = {
  maskSecrets?: InputMaybe<Scalars['Boolean']['input']>;
  search?: InputMaybe<OrgVariableSearchInput>;
  where?: InputMaybe<OrgVariableWhereInput>;
};


export type QueryOrgVariablesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  maskSecrets?: InputMaybe<Scalars['Boolean']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<OrgVariableSearchInput>;
  where?: InputMaybe<OrgVariableWhereInput>;
};


export type QueryOrganizationArgs = {
  search?: InputMaybe<OrganizationSearchInput>;
  where?: InputMaybe<OrganizationWhereInput>;
};


export type QueryOrganizationApiClientsArgs = {
  orgId: Scalars['ID']['input'];
  pagination?: InputMaybe<ApiClientListInput>;
};


export type QueryOrganizationOnboardingCrateRequirementArgs = {
  where?: InputMaybe<OrganizationOnboardingCrateRequirementWhereInput>;
};


export type QueryOrganizationOnboardingCrateRequirementsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<OrganizationOnboardingCrateRequirementSearchInput>;
  where?: InputMaybe<OrganizationOnboardingCrateRequirementWhereInput>;
};


export type QueryOrganizationOnboardingPackRequirementArgs = {
  where?: InputMaybe<OrganizationOnboardingPackRequirementWhereInput>;
};


export type QueryOrganizationOnboardingPackRequirementsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<OrganizationOnboardingPackRequirementSearchInput>;
  where?: InputMaybe<OrganizationOnboardingPackRequirementWhereInput>;
};


export type QueryOrganizationOnboardingRequirementArgs = {
  where?: InputMaybe<OrganizationOnboardingRequirementWhereInput>;
};


export type QueryOrganizationsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<OrganizationSearchInput>;
  where?: InputMaybe<OrganizationWhereInput>;
};


export type QueryOrganizationsWithFeaturePreviewSettingEnabledArgs = {
  label: Scalars['String']['input'];
};


export type QueryPackArgs = {
  where?: InputMaybe<PackWhereInput>;
};


export type QueryPackActionOptionArgs = {
  where?: InputMaybe<PackActionOptionWhereInput>;
};


export type QueryPackActionOptionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  where?: InputMaybe<PackActionOptionWhereInput>;
};


export type QueryPackAuthUrlArgs = {
  orgId: Scalars['ID']['input'];
  packName: Scalars['String']['input'];
};


export type QueryPackBundleArgs = {
  where: PackBundleWhereInput;
};


export type QueryPackBundlesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<PackBundleSearchInput>;
  where?: InputMaybe<PackBundleWhereInput>;
};


export type QueryPackConfigArgs = {
  includeSpec?: InputMaybe<Scalars['Boolean']['input']>;
  search?: InputMaybe<PackConfigSearch>;
  where?: InputMaybe<PackConfigWhereInput>;
};


export type QueryPackConfigsArgs = {
  includeSpec?: InputMaybe<Scalars['Boolean']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  resourceNames?: InputMaybe<Scalars['String']['input']>;
  search?: InputMaybe<PackConfigSearch>;
  where?: InputMaybe<PackConfigWhereInput>;
};


export type QueryPackConfigsForFormArgs = {
  formId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  triggerId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryPackConfigsForOrgArgs = {
  includeSpec?: InputMaybe<Scalars['Boolean']['input']>;
  orgId: Scalars['ID']['input'];
  packIds: Array<Scalars['ID']['input']>;
};


export type QueryPacksArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<PackSearchInput>;
  where?: InputMaybe<PackWhereInput>;
};


export type QueryPacksAndBundlesByInstalledStateArgs = {
  includeCustomPack?: InputMaybe<Scalars['Boolean']['input']>;
  orgId: Scalars['ID']['input'];
};


export type QueryPacksByTagArgs = {
  tagName: Scalars['String']['input'];
};


export type QueryPacksForOrgArgs = {
  includeSpec?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  search?: InputMaybe<PackSearchInput>;
  where?: InputMaybe<PackWhereInput>;
};


export type QueryPageArgs = {
  where: PageWhereInput;
};


export type QueryPageElementsArgs = {
  pageId: Scalars['ID']['input'];
};


export type QueryPageNodeArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPageNodesArgs = {
  where: PageWhereInput;
};


export type QueryPageVarsArgs = {
  id: Scalars['ID']['input'];
  query?: InputMaybe<Scalars['JSON']['input']>;
};


export type QueryPagesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<PageSearchInput>;
  where?: InputMaybe<PageWhereInput>;
};


export type QueryPendingTasksAggregateArgs = {
  where?: InputMaybe<PendingTasksAggregateInput>;
};


export type QueryPermissionArgs = {
  where?: InputMaybe<PermissionWhereInput>;
};


export type QueryPermissionsArgs = {
  where?: InputMaybe<PermissionWhereInput>;
};


export type QueryPublicCratesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryRecentComponentVersionsArgs = {
  componentId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryReservedOrganizationNameArgs = {
  where: ReservedOrganizationNameWhereInput;
};


export type QueryReservedOrganizationNamesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: Array<InputMaybe<Array<Scalars['String']['input']>>>;
  where?: InputMaybe<ReservedOrganizationNameWhereInput>;
};


export type QueryRoboRewstyConfigOptionArgs = {
  where?: InputMaybe<RoboRewstyConfigWhere>;
};


export type QueryRoboRewstyConfigOptionsArgs = {
  where?: InputMaybe<RoboRewstyConfigWhere>;
};


export type QueryRolesArgs = {
  where?: InputMaybe<RoleWhereInput>;
};


export type QueryRunnerArgs = {
  where?: InputMaybe<RunnerInput>;
};


export type QueryRunnersArgs = {
  where?: InputMaybe<RunnerInput>;
};


export type QuerySearchInstalledPackActionsArgs = {
  actionFilter?: InputMaybe<Scalars['String']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  orgId: Scalars['ID']['input'];
};


export type QuerySensorTypeArgs = {
  search?: InputMaybe<SensorTypeSearchInput>;
  where?: InputMaybe<SensorTypeInput>;
};


export type QuerySensorTypesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<SensorTypeSearchInput>;
  where?: InputMaybe<SensorTypeInput>;
};


export type QuerySiteArgs = {
  search?: InputMaybe<SiteSearchInput>;
  where?: InputMaybe<SiteWhereInput>;
};


export type QuerySitesArgs = {
  search?: InputMaybe<SiteSearchInput>;
  where?: InputMaybe<SiteWhereInput>;
};


export type QuerySoftDeletedOrgsArgs = {
  managingOrgId: Scalars['ID']['input'];
};


export type QueryTagArgs = {
  search?: InputMaybe<TagSearchInput>;
  where?: InputMaybe<TagWhereInput>;
};


export type QueryTagsArgs = {
  includeTagsWithNoOwner?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<TagSearchInput>;
  where?: InputMaybe<TagWhereInput>;
};


export type QueryTaskExecutionStatsArgs = {
  createdSince?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
};


export type QueryTaskLogArgs = {
  search?: InputMaybe<TaskLogSearchInput>;
  where?: InputMaybe<TaskLogWhereInput>;
};


export type QueryTaskLogsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<TaskLogSearchInput>;
  where?: InputMaybe<TaskLogWhereInput>;
};


export type QueryTasksExecutedAndTimeSavedStatsArgs = {
  endDate: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  startDate: Scalars['String']['input'];
};


export type QueryTemplateArgs = {
  where?: InputMaybe<TemplateInput>;
};


export type QueryTemplatesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<TemplateSearch>;
  where?: InputMaybe<TemplateInput>;
};


export type QueryTimeSavedGroupBySubOrgArgs = {
  orgId: Scalars['ID']['input'];
  updatedAt: Scalars['String']['input'];
  useStatsTable?: Scalars['Boolean']['input'];
  workflowStatus?: InputMaybe<Scalars['String']['input']>;
};


export type QueryTimeSavedGroupByWorkflowArgs = {
  orgId: Scalars['ID']['input'];
  updatedAt: Scalars['String']['input'];
  useStatsTable?: Scalars['Boolean']['input'];
  workflowStatus?: InputMaybe<Scalars['String']['input']>;
};


export type QueryTriggerArgs = {
  search?: InputMaybe<TriggerSearchInput>;
  where?: InputMaybe<TriggerWhereInput>;
};


export type QueryTriggerDbNotificationErrorsArgs = {
  triggerId: Scalars['ID']['input'];
};


export type QueryTriggerTypeArgs = {
  where?: InputMaybe<TriggerTypeWhereInput>;
};


export type QueryTriggerTypesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<TriggerTypesSearchInput>;
  where?: InputMaybe<TriggerTypeWhereInput>;
};


export type QueryTriggersArgs = {
  includeUnlisted?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<TriggerSearchInput>;
  where?: InputMaybe<TriggerWhereInput>;
};


export type QueryUserArgs = {
  search?: InputMaybe<UserSearchInput>;
  where?: InputMaybe<GetUserWhereInput>;
};


export type QueryUserInviteArgs = {
  search?: InputMaybe<UserInviteSearchInput>;
  where?: InputMaybe<UserInviteWhereInput>;
};


export type QueryUserInvitesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<UserInviteSearchInput>;
  where?: InputMaybe<UserInviteWhereInput>;
};


export type QueryUsersArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<UserSearchInput>;
  where?: InputMaybe<GetUserWhereInput>;
};


export type QueryValidateSiteDomainArgs = {
  domain: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};


export type QueryVisibleOrgVariablesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<OrgVariableSearchInput>;
  visibleForOrgId: Scalars['ID']['input'];
};


export type QueryVisibleOrgVariablesCountArgs = {
  search?: InputMaybe<OrgVariableSearchInput>;
  visibleForOrgId: Scalars['ID']['input'];
};


export type QueryVisibleWorkflowsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  search?: InputMaybe<WorkflowSearch>;
  where?: InputMaybe<WorkflowWhereInput>;
};


export type QueryWarrantsArgs = {
  where: QueryInput;
};


export type QueryWorkflowArgs = {
  search?: InputMaybe<WorkflowSearch>;
  where?: InputMaybe<WorkflowWhereInput>;
};


export type QueryWorkflowCompletionListenersArgs = {
  search?: InputMaybe<TriggerSearchInput>;
  where?: InputMaybe<TriggerWhereInput>;
};


export type QueryWorkflowExecutionArgs = {
  search?: InputMaybe<WorkflowExecutionSearchInput>;
  where?: InputMaybe<WorkflowExecutionWhereInput>;
};


export type QueryWorkflowExecutionContextsArgs = {
  workflowExecutionId: Scalars['ID']['input'];
};


export type QueryWorkflowExecutionStatsArgs = {
  createdSince: Scalars['String']['input'];
  includeSubWorkflows?: InputMaybe<Scalars['Boolean']['input']>;
  orgId: Scalars['ID']['input'];
  rollUpTimeSaved?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryWorkflowExecutionsArgs = {
  includeSubOrgs?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<WorkflowExecutionSearchInput>;
  where?: InputMaybe<WorkflowExecutionWhereInput>;
};


export type QueryWorkflowIoConfigurationsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type QueryWorkflowNoteArgs = {
  where?: InputMaybe<WorkflowNoteWhereInput>;
};


export type QueryWorkflowNotesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<WorkflowNoteSearchInput>;
  where?: InputMaybe<WorkflowNoteWhereInput>;
};


export type QueryWorkflowPatchArgs = {
  id: Scalars['ID']['input'];
};


export type QueryWorkflowPatchesArgs = {
  createdSince?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<WorkflowPatchOrderByInput>;
  where?: InputMaybe<WorkflowPatchWhereInput>;
};


export type QueryWorkflowStatsByOrgArgs = {
  endDate: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  startDate: Scalars['String']['input'];
};


export type QueryWorkflowTaskArgs = {
  where?: InputMaybe<WorkflowTaskWhereInput>;
};


export type QueryWorkflowTasksArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  where?: InputMaybe<WorkflowTaskWhereInput>;
};


export type QueryWorkflowsArgs = {
  excludeTagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  hasClones?: InputMaybe<Scalars['Boolean']['input']>;
  hasListeners?: InputMaybe<Scalars['Boolean']['input']>;
  hasParentWorkflows?: InputMaybe<Scalars['Boolean']['input']>;
  hasTagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  hasTokens?: InputMaybe<Scalars['Boolean']['input']>;
  hasTriggerOfType?: InputMaybe<TriggerOfType>;
  hasTriggers?: InputMaybe<Scalars['Boolean']['input']>;
  isClone?: InputMaybe<Scalars['Boolean']['input']>;
  isCrate?: InputMaybe<Scalars['Boolean']['input']>;
  isCrateSource?: InputMaybe<Scalars['Boolean']['input']>;
  isOptionsGenerator?: InputMaybe<Scalars['Boolean']['input']>;
  isSyncClone?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  requireMatchingTasks?: InputMaybe<Scalars['Boolean']['input']>;
  search?: InputMaybe<WorkflowSearch>;
  where?: InputMaybe<WorkflowWhereInput>;
};

export type QueryInput = {
  objectId?: InputMaybe<Scalars['String']['input']>;
  objectType?: InputMaybe<Scalars['String']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
  relation?: InputMaybe<Scalars['String']['input']>;
  subjectId?: InputMaybe<Scalars['String']['input']>;
  subjectType?: InputMaybe<Scalars['String']['input']>;
};

export type RateLimitingStatusEvent = {
  __typename?: 'RateLimitingStatusEvent';
  eventId?: Maybe<Scalars['String']['output']>;
  payload?: Maybe<Scalars['JSON']['output']>;
};

export type ReasonCount = {
  __typename?: 'ReasonCount';
  count: Scalars['Int']['output'];
  reason: VoteReason;
};

export enum Relation {
  Editor = 'editor',
  Member = 'member',
  Owner = 'owner'
}

export type RenderedJinja = {
  __typename?: 'RenderedJinja';
  content: Scalars['String']['output'];
  id: Scalars['String']['output'];
};

export type RenderedPage = {
  __typename?: 'RenderedPage';
  executionId?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  loader?: Maybe<Loader>;
  name: Scalars['String']['output'];
  path: Scalars['String']['output'];
  renderedJinja?: Maybe<RenderedJinja>;
  site: Site;
  useEditor?: Maybe<Scalars['Boolean']['output']>;
};

export type ResendUserInviteEmailStreamEvent = ResendUserInviteEmailStreamFailureResponse | ResendUserInviteEmailStreamSuccessResponse;

export type ResendUserInviteEmailStreamFailureResponse = BaseStreamEvent & {
  __typename?: 'ResendUserInviteEmailStreamFailureResponse';
  didSucceed: Scalars['Boolean']['output'];
  error: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
};

export type ResendUserInviteEmailStreamSuccessResponse = BaseStreamEvent & {
  __typename?: 'ResendUserInviteEmailStreamSuccessResponse';
  didSucceed: Scalars['Boolean']['output'];
  isFinished: Scalars['Boolean']['output'];
  recipient: Scalars['String']['output'];
};

export type ReservedOrganizationName = {
  __typename?: 'ReservedOrganizationName';
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
};

export type ReservedOrganizationNameWhereInput = {
  createdAt?: InputMaybe<Scalars['String']['input']>;
  createdBy?: InputMaybe<UserWhereInput>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  updatedAt?: InputMaybe<Scalars['String']['input']>;
  updatedBy?: InputMaybe<UserWhereInput>;
};

export type RoboRewstyConfigValue = {
  __typename?: 'RoboRewstyConfigValue';
  configKey?: Maybe<Scalars['String']['output']>;
  configName?: Maybe<Scalars['String']['output']>;
  configValue?: Maybe<Scalars['JSON']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type RoboRewstyConfigWhere = {
  configKey?: InputMaybe<Scalars['String']['input']>;
  configName?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
};

export type Role = {
  __typename?: 'Role';
  authorizedPermissions?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  description?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  orgId?: Maybe<Scalars['ID']['output']>;
};

export type RoleCreateInput = {
  authorizedPermissions?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  rolePermissions?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type RoleUpdateInput = {
  authorizedPermissions?: InputMaybe<Array<Scalars['String']['input']>>;
  id: Scalars['ID']['input'];
  rolePermissions?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type RoleWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
};

export type Runner = {
  __typename?: 'Runner';
  actions: Array<Action>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  outputKey?: Maybe<Scalars['String']['output']>;
  outputSchema?: Maybe<Scalars['JSON']['output']>;
  runnerParameters?: Maybe<Scalars['JSON']['output']>;
};

export type RunnerInput = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  outputKey?: InputMaybe<Scalars['String']['input']>;
  outputSchema?: InputMaybe<Scalars['JSON']['input']>;
  runnerParameters?: InputMaybe<Scalars['JSON']['input']>;
};

export type SensorType = {
  __typename?: 'SensorType';
  description?: Maybe<Scalars['String']['output']>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  entryPoint?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  notifyOnTriggerChanges?: Maybe<Scalars['Boolean']['output']>;
  pack?: Maybe<Pack>;
  ref?: Maybe<Scalars['String']['output']>;
  triggerTypes: Array<TriggerType>;
};

export type SensorTypeInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  entryPoint?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  notifyOnTriggerChanges?: InputMaybe<Scalars['Boolean']['input']>;
  packId?: InputMaybe<Scalars['ID']['input']>;
  ref?: InputMaybe<Scalars['String']['input']>;
};

export type SensorTypeSearchInput = {
  description?: InputMaybe<String_Comparison_Exp>;
  enabled?: InputMaybe<Bool_Comparison_Exp>;
  entryPoint?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  notifyOnTriggerChanges?: InputMaybe<Scalars['Boolean']['input']>;
  packId?: InputMaybe<Id_Comparison_Exp>;
  ref?: InputMaybe<String_Comparison_Exp>;
};

export type SetFormTagsInput = {
  id: Scalars['ID']['input'];
  tagIds: Array<Scalars['ID']['input']>;
};

export type ShallowCloneOverridesInput = {
  name?: InputMaybe<Scalars['String']['input']>;
};

export type ShallowWorkflowCloneOverridesInput = {
  name?: InputMaybe<Scalars['String']['input']>;
};

export type Site = {
  __typename?: 'Site';
  cloneOverrides?: Maybe<Scalars['JSON']['output']>;
  clonedFrom?: Maybe<Site>;
  clonedFromId?: Maybe<Scalars['ID']['output']>;
  clones?: Maybe<Array<Maybe<Site>>>;
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  createdById?: Maybe<Scalars['ID']['output']>;
  customDomain?: Maybe<Scalars['String']['output']>;
  domain?: Maybe<Scalars['String']['output']>;
  faviconUrl?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isDnsValidated?: Maybe<Scalars['Boolean']['output']>;
  isLive?: Maybe<Scalars['Boolean']['output']>;
  isSynchronized?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
  organization?: Maybe<Organization>;
  pages?: Maybe<Array<Maybe<Page>>>;
  permission?: Maybe<Permission>;
  shared?: Maybe<Scalars['Boolean']['output']>;
  statusCode?: Maybe<Scalars['Int']['output']>;
  statusMessage?: Maybe<Scalars['String']['output']>;
  template?: Maybe<Scalars['String']['output']>;
  theme?: Maybe<Scalars['JSON']['output']>;
  themeReferenceOrgVariable?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
  useCustomDomain?: Maybe<Scalars['Boolean']['output']>;
};

export type SiteCreateInput = {
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  domain?: InputMaybe<Scalars['String']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
  pages?: InputMaybe<Array<InputMaybe<PagesImportInput>>>;
  template?: InputMaybe<Scalars['String']['input']>;
  theme?: InputMaybe<Scalars['JSON']['input']>;
};

export type SiteDomainValid = {
  __typename?: 'SiteDomainValid';
  isValid: Scalars['Boolean']['output'];
  message: Scalars['String']['output'];
};

export type SiteOverridesInput = {
  domain?: InputMaybe<Scalars['String']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type SitePropertiesInput = {
  domain?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
};

export type SiteSearchInput = {
  clonedFromId?: InputMaybe<Id_Comparison_Exp>;
  customDomain?: InputMaybe<String_Comparison_Exp>;
  domain?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  isDnsValidated?: InputMaybe<Bool_Comparison_Exp>;
  isLive?: InputMaybe<Bool_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  organization?: InputMaybe<OrganizationSearchInput>;
  organizationId?: InputMaybe<Id_Comparison_Exp>;
  useCustomDomain?: InputMaybe<Bool_Comparison_Exp>;
};

export type SiteUpdateInput = {
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  customDomain?: InputMaybe<Scalars['String']['input']>;
  domain?: InputMaybe<Scalars['String']['input']>;
  faviconUrl?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  isDnsValidated?: InputMaybe<Scalars['Boolean']['input']>;
  isLive?: InputMaybe<Scalars['Boolean']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  layout?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  pages?: InputMaybe<Array<InputMaybe<PagesImportInput>>>;
  statusCode?: InputMaybe<Scalars['Int']['input']>;
  statusMessage?: InputMaybe<Scalars['String']['input']>;
  theme?: InputMaybe<Scalars['JSON']['input']>;
  themeReferenceOrgVariable?: InputMaybe<Scalars['String']['input']>;
  useCustomDomain?: InputMaybe<Scalars['Boolean']['input']>;
};

export type SiteWhereInput = {
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  customDomain?: InputMaybe<Scalars['String']['input']>;
  domain?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isDnsValidated?: InputMaybe<Scalars['Boolean']['input']>;
  isLive?: InputMaybe<Scalars['Boolean']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  useCustomDomain?: InputMaybe<Scalars['Boolean']['input']>;
};

export type SourceField = {
  __typename?: 'SourceField';
  fieldCondition?: Maybe<FieldCondition>;
  id: Scalars['ID']['output'];
  index?: Maybe<Scalars['Int']['output']>;
  schema?: Maybe<Scalars['JSON']['output']>;
};

export type Subscription = {
  __typename?: 'Subscription';
  actionResults?: Maybe<Scalars['JSON']['output']>;
  adminExportPackDocs?: Maybe<Scalars['JSON']['output']>;
  adminExportPackYaml?: Maybe<Scalars['JSON']['output']>;
  appLogs?: Maybe<Scalars['JSON']['output']>;
  azureFunctionAppInterpreterDeployment?: Maybe<AzureFunctionAppInterpreterDeploymentStreamEvent>;
  azureFunctionAppInterpreterRollback?: Maybe<AzureFunctionAppInterpreterDeploymentStreamEvent>;
  azureFunctionAppInterpreterUpdate?: Maybe<AzureFunctionAppInterpreterDeploymentStreamEvent>;
  cloneForm?: Maybe<CloneObjectStreamEvent>;
  cloneSite?: Maybe<CloneObjectStreamEvent>;
  cloneTemplate?: Maybe<CloneObjectStreamEvent>;
  cloneWorkflow?: Maybe<CloneObjectStreamEvent>;
  componentTriggered?: Maybe<Scalars['JSON']['output']>;
  conversationMessage: ConversationMessageResponse;
  debug?: Maybe<Scalars['Boolean']['output']>;
  exportObjects?: Maybe<ExportObjectsStreamEvent>;
  importBundle?: Maybe<ImportBundleStreamEvent>;
  microsoftBundleAuthorizationRequest?: Maybe<MicrosoftBundleAuthorizationRequestStreamEvent>;
  microsoftBundleRevocationRequest?: Maybe<MicrosoftBundleAuthorizationRequestStreamEvent>;
  microsoftCSPConsentRequest?: Maybe<MicrosoftCspConsentRequestStreamEvent>;
  microsoftPermissionsSyncRequest?: Maybe<MicrosoftBundleAuthorizationRequestStreamEvent>;
  newWorkflowExecutions?: Maybe<NewWorkflowExecutionEvent>;
  openapiConversion: JParserConversionResult;
  publishCrate?: Maybe<PublishCrateStreamEvent>;
  rateLimitingStatus?: Maybe<RateLimitingStatusEvent>;
  renderPage?: Maybe<Scalars['JSON']['output']>;
  resendUserInviteEmail?: Maybe<ResendUserInviteEmailStreamEvent>;
  synchronizeClones?: Maybe<SynchronizeClonesStreamEvent>;
  taskLogs?: Maybe<TaskLogEvent>;
  triggerCriteria?: Maybe<TriggerCriteriaEvent>;
  unpackCrate?: Maybe<UnpackCrateStreamEvent>;
  workflowEvents?: Maybe<Scalars['JSON']['output']>;
  workflowOutputs?: Maybe<Scalars['JSON']['output']>;
  workflowResults?: Maybe<Scalars['JSON']['output']>;
  workflowStatus?: Maybe<Scalars['JSON']['output']>;
};


export type SubscriptionActionResultsArgs = {
  executionId: Scalars['ID']['input'];
};


export type SubscriptionAdminExportPackDocsArgs = {
  packId: Scalars['ID']['input'];
};


export type SubscriptionAdminExportPackYamlArgs = {
  packId: Scalars['ID']['input'];
};


export type SubscriptionAppLogsArgs = {
  domain: Scalars['String']['input'];
};


export type SubscriptionAzureFunctionAppInterpreterDeploymentArgs = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  language: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};


export type SubscriptionAzureFunctionAppInterpreterRollbackArgs = {
  language: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};


export type SubscriptionAzureFunctionAppInterpreterUpdateArgs = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  language: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};


export type SubscriptionCloneFormArgs = {
  id: Scalars['ID']['input'];
  includeInsignificantProgress?: InputMaybe<Scalars['Boolean']['input']>;
  orgId: Scalars['ID']['input'];
  overrides?: InputMaybe<FormCloneOverridesInput>;
};


export type SubscriptionCloneSiteArgs = {
  id: Scalars['ID']['input'];
  includeInsignificantProgress?: InputMaybe<Scalars['Boolean']['input']>;
  orgId: Scalars['ID']['input'];
  overrides?: InputMaybe<SiteOverridesInput>;
};


export type SubscriptionCloneTemplateArgs = {
  id: Scalars['ID']['input'];
  includeInsignificantProgress?: InputMaybe<Scalars['Boolean']['input']>;
  orgId: Scalars['ID']['input'];
  overrides?: InputMaybe<TemplateInput>;
};


export type SubscriptionCloneWorkflowArgs = {
  id: Scalars['ID']['input'];
  includeInsignificantProgress?: InputMaybe<Scalars['Boolean']['input']>;
  orgId: Scalars['ID']['input'];
  overrides?: InputMaybe<WorkflowInput>;
};


export type SubscriptionComponentTriggeredArgs = {
  context?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  inputs?: InputMaybe<Scalars['JSON']['input']>;
  jinjaList: Array<InputMaybe<JinjaTemplateMapInput>>;
  pageId: Scalars['ID']['input'];
  payload?: InputMaybe<Scalars['JSON']['input']>;
  query?: InputMaybe<Scalars['JSON']['input']>;
  runAsOrgId?: InputMaybe<Scalars['ID']['input']>;
  workflows?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};


export type SubscriptionConversationMessageArgs = {
  conversationId?: InputMaybe<Scalars['ID']['input']>;
  conversationType?: InputMaybe<Scalars['String']['input']>;
  message: Scalars['String']['input'];
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  orgId: Scalars['ID']['input'];
};


export type SubscriptionExportObjectsArgs = {
  objects: Array<ExportRequestObject>;
};


export type SubscriptionImportBundleArgs = {
  bundle: ImportBundle;
  includeInsignificantProgress?: InputMaybe<Scalars['Boolean']['input']>;
  orgId: Scalars['ID']['input'];
  siteId?: InputMaybe<Scalars['ID']['input']>;
  triggerOverrides: Array<TriggerOverride>;
};


export type SubscriptionMicrosoftBundleAuthorizationRequestArgs = {
  orgId: Scalars['ID']['input'];
  packBundleId: Scalars['ID']['input'];
};


export type SubscriptionMicrosoftBundleRevocationRequestArgs = {
  orgId: Scalars['ID']['input'];
  packBundleId: Scalars['ID']['input'];
};


export type SubscriptionMicrosoftCspConsentRequestArgs = {
  action?: InputMaybe<CspConsentAction>;
  applicationGrants?: InputMaybe<Array<CspApplicationGrant>>;
  packConfigId: Scalars['ID']['input'];
  tenantIds: Array<Scalars['ID']['input']>;
};


export type SubscriptionMicrosoftPermissionsSyncRequestArgs = {
  orgId: Scalars['ID']['input'];
  packConfigId: Scalars['ID']['input'];
};


export type SubscriptionNewWorkflowExecutionsArgs = {
  eventId?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};


export type SubscriptionOpenapiConversionArgs = {
  openapiDoc: Scalars['JSON']['input'];
  orgId: Scalars['ID']['input'];
};


export type SubscriptionPublishCrateArgs = {
  crateId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  workflowId: Scalars['ID']['input'];
};


export type SubscriptionRateLimitingStatusArgs = {
  eventId?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
};


export type SubscriptionRenderPageArgs = {
  additionalWorkflows?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  jinjaList?: InputMaybe<Array<InputMaybe<JinjaTemplateMapInput>>>;
  query?: InputMaybe<Scalars['JSON']['input']>;
  runAsOrgId?: InputMaybe<Scalars['ID']['input']>;
  where: PageWhereInput;
};


export type SubscriptionResendUserInviteEmailArgs = {
  inviteId: Scalars['ID']['input'];
};


export type SubscriptionSynchronizeClonesArgs = {
  cloneIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  id: Scalars['ID']['input'];
  includeInsignificantProgress?: InputMaybe<Scalars['Boolean']['input']>;
  objectType: CloneableObjectType;
  shouldPublishCrates?: InputMaybe<Scalars['Boolean']['input']>;
};


export type SubscriptionTaskLogsArgs = {
  eventId?: InputMaybe<Scalars['String']['input']>;
  executionId: Scalars['ID']['input'];
  includeStatuses?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type SubscriptionTriggerCriteriaArgs = {
  triggerId: Scalars['ID']['input'];
};


export type SubscriptionUnpackCrateArgs = {
  includeInsignificantProgress?: InputMaybe<Scalars['Boolean']['input']>;
  unpackingArguments: UnpackCrateInput;
};


export type SubscriptionWorkflowEventsArgs = {
  eventId?: InputMaybe<Scalars['String']['input']>;
  workflowId: Scalars['ID']['input'];
};


export type SubscriptionWorkflowOutputsArgs = {
  eventId?: InputMaybe<Scalars['String']['input']>;
  workflowId: Scalars['ID']['input'];
};


export type SubscriptionWorkflowResultsArgs = {
  executionId: Scalars['ID']['input'];
};


export type SubscriptionWorkflowStatusArgs = {
  executionId: Scalars['ID']['input'];
};

export type SupportAccessStatus = {
  __typename?: 'SupportAccessStatus';
  expiresAt?: Maybe<Scalars['String']['output']>;
  isEnabled: Scalars['Boolean']['output'];
};

export type SwaggerToOpenapiConversionResult = {
  __typename?: 'SwaggerToOpenapiConversionResult';
  errors?: Maybe<Scalars['JSON']['output']>;
  openapiDoc?: Maybe<Scalars['JSON']['output']>;
};

export type SynchronizeClonesImportPhaseStreamFailureMessage = BaseStreamEvent & PhasedCloneEvent & {
  __typename?: 'SynchronizeClonesImportPhaseStreamFailureMessage';
  code?: Maybe<Scalars['String']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  isFinished: Scalars['Boolean']['output'];
  phase: ClonePhase;
  requestId: Scalars['ID']['output'];
};

export type SynchronizeClonesStreamEvent = CloningExportPhaseStreamFailureResponse | CloningExportPhaseStreamMessage | CloningImportPhaseStreamMessage | SynchronizeClonesImportPhaseStreamFailureMessage | SynchronizeClonesStreamResponse;

export type SynchronizeClonesStreamResponse = BaseCloningResponse & BaseStreamEvent & {
  __typename?: 'SynchronizeClonesStreamResponse';
  cloneIds: Array<Scalars['ID']['output']>;
  didSucceed: Scalars['Boolean']['output'];
  failedCloneIds: Array<Scalars['ID']['output']>;
  isFinished: Scalars['Boolean']['output'];
};

export type SynchronizedPackConfig = {
  __typename?: 'SynchronizedPackConfig';
  config?: Maybe<Scalars['JSON']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  name: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
  packId: Scalars['ID']['output'];
};

export type Tag = {
  __typename?: 'Tag';
  color?: Maybe<Scalars['String']['output']>;
  crates?: Maybe<Array<Crate>>;
  createdAt?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  orgId?: Maybe<Scalars['ID']['output']>;
  organization?: Maybe<Organization>;
  organizations: Array<Organization>;
  packs: Array<Pack>;
  triggers: Array<Trigger>;
  updatedAt?: Maybe<Scalars['String']['output']>;
};

export type TagCreateInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId: Scalars['ID']['input'];
};

export type TagInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
};

export type TagOrganizationsWhereInput = {
  id?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};

export type TagSearchInput = {
  id?: InputMaybe<Id_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
  organizations?: InputMaybe<OrganizationSearchInput>;
};

export type TagUpdateInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};

export type TagWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  organizations?: InputMaybe<TagOrganizationsWhereInput>;
};

export type TaskCountByDate = {
  __typename?: 'TaskCountByDate';
  count: Scalars['Int']['output'];
  date: Scalars['String']['output'];
};

export type TaskCountByHour = {
  __typename?: 'TaskCountByHour';
  count: Scalars['Int']['output'];
  hour: Scalars['String']['output'];
};

export type TaskLog = {
  __typename?: 'TaskLog';
  createdAt?: Maybe<Scalars['String']['output']>;
  executionId?: Maybe<Scalars['String']['output']>;
  executionTime?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  input?: Maybe<Scalars['JSON']['output']>;
  message?: Maybe<Scalars['String']['output']>;
  originalParentTaskId?: Maybe<Scalars['String']['output']>;
  originalPrincipalOrgId?: Maybe<Scalars['ID']['output']>;
  originalPrincipalOrgName?: Maybe<Scalars['String']['output']>;
  originalRunAsOrgId?: Maybe<Scalars['String']['output']>;
  originalRunAsOrgName?: Maybe<Scalars['String']['output']>;
  originalWorkflowExecutionId?: Maybe<Scalars['String']['output']>;
  originalWorkflowTaskId?: Maybe<Scalars['String']['output']>;
  originalWorkflowTaskName?: Maybe<Scalars['String']['output']>;
  parentTask?: Maybe<WorkflowTask>;
  parentTaskId?: Maybe<Scalars['ID']['output']>;
  principalOrg?: Maybe<Organization>;
  principalOrgId?: Maybe<Scalars['ID']['output']>;
  result?: Maybe<Scalars['JSON']['output']>;
  runAsOrg?: Maybe<Organization>;
  runAsOrgId?: Maybe<Scalars['ID']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  taskExecutionId?: Maybe<Scalars['ID']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  workflow?: Maybe<Workflow>;
  workflowExecution?: Maybe<WorkflowExecution>;
  workflowExecutionId?: Maybe<Scalars['String']['output']>;
  workflowTask?: Maybe<WorkflowTask>;
  workflowTaskId?: Maybe<Scalars['ID']['output']>;
};

export type TaskLogEvent = BaseStreamEvent & {
  __typename?: 'TaskLogEvent';
  eventId: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
  taskLog?: Maybe<TaskLog>;
  workflowStatus?: Maybe<Scalars['String']['output']>;
};

export type TaskLogInput = {
  executionTime?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  input?: InputMaybe<Scalars['JSON']['input']>;
  message?: InputMaybe<Scalars['String']['input']>;
  originalParentTaskId?: InputMaybe<Scalars['String']['input']>;
  originalWorkflowExecutionId: Scalars['String']['input'];
  originalWorkflowTaskId?: InputMaybe<Scalars['String']['input']>;
  result?: InputMaybe<Scalars['JSON']['input']>;
  status: Scalars['String']['input'];
  taskExecutionId?: InputMaybe<Scalars['ID']['input']>;
};

export type TaskLogSearchInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  originalPrincipalOrgId?: InputMaybe<String_Comparison_Exp>;
  originalPrincipalOrgName?: InputMaybe<String_Comparison_Exp>;
  originalRunAsOrgId?: InputMaybe<String_Comparison_Exp>;
  originalRunAsOrgName?: InputMaybe<String_Comparison_Exp>;
  principalOrgId?: InputMaybe<Id_Comparison_Exp>;
  runAsOrgId?: InputMaybe<Id_Comparison_Exp>;
  status?: InputMaybe<String_Comparison_Exp>;
  workflowExecutionId?: InputMaybe<Id_Comparison_Exp>;
};

export type TaskLogWhereInput = {
  executionTime?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  input?: InputMaybe<Scalars['JSON']['input']>;
  message?: InputMaybe<Scalars['String']['input']>;
  originalParentTaskId?: InputMaybe<Scalars['String']['input']>;
  originalPrincipalOrgId?: InputMaybe<Scalars['String']['input']>;
  originalPrincipalOrgName?: InputMaybe<Scalars['String']['input']>;
  originalRunAsOrgId?: InputMaybe<Scalars['String']['input']>;
  originalRunAsOrgName?: InputMaybe<Scalars['String']['input']>;
  originalWorkflowExecutionId?: InputMaybe<Scalars['String']['input']>;
  originalWorkflowTaskId?: InputMaybe<Scalars['String']['input']>;
  parentTaskId?: InputMaybe<Scalars['ID']['input']>;
  principalOrgId?: InputMaybe<Scalars['ID']['input']>;
  result?: InputMaybe<Scalars['JSON']['input']>;
  runAsOrgId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  taskExecutionId?: InputMaybe<Scalars['ID']['input']>;
  workflowExecutionId?: InputMaybe<Scalars['ID']['input']>;
  workflowTaskId?: InputMaybe<Scalars['ID']['input']>;
};

export type TasksExecutedAndTimeSavedStats = {
  __typename?: 'TasksExecutedAndTimeSavedStats';
  taskCounts: Array<TaskCountByDate>;
  timeSaved: Array<TimeSavedByDate>;
};

export type Template = {
  __typename?: 'Template';
  body: Scalars['String']['output'];
  cloneOverrides?: Maybe<Scalars['JSON']['output']>;
  clonedFrom?: Maybe<Template>;
  clonedFromId?: Maybe<Scalars['ID']['output']>;
  clones?: Maybe<Array<Maybe<Template>>>;
  contentType: Scalars['String']['output'];
  context?: Maybe<Scalars['JSON']['output']>;
  createdAt: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isShared?: Maybe<Scalars['Boolean']['output']>;
  isSynchronized?: Maybe<Scalars['Boolean']['output']>;
  language: Scalars['String']['output'];
  name: Scalars['String']['output'];
  orgId: Scalars['ID']['output'];
  organization: Organization;
  permission?: Maybe<Permission>;
  tags: Array<Tag>;
  unpackedFrom?: Maybe<Crate>;
  unpackedFromId?: Maybe<Scalars['ID']['output']>;
  updatedAt: Scalars['String']['output'];
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
};

export type TemplateCreateInput = {
  body: Scalars['String']['input'];
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  contentType?: InputMaybe<Scalars['String']['input']>;
  context?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isShared?: InputMaybe<Scalars['Boolean']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  language?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  tags?: InputMaybe<Array<TagInput>>;
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
};

export type TemplateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  contentType?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  language?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
};

export type TemplateSearch = {
  clonedFromId?: InputMaybe<Id_Comparison_Exp>;
  contentType?: InputMaybe<String_Comparison_Exp>;
  description?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  isSynchronized?: InputMaybe<Bool_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  organization?: InputMaybe<OrganizationSearchInput>;
  unpackedFromId?: InputMaybe<Id_Comparison_Exp>;
};

export type TemplateUpdateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  contentType?: InputMaybe<Scalars['String']['input']>;
  context?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  isShared?: InputMaybe<Scalars['Boolean']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  language?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  tags?: InputMaybe<Array<TagInput>>;
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
};

export type ThemeConfigGeneratorResponse = {
  __typename?: 'ThemeConfigGeneratorResponse';
  config: Scalars['JSON']['output'];
};

export type TimeSavedByDate = {
  __typename?: 'TimeSavedByDate';
  date: Scalars['String']['output'];
  seconds: Scalars['Int']['output'];
};

export type TimeSavedByHour = {
  __typename?: 'TimeSavedByHour';
  hour: Scalars['String']['output'];
  seconds?: Maybe<Scalars['Int']['output']>;
};

export type TimeSavedGroupByOrg = {
  __typename?: 'TimeSavedGroupByOrg';
  ranForOrg?: Maybe<Scalars['String']['output']>;
  secondsSaved?: Maybe<Scalars['Int']['output']>;
  totalExecutions?: Maybe<Scalars['Int']['output']>;
  workflowId: Scalars['ID']['output'];
  workflowName?: Maybe<Scalars['String']['output']>;
};

export type TimeSavedGroupByWorkflow = {
  __typename?: 'TimeSavedGroupByWorkflow';
  failedExecutions?: Maybe<Scalars['Int']['output']>;
  secondsSaved?: Maybe<Scalars['Int']['output']>;
  successfulExecutions?: Maybe<Scalars['Int']['output']>;
  totalExecutions?: Maybe<Scalars['Int']['output']>;
  workflowId: Scalars['ID']['output'];
  workflowName?: Maybe<Scalars['String']['output']>;
};

export enum TransitionModes {
  FollowAll = 'FOLLOW_ALL',
  FollowFirst = 'FOLLOW_FIRST'
}

export type Trigger = {
  __typename?: 'Trigger';
  activatedForOrgs: Array<Organization>;
  autoActivateManagedOrgs: Scalars['Boolean']['output'];
  cloneOverrides?: Maybe<Scalars['JSON']['output']>;
  clonedFrom?: Maybe<Trigger>;
  clonedFromId?: Maybe<Scalars['ID']['output']>;
  clones: Array<Maybe<Trigger>>;
  criteria?: Maybe<Scalars['JSON']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  form?: Maybe<Form>;
  formId?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  isSynchronized?: Maybe<Scalars['Boolean']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  orgId?: Maybe<Scalars['ID']['output']>;
  orgInstances?: Maybe<Array<Maybe<OrgTriggerInstance>>>;
  organization: Organization;
  packOverrides?: Maybe<Array<PackOverride>>;
  parameters?: Maybe<Scalars['JSON']['output']>;
  state?: Maybe<Scalars['JSON']['output']>;
  tags: Array<Tag>;
  triggerType?: Maybe<TriggerType>;
  triggerTypeId: Scalars['ID']['output'];
  unpackedFrom?: Maybe<Crate>;
  unpackedFromId?: Maybe<Scalars['ID']['output']>;
  vars?: Maybe<Array<Maybe<Scalars['JSON']['output']>>>;
  workflow: Workflow;
  workflowId: Scalars['ID']['output'];
};


export type TriggerOrgInstancesArgs = {
  where?: InputMaybe<OrgTriggerInstanceWhereInput>;
};


export type TriggerTriggerTypeArgs = {
  where?: InputMaybe<TriggerTypeWhereInput>;
};

export type TriggerCreateInput = {
  activatedForOrgIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  activatedForTagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  autoActivateManagedOrgs?: InputMaybe<Scalars['Boolean']['input']>;
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  criteria?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  formId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isActivatedForOwner?: InputMaybe<Scalars['Boolean']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  packOverrides?: InputMaybe<Array<InputMaybe<PackOverrideInput>>>;
  parameters?: InputMaybe<Scalars['JSON']['input']>;
  state?: InputMaybe<Scalars['JSON']['input']>;
  triggerTypeId?: InputMaybe<Scalars['ID']['input']>;
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
  vars?: InputMaybe<Array<Scalars['JSON']['input']>>;
  workflow?: InputMaybe<WorkflowInput>;
  workflowBuilderInfo?: InputMaybe<Scalars['JSON']['input']>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type TriggerCriteriaEvent = BaseStreamEvent & {
  __typename?: 'TriggerCriteriaEvent';
  eventId: Scalars['String']['output'];
  isFinished: Scalars['Boolean']['output'];
  payload?: Maybe<Scalars['JSON']['output']>;
};

export type TriggerOfType = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type TriggerOverride = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type TriggerSearchInput = {
  clonedFromId?: InputMaybe<Id_Comparison_Exp>;
  criteria?: InputMaybe<Json_Comparison_Exp>;
  description?: InputMaybe<String_Comparison_Exp>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Id_Comparison_Exp>;
  isSynchronized?: InputMaybe<Bool_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
  orgInstances?: InputMaybe<OrgTriggerInstanceSearchInput>;
  organization?: InputMaybe<OrganizationSearchInput>;
  packOverrides?: InputMaybe<PackOverrideSearchInput>;
  parameters?: InputMaybe<Json_Comparison_Exp>;
  state?: InputMaybe<Json_Comparison_Exp>;
  triggerType?: InputMaybe<TriggerTypesSearchInput>;
  triggerTypeId?: InputMaybe<Id_Comparison_Exp>;
  unpackedFromId?: InputMaybe<Id_Comparison_Exp>;
  workflow?: InputMaybe<WorkflowSearch>;
  workflowId?: InputMaybe<Id_Comparison_Exp>;
};

export type TriggerType = {
  __typename?: 'TriggerType';
  canRunForManagedOrgs?: Maybe<Scalars['Boolean']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  isPoll?: Maybe<Scalars['Boolean']['output']>;
  isWebhook?: Maybe<Scalars['Boolean']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  outputSchema?: Maybe<Scalars['JSON']['output']>;
  pack?: Maybe<Pack>;
  parametersSchema?: Maybe<Scalars['JSON']['output']>;
  ref?: Maybe<Scalars['String']['output']>;
  sensorType?: Maybe<SensorType>;
  triggers: Array<Trigger>;
  webhookUrlTemplate?: Maybe<Scalars['String']['output']>;
};


export type TriggerTypeParametersSchemaArgs = {
  filterArg?: InputMaybe<Scalars['JSON']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type TriggerTypeTriggersArgs = {
  search?: InputMaybe<TriggerSearchInput>;
  where?: InputMaybe<TriggerWhereInput>;
};

export type TriggerTypeInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isPoll?: InputMaybe<Scalars['Boolean']['input']>;
  isWebhook?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  outputSchema?: InputMaybe<Scalars['JSON']['input']>;
  pack?: InputMaybe<PackInput>;
  packId?: InputMaybe<Scalars['ID']['input']>;
  parametersSchema?: InputMaybe<Scalars['JSON']['input']>;
  ref?: InputMaybe<Scalars['String']['input']>;
};

export type TriggerTypeWhereInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isPoll?: InputMaybe<Scalars['Boolean']['input']>;
  isWebhook?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  outputSchema?: InputMaybe<Scalars['JSON']['input']>;
  packId?: InputMaybe<Scalars['ID']['input']>;
  parametersSchema?: InputMaybe<Scalars['JSON']['input']>;
  ref?: InputMaybe<Scalars['String']['input']>;
  triggers?: InputMaybe<TriggerWhereInput>;
};

export type TriggerTypesSearchInput = {
  description?: InputMaybe<String_Comparison_Exp>;
  enabled?: InputMaybe<Bool_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  isPoll?: InputMaybe<Scalars['Boolean']['input']>;
  isWebhook?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<String_Comparison_Exp>;
  outputSchema?: InputMaybe<Json_Comparison_Exp>;
  parametersSchema?: InputMaybe<Json_Comparison_Exp>;
  ref?: InputMaybe<String_Comparison_Exp>;
  triggers?: InputMaybe<TriggerSearchInput>;
};

export type TriggerUpdateInput = {
  activatedForOrgIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  activatedForTagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  autoActivateManagedOrgs?: InputMaybe<Scalars['Boolean']['input']>;
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  criteria?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  formId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isActivatedForOwner?: InputMaybe<Scalars['Boolean']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  packOverrides?: InputMaybe<Array<InputMaybe<PackOverrideInput>>>;
  parameters?: InputMaybe<Scalars['JSON']['input']>;
  state?: InputMaybe<Scalars['JSON']['input']>;
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
  vars?: InputMaybe<Array<Scalars['JSON']['input']>>;
  workflow?: InputMaybe<WorkflowInput>;
  workflowBuilderInfo?: InputMaybe<Scalars['JSON']['input']>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type TriggerWhereInput = {
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  criteria?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  formId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  orgInstances?: InputMaybe<OrgTriggerInstanceWhereInput>;
  parameters?: InputMaybe<Scalars['JSON']['input']>;
  state?: InputMaybe<Scalars['JSON']['input']>;
  triggerType?: InputMaybe<TriggerTypeInput>;
  triggerTypeId?: InputMaybe<Scalars['ID']['input']>;
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type UnpackCrateInput = {
  crateId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  tokenArguments?: InputMaybe<Array<CrateUnpackingArgumentInput>>;
  triggers?: InputMaybe<Array<CrateTriggerUnpackingInput>>;
  workflow: WorkflowInput;
};

export type UnpackCrateStreamEvent = CloningImportPhaseStreamFailureResponse | CloningImportPhaseStreamMessage | ExportDownloadPhaseStreamFailureResponse | ExportDownloadPhaseStreamMessage | UnpackCrateStreamSuccessResponse;

export type UnpackCrateStreamSuccessResponse = BaseCloneObjectSuccessResponse & BaseCloningResponse & BaseStreamEvent & {
  __typename?: 'UnpackCrateStreamSuccessResponse';
  didSucceed: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isFinished: Scalars['Boolean']['output'];
  orgId: Scalars['ID']['output'];
  type: CloneableObjectType;
};

export type UpdateApiClientInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateComponentInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  isChild?: InputMaybe<Scalars['Boolean']['input']>;
  isSynced?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  nodeTree?: InputMaybe<Scalars['JSON']['input']>;
  orgId: Scalars['ID']['input'];
  workflows?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};

export type UpdateFeaturePreviewSettingInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  isStaffOnly?: InputMaybe<Scalars['Boolean']['input']>;
  label?: InputMaybe<Scalars['String']['input']>;
};

export type UpsertOrgFormFieldInstancesInput = {
  formFieldInstances: Array<FormFieldInstanceInput>;
  orgId: Scalars['ID']['input'];
};

export type User = {
  __typename?: 'User';
  createdAt?: Maybe<Scalars['String']['output']>;
  favoriteActions: Array<UserFavoriteAction>;
  id?: Maybe<Scalars['ID']['output']>;
  isApiUser?: Maybe<Scalars['Boolean']['output']>;
  isSuperuser?: Maybe<Scalars['Boolean']['output']>;
  isTestUser?: Maybe<Scalars['Boolean']['output']>;
  isTokenUser?: Maybe<Scalars['Boolean']['output']>;
  managedOrgs: Array<Organization>;
  orgId?: Maybe<Scalars['ID']['output']>;
  organization?: Maybe<Organization>;
  parentUserId?: Maybe<Scalars['ID']['output']>;
  parentUsername?: Maybe<Scalars['String']['output']>;
  preferences: UserPreferences;
  roleIds: Array<Scalars['String']['output']>;
  roles?: Maybe<Array<Maybe<Scalars['JSON']['output']>>>;
  sub?: Maybe<Scalars['String']['output']>;
  tokenApiClient?: Maybe<ApiClient>;
  username?: Maybe<Scalars['String']['output']>;
};

export type UserDelegatedAccess = {
  __typename?: 'UserDelegatedAccess';
  expiresAt?: Maybe<Scalars['String']['output']>;
  grantedAt: Scalars['String']['output'];
  grantedBy?: Maybe<User>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  organization: Organization;
  reason?: Maybe<Scalars['String']['output']>;
  revokedAt?: Maybe<Scalars['String']['output']>;
  user: User;
};

export type UserFavoriteAction = {
  __typename?: 'UserFavoriteAction';
  action: Action;
  actionId: Scalars['ID']['output'];
  index: Scalars['Int']['output'];
  user: User;
  userId: Scalars['ID']['output'];
};

export type UserFavoriteActionInput = {
  actionId: Scalars['ID']['input'];
  index: Scalars['Int']['input'];
};

export type UserInvite = {
  __typename?: 'UserInvite';
  acceptedAt?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  createdById?: Maybe<Scalars['ID']['output']>;
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isAccepted?: Maybe<Scalars['Boolean']['output']>;
  orgId: Scalars['ID']['output'];
  organization: Organization;
  roleIds?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  roles?: Maybe<Array<Maybe<Scalars['JSON']['output']>>>;
  sendEmail?: Maybe<Scalars['Boolean']['output']>;
};

export type UserInviteCreateInput = {
  email: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  roleIds: Array<Scalars['String']['input']>;
  sendEmail?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UserInviteSearchInput = {
  email?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
  organization?: InputMaybe<OrganizationSearchInput>;
  sendEmail?: InputMaybe<Bool_Comparison_Exp>;
};

export type UserInviteWhereInput = {
  acceptedAt?: InputMaybe<Scalars['String']['input']>;
  email?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isAccepted?: InputMaybe<Scalars['Boolean']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  organization?: InputMaybe<OrganizationWhereInput>;
  sendEmail?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UserPreferences = {
  __typename?: 'UserPreferences';
  dateFormat: Scalars['String']['output'];
  datetimeFormat: Scalars['String']['output'];
  isDarkModePreferred?: Maybe<Scalars['Boolean']['output']>;
};

export type UserPreferencesInput = {
  dateFormat?: InputMaybe<Scalars['String']['input']>;
  datetimeFormat?: InputMaybe<Scalars['String']['input']>;
  isDarkModePreferred?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UserRolesInput = {
  id: Scalars['ID']['input'];
  roleIds: Array<Scalars['String']['input']>;
};

export type UserSearchInput = {
  createdAt?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  isApiUser?: InputMaybe<Bool_Comparison_Exp>;
  isSuperuser?: InputMaybe<Bool_Comparison_Exp>;
  isTestUser?: InputMaybe<Bool_Comparison_Exp>;
  managedOrgs?: InputMaybe<OrganizationSearchInput>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
  organization?: InputMaybe<OrganizationSearchInput>;
  roleIds?: InputMaybe<String_Comparison_Exp>;
  sub?: InputMaybe<String_Comparison_Exp>;
  username?: InputMaybe<String_Comparison_Exp>;
};

export type UserWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  isApiUser?: InputMaybe<Scalars['Boolean']['input']>;
  isSuperuser?: InputMaybe<Scalars['Boolean']['input']>;
  isTestUser?: InputMaybe<Scalars['Boolean']['input']>;
  managedOrgs?: InputMaybe<OrganizationWhereInput>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  organization?: InputMaybe<OrganizationWhereInput>;
  roleIds?: InputMaybe<Array<Scalars['String']['input']>>;
  sub?: InputMaybe<Scalars['String']['input']>;
  username?: InputMaybe<Scalars['String']['input']>;
};

export enum VoteReason {
  Correct = 'CORRECT',
  Harmful = 'HARMFUL',
  Helpful = 'HELPFUL',
  Incorrect = 'INCORRECT',
  Irrelevant = 'IRRELEVANT',
  NotUnderstood = 'NOT_UNDERSTOOD',
  Other = 'OTHER'
}

export enum VoteType {
  Down = 'DOWN',
  Up = 'UP'
}

export type Warrant = {
  __typename?: 'Warrant';
  authorized: Scalars['Boolean']['output'];
  objectId?: Maybe<Scalars['String']['output']>;
  objectType?: Maybe<Scalars['String']['output']>;
  relation?: Maybe<Scalars['String']['output']>;
  subjectId?: Maybe<Scalars['String']['output']>;
  subjectType?: Maybe<Scalars['String']['output']>;
};

export type Workflow = {
  __typename?: 'Workflow';
  action?: Maybe<Action>;
  autoInstallingForManagedOrgs: Array<Organization>;
  cloneOverrides?: Maybe<Scalars['JSON']['output']>;
  clonedFrom?: Maybe<Workflow>;
  clonedFromId?: Maybe<Scalars['ID']['output']>;
  clones: Array<Maybe<Workflow>>;
  completionListeners: Array<Trigger>;
  crates?: Maybe<Array<Crate>>;
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<User>;
  createdById?: Maybe<Scalars['ID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  humanSecondsSaved: Scalars['Int']['output'];
  id?: Maybe<Scalars['ID']['output']>;
  input: Array<Scalars['String']['output']>;
  inputSchema?: Maybe<Scalars['JSON']['output']>;
  isSynchronized?: Maybe<Scalars['Boolean']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  notes?: Maybe<Array<WorkflowNote>>;
  orgId: Scalars['ID']['output'];
  organization: Organization;
  output: Array<Maybe<Scalars['JSON']['output']>>;
  outputSchema?: Maybe<Scalars['JSON']['output']>;
  packsUsed: Array<Pack>;
  parentWorkflows?: Maybe<Array<Maybe<WorkflowTask>>>;
  permission?: Maybe<Permission>;
  schemaVersion?: Maybe<Scalars['String']['output']>;
  tags: Array<Tag>;
  taskActions: Array<Action>;
  tasks: Array<WorkflowTask>;
  tasksObject?: Maybe<Scalars['JSON']['output']>;
  timeout?: Maybe<Scalars['Int']['output']>;
  tokens?: Maybe<Array<Scalars['JSON']['output']>>;
  triggers?: Maybe<Array<Maybe<Trigger>>>;
  type: WorkflowType;
  unpackedFrom?: Maybe<Crate>;
  unpackedFromId?: Maybe<Scalars['ID']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  updatedBy?: Maybe<User>;
  updatedById?: Maybe<Scalars['ID']['output']>;
  varsSchema?: Maybe<Scalars['JSON']['output']>;
  version?: Maybe<Scalars['String']['output']>;
  visibleForOrganizations: Array<Organization>;
};


export type WorkflowTasksArgs = {
  search?: InputMaybe<WorkflowTaskSearchInput>;
  where?: InputMaybe<WorkflowTaskWhereInput>;
};


export type WorkflowTriggersArgs = {
  includeCompletionListeners?: InputMaybe<Scalars['Boolean']['input']>;
  search?: InputMaybe<TriggerSearchInput>;
  where?: InputMaybe<TriggerWhereInput>;
};


export type WorkflowVisibleForOrganizationsArgs = {
  where?: InputMaybe<OrganizationInput>;
};

export enum WorkflowEventType {
  ActionEditing = 'ACTION_EDITING',
  ActionEditingDone = 'ACTION_EDITING_DONE',
  Autosave = 'AUTOSAVE',
  MouseMove = 'MOUSE_MOVE'
}

export type WorkflowExecution = {
  __typename?: 'WorkflowExecution';
  childExecutions: Array<WorkflowExecution>;
  completionHandledExecution?: Maybe<WorkflowExecution>;
  completionHandlerExecutions: Array<WorkflowExecution>;
  conductor?: Maybe<WorkflowExecutionConductor>;
  createdAt?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  numAwaitingResponseTasks?: Maybe<Scalars['Int']['output']>;
  numSuccessfulTasks?: Maybe<Scalars['Int']['output']>;
  orgId: Scalars['ID']['output'];
  organization: Organization;
  originatingExecutionId?: Maybe<Scalars['ID']['output']>;
  parentExecution?: Maybe<WorkflowExecution>;
  parentExecutionId?: Maybe<Scalars['ID']['output']>;
  parentTaskExecutionId?: Maybe<Scalars['ID']['output']>;
  pendingTasks?: Maybe<Array<Maybe<PendingTask>>>;
  processedCompletionAt?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  subExecutions: Array<WorkflowExecution>;
  taskLogs: Array<TaskLog>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  workflow: Workflow;
};


export type WorkflowExecutionPendingTasksArgs = {
  where?: InputMaybe<PendingTaskWhereInput>;
};


export type WorkflowExecutionTaskLogsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  search?: InputMaybe<TaskLogSearchInput>;
  where?: InputMaybe<TaskLogInput>;
};

export type WorkflowExecutionConductor = {
  __typename?: 'WorkflowExecutionConductor';
  errors?: Maybe<Array<Maybe<Scalars['JSON']['output']>>>;
  graph?: Maybe<Scalars['JSON']['output']>;
  input?: Maybe<Scalars['JSON']['output']>;
  output?: Maybe<Scalars['JSON']['output']>;
  spec?: Maybe<Scalars['JSON']['output']>;
  state?: Maybe<WorkflowExecutionConductorState>;
};

export type WorkflowExecutionConductorState = {
  __typename?: 'WorkflowExecutionConductorState';
  contexts?: Maybe<Scalars['JSON']['output']>;
  routes?: Maybe<Scalars['JSON']['output']>;
  sequence?: Maybe<Scalars['JSON']['output']>;
  staged?: Maybe<Scalars['JSON']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  tasks?: Maybe<Scalars['JSON']['output']>;
};

export type WorkflowExecutionSearchInput = {
  createdAt?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  numAwaitingResponseTasks?: InputMaybe<Int_Comparison_Exp>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
  organization?: InputMaybe<OrganizationSearchInput>;
  originatingExecutionId?: InputMaybe<Id_Comparison_Exp>;
  processedCompletionAt?: InputMaybe<String_Comparison_Exp>;
  status?: InputMaybe<String_Comparison_Exp>;
  workflow?: InputMaybe<WorkflowSearch>;
};

export type WorkflowExecutionStats = {
  __typename?: 'WorkflowExecutionStats';
  delayed: Scalars['Int']['output'];
  failed: Scalars['Int']['output'];
  humanSecondsSaved: Scalars['Int']['output'];
  paused: Scalars['Int']['output'];
  pending: Scalars['Int']['output'];
  running: Scalars['Int']['output'];
  succeeded: Scalars['Int']['output'];
};

export type WorkflowExecutionWhereInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  numAwaitingResponseTasks?: InputMaybe<Scalars['Int']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  originatingExecutionId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  workflow?: InputMaybe<WorkflowWhereInput>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type WorkflowInput = {
  actionId?: InputMaybe<Scalars['ID']['input']>;
  cloneOverrides?: InputMaybe<Scalars['JSON']['input']>;
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  humanSecondsSaved?: InputMaybe<Scalars['Int']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  input?: InputMaybe<Array<Scalars['String']['input']>>;
  inputSchema?: InputMaybe<Scalars['JSON']['input']>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Array<WorkflowNoteInput>>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  output?: InputMaybe<Array<Scalars['JSON']['input']>>;
  outputSchema?: InputMaybe<Scalars['JSON']['input']>;
  parameters?: InputMaybe<Scalars['JSON']['input']>;
  schemaVersion?: InputMaybe<Scalars['String']['input']>;
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  tasks?: InputMaybe<Array<WorkflowTaskInput>>;
  timeout?: InputMaybe<Scalars['Int']['input']>;
  tokens?: InputMaybe<Array<Scalars['JSON']['input']>>;
  transitions?: InputMaybe<Array<WorkflowTransitionInput>>;
  triggers?: InputMaybe<Array<TriggerCreateInput>>;
  type?: InputMaybe<WorkflowType>;
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
  varsSchema?: InputMaybe<Scalars['JSON']['input']>;
  version?: InputMaybe<Scalars['String']['input']>;
};

export type WorkflowNote = {
  __typename?: 'WorkflowNote';
  clonedFrom?: Maybe<WorkflowNote>;
  clonedFromId?: Maybe<Scalars['ID']['output']>;
  content?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  index: Scalars['Int']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
  workflow?: Maybe<Workflow>;
  workflowId?: Maybe<Scalars['ID']['output']>;
};

export type WorkflowNoteInput = {
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  content?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  index?: InputMaybe<Scalars['Int']['input']>;
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type WorkflowNoteSearchInput = {
  clonedFromId?: InputMaybe<Id_Comparison_Exp>;
  content?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  index?: InputMaybe<Int_Comparison_Exp>;
  metadata?: InputMaybe<Json_Comparison_Exp>;
  title?: InputMaybe<String_Comparison_Exp>;
  workflowId?: InputMaybe<Id_Comparison_Exp>;
};

export type WorkflowNoteWhereInput = {
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  content?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  index?: InputMaybe<Scalars['Int']['input']>;
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type WorkflowOptionsResponse = {
  __typename?: 'WorkflowOptionsResponse';
  cachedOptions?: Maybe<Array<Maybe<Scalars['JSON']['output']>>>;
  executionId?: Maybe<Scalars['ID']['output']>;
};

export type WorkflowPatch = {
  __typename?: 'WorkflowPatch';
  comment: Scalars['String']['output'];
  commentDescription?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  foreignId?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  patch: Scalars['JSON']['output'];
  patchType: PatchType;
  updatedAt: Scalars['String']['output'];
  user?: Maybe<User>;
  workflowId: Scalars['ID']['output'];
};

export enum WorkflowPatchOrderByInput {
  CommentAsc = 'comment_ASC',
  CommentDesc = 'comment_DESC',
  CreatedAtAsc = 'createdAt_ASC',
  CreatedAtDesc = 'createdAt_DESC',
  ForeignIdAsc = 'foreignId_ASC',
  ForeignIdDesc = 'foreignId_DESC',
  IdAsc = 'id_ASC',
  IdDesc = 'id_DESC',
  PatchTypeAsc = 'patchType_ASC',
  PatchTypeDesc = 'patchType_DESC',
  UpdatedAtAsc = 'updatedAt_ASC',
  UpdatedAtDesc = 'updatedAt_DESC',
  WorkflowIdAsc = 'workflowId_ASC',
  WorkflowIdDesc = 'workflowId_DESC'
}

export type WorkflowPatchWhereInput = {
  comment?: InputMaybe<Scalars['String']['input']>;
  createdAt?: InputMaybe<Scalars['String']['input']>;
  foreignId?: InputMaybe<Scalars['ID']['input']>;
  patchType?: InputMaybe<PatchType>;
  updatedAt?: InputMaybe<Scalars['String']['input']>;
  user?: InputMaybe<UserWhereInput>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type WorkflowSearch = {
  clonedFromId?: InputMaybe<Id_Comparison_Exp>;
  createdAt?: InputMaybe<String_Comparison_Exp>;
  description?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  input?: InputMaybe<String_Comparison_Exp>;
  isSynchronized?: InputMaybe<Bool_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  orgId?: InputMaybe<Id_Comparison_Exp>;
  org_id?: InputMaybe<Id_Comparison_Exp>;
  organization?: InputMaybe<OrganizationSearchInput>;
  output?: InputMaybe<String_Comparison_Exp>;
  schemaVersion?: InputMaybe<String_Comparison_Exp>;
  tags?: InputMaybe<TagSearchInput>;
  tasks?: InputMaybe<Id_Comparison_Exp>;
  timeout?: InputMaybe<Int_Comparison_Exp>;
  tokens?: InputMaybe<Json_Comparison_Exp>;
  updatedAt?: InputMaybe<String_Comparison_Exp>;
  updatedBy?: InputMaybe<UserSearchInput>;
  version?: InputMaybe<String_Comparison_Exp>;
  visibleForOrganizations?: InputMaybe<Id_Comparison_Exp>;
};

export type WorkflowStatsByOrg = {
  __typename?: 'WorkflowStatsByOrg';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  numSucceededTasks: Scalars['Int']['output'];
  orgId: Scalars['ID']['output'];
  totalExecutions: Scalars['Int']['output'];
  totalHumanSecondsSaved: Scalars['Int']['output'];
  totalTasks: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
};

export type WorkflowTask = {
  __typename?: 'WorkflowTask';
  action?: Maybe<Action>;
  actionId?: Maybe<Scalars['ID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  humanSecondsSaved?: Maybe<Scalars['Int']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  input?: Maybe<Scalars['JSON']['output']>;
  isMocked?: Maybe<Scalars['Boolean']['output']>;
  join?: Maybe<Scalars['Int']['output']>;
  metadata?: Maybe<Scalars['JSON']['output']>;
  mockInput?: Maybe<Scalars['JSON']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  next: Array<WorkflowTransition>;
  packOverrides?: Maybe<Array<PackOverride>>;
  publishResultAs?: Maybe<Scalars['String']['output']>;
  retry?: Maybe<WorkflowTaskRetry>;
  runAsOrgId?: Maybe<Scalars['String']['output']>;
  securitySchema?: Maybe<Scalars['JSON']['output']>;
  timeout?: Maybe<Scalars['Int']['output']>;
  transitionMode?: Maybe<TransitionModes>;
  with?: Maybe<WorkflowTaskWithItems>;
  workflow?: Maybe<Workflow>;
  workflowId?: Maybe<Scalars['ID']['output']>;
};

export type WorkflowTaskInput = {
  action?: InputMaybe<ActionInput>;
  actionId?: InputMaybe<Scalars['ID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  humanSecondsSaved?: InputMaybe<Scalars['Int']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  input?: InputMaybe<Scalars['JSON']['input']>;
  isMocked?: InputMaybe<Scalars['Boolean']['input']>;
  join?: InputMaybe<Scalars['Int']['input']>;
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  mockInput?: InputMaybe<Scalars['JSON']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  next?: InputMaybe<Array<WorkflowTransitionInput>>;
  packOverrides?: InputMaybe<Array<PackOverrideInput>>;
  publishResultAs?: InputMaybe<Scalars['String']['input']>;
  retry?: InputMaybe<WorkflowTaskRetryInput>;
  runAsOrgId?: InputMaybe<Scalars['String']['input']>;
  securitySchema?: InputMaybe<Scalars['JSON']['input']>;
  timeout?: InputMaybe<Scalars['Int']['input']>;
  transitionMode?: InputMaybe<TransitionModes>;
  with?: InputMaybe<WorkflowTaskWithItemsInput>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type WorkflowTaskRetry = {
  __typename?: 'WorkflowTaskRetry';
  count: Scalars['String']['output'];
  delay?: Maybe<Scalars['String']['output']>;
  when?: Maybe<Scalars['String']['output']>;
};

export type WorkflowTaskRetryInput = {
  count: Scalars['String']['input'];
  delay?: InputMaybe<Scalars['String']['input']>;
  when?: InputMaybe<Scalars['String']['input']>;
};

export type WorkflowTaskSearchInput = {
  action?: InputMaybe<ActionSearch>;
  actionId?: InputMaybe<Id_Comparison_Exp>;
  createdAt?: InputMaybe<String_Comparison_Exp>;
  description?: InputMaybe<String_Comparison_Exp>;
  humanSecondsSaved?: InputMaybe<Int_Comparison_Exp>;
  id?: InputMaybe<Id_Comparison_Exp>;
  input?: InputMaybe<Json_Comparison_Exp>;
  join?: InputMaybe<Int_Comparison_Exp>;
  metadata?: InputMaybe<Json_Comparison_Exp>;
  packOverrides?: InputMaybe<PackOverrideSearchInput>;
  timeout?: InputMaybe<Int_Comparison_Exp>;
  workflowId?: InputMaybe<Id_Comparison_Exp>;
};

export type WorkflowTaskWhereInput = {
  action?: InputMaybe<ActionInput>;
  actionId?: InputMaybe<Scalars['ID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  humanSecondsSaved?: InputMaybe<Scalars['Int']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  input?: InputMaybe<Scalars['JSON']['input']>;
  isMocked?: InputMaybe<Scalars['Boolean']['input']>;
  join?: InputMaybe<Scalars['Int']['input']>;
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  mockInput?: InputMaybe<Scalars['JSON']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  next?: InputMaybe<Array<WorkflowTransitionInput>>;
  retry?: InputMaybe<WorkflowTaskRetryInput>;
  runAsOrgId?: InputMaybe<Scalars['String']['input']>;
  timeout?: InputMaybe<Scalars['Int']['input']>;
  with?: InputMaybe<WorkflowTaskWithItemsInput>;
  workflow?: InputMaybe<WorkflowWhereInput>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};

export type WorkflowTaskWithItems = {
  __typename?: 'WorkflowTaskWithItems';
  concurrency?: Maybe<Scalars['String']['output']>;
  items?: Maybe<Scalars['String']['output']>;
};

export type WorkflowTaskWithItemsInput = {
  concurrency?: InputMaybe<Scalars['String']['input']>;
  items?: InputMaybe<Scalars['String']['input']>;
};

export type WorkflowTransition = {
  __typename?: 'WorkflowTransition';
  do: Array<Scalars['String']['output']>;
  from?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  publish: Array<Scalars['JSON']['output']>;
  to?: Maybe<Scalars['String']['output']>;
  when?: Maybe<Scalars['String']['output']>;
};

export type WorkflowTransitionInput = {
  do?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  from?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  label?: InputMaybe<Scalars['String']['input']>;
  left?: InputMaybe<Scalars['Float']['input']>;
  publish?: InputMaybe<Array<InputMaybe<Scalars['JSON']['input']>>>;
  to?: InputMaybe<Scalars['String']['input']>;
  top?: InputMaybe<Scalars['Float']['input']>;
  when?: InputMaybe<Scalars['String']['input']>;
};

export enum WorkflowType {
  OptionGenerator = 'OPTION_GENERATOR',
  Standard = 'STANDARD',
  StreamOutput = 'STREAM_OUTPUT'
}

export type WorkflowWhereInput = {
  clonedFromId?: InputMaybe<Scalars['ID']['input']>;
  crates?: InputMaybe<CrateWhereInput>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  input?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  isSynchronized?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  output?: InputMaybe<Array<InputMaybe<Scalars['JSON']['input']>>>;
  schemaVersion?: InputMaybe<Scalars['String']['input']>;
  timeout?: InputMaybe<Scalars['Int']['input']>;
  type?: InputMaybe<WorkflowType>;
  unpackedFromId?: InputMaybe<Scalars['ID']['input']>;
  version?: InputMaybe<Scalars['String']['input']>;
  visibleForOrganizations?: InputMaybe<Scalars['ID']['input']>;
};

export type Bool_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['Boolean']['input']>;
  _ne?: InputMaybe<Scalars['Boolean']['input']>;
};

export type Float_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['Int']['input']>;
  _gt?: InputMaybe<Scalars['Int']['input']>;
  _gte?: InputMaybe<Scalars['Int']['input']>;
  _in?: InputMaybe<Array<Scalars['Int']['input']>>;
  _lt?: InputMaybe<Scalars['Int']['input']>;
  _lte?: InputMaybe<Scalars['Int']['input']>;
  _neq?: InputMaybe<Scalars['Int']['input']>;
  _nin?: InputMaybe<Array<Scalars['Int']['input']>>;
};

export type Id_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['ID']['input']>;
  _in?: InputMaybe<Array<Scalars['ID']['input']>>;
  _ne?: InputMaybe<Scalars['ID']['input']>;
  _nin?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type Int_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['Int']['input']>;
  _gt?: InputMaybe<Scalars['Int']['input']>;
  _gte?: InputMaybe<Scalars['Int']['input']>;
  _in?: InputMaybe<Array<Scalars['Int']['input']>>;
  _lt?: InputMaybe<Scalars['Int']['input']>;
  _lte?: InputMaybe<Scalars['Int']['input']>;
  _neq?: InputMaybe<Scalars['Int']['input']>;
  _nin?: InputMaybe<Array<Scalars['Int']['input']>>;
};

export type Json_Comparison_Exp = {
  _contains?: InputMaybe<Scalars['JSON']['input']>;
  _eq?: InputMaybe<Scalars['JSON']['input']>;
  _ne?: InputMaybe<Scalars['JSON']['input']>;
};

/** expression to compare columns of type String. All fields are combined with logical 'AND'. */
export type String_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['String']['input']>;
  _gt?: InputMaybe<Scalars['String']['input']>;
  _gte?: InputMaybe<Scalars['String']['input']>;
  _ilike?: InputMaybe<Scalars['String']['input']>;
  _in?: InputMaybe<Array<Scalars['String']['input']>>;
  _like?: InputMaybe<Scalars['String']['input']>;
  _lt?: InputMaybe<Scalars['String']['input']>;
  _lte?: InputMaybe<Scalars['String']['input']>;
  _neq?: InputMaybe<Scalars['String']['input']>;
  _nilike?: InputMaybe<Scalars['String']['input']>;
  _nin?: InputMaybe<Array<Scalars['String']['input']>>;
  _nlike?: InputMaybe<Scalars['String']['input']>;
  _substr?: InputMaybe<Scalars['String']['input']>;
};

export type TemplateFragment = { __typename?: 'Template', id: string, name: string, description?: string | null, body: string, contentType: string, context?: any | null, language: string, cloneOverrides?: any | null, clonedFromId?: string | null, isShared?: boolean | null, isSynchronized?: boolean | null, orgId: string, unpackedFromId?: string | null, createdAt: string, updatedAt: string, updatedById?: string | null, organization: { __typename?: 'Organization', id?: string | null, name: string }, tags: Array<{ __typename?: 'Tag', id?: string | null, name?: string | null, color?: string | null }>, clonedFrom?: { __typename?: 'Template', id: string, name: string } | null, updatedBy?: { __typename?: 'User', id?: string | null, username?: string | null } | null, unpackedFrom?: { __typename?: 'Crate', id: string, name: string } | null };

export type ListTemplatesMinimalQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
}>;


export type ListTemplatesMinimalQuery = { __typename?: 'Query', templates: Array<{ __typename?: 'Template', id: string, name: string, description?: string | null, body: string, contentType: string, context?: any | null, language: string, cloneOverrides?: any | null, clonedFromId?: string | null, isShared?: boolean | null, isSynchronized?: boolean | null, orgId: string, unpackedFromId?: string | null, createdAt: string, updatedAt: string, updatedById?: string | null, organization: { __typename?: 'Organization', id?: string | null, name: string }, tags: Array<{ __typename?: 'Tag', id?: string | null, name?: string | null, color?: string | null }>, clonedFrom?: { __typename?: 'Template', id: string, name: string } | null, updatedBy?: { __typename?: 'User', id?: string | null, username?: string | null } | null, unpackedFrom?: { __typename?: 'Crate', id: string, name: string } | null }> };

export type CreateTemplateMinimalMutationVariables = Exact<{
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
}>;


export type CreateTemplateMinimalMutation = { __typename?: 'Mutation', template?: { __typename?: 'Template', id: string, name: string, description?: string | null, body: string, contentType: string, context?: any | null, language: string, cloneOverrides?: any | null, clonedFromId?: string | null, isShared?: boolean | null, isSynchronized?: boolean | null, orgId: string, unpackedFromId?: string | null, createdAt: string, updatedAt: string, updatedById?: string | null, organization: { __typename?: 'Organization', id?: string | null, name: string }, tags: Array<{ __typename?: 'Tag', id?: string | null, name?: string | null, color?: string | null }>, clonedFrom?: { __typename?: 'Template', id: string, name: string } | null, updatedBy?: { __typename?: 'User', id?: string | null, username?: string | null } | null, unpackedFrom?: { __typename?: 'Crate', id: string, name: string } | null } | null };

export type UpdateTemplateMutationVariables = Exact<{
  template: TemplateUpdateInput;
}>;


export type UpdateTemplateMutation = { __typename?: 'Mutation', template?: { __typename?: 'Template', id: string, name: string, description?: string | null, body: string, contentType: string, context?: any | null, language: string, cloneOverrides?: any | null, clonedFromId?: string | null, isShared?: boolean | null, isSynchronized?: boolean | null, orgId: string, unpackedFromId?: string | null, createdAt: string, updatedAt: string, updatedById?: string | null, organization: { __typename?: 'Organization', id?: string | null, name: string }, tags: Array<{ __typename?: 'Tag', id?: string | null, name?: string | null, color?: string | null }>, clonedFrom?: { __typename?: 'Template', id: string, name: string } | null, updatedBy?: { __typename?: 'User', id?: string | null, username?: string | null } | null, unpackedFrom?: { __typename?: 'Crate', id: string, name: string } | null } | null };

export type UpdateTemplateBodyMutationVariables = Exact<{
  body?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
}>;


export type UpdateTemplateBodyMutation = { __typename?: 'Mutation', template?: { __typename?: 'Template', id: string, name: string, description?: string | null, body: string, contentType: string, context?: any | null, language: string, cloneOverrides?: any | null, clonedFromId?: string | null, isShared?: boolean | null, isSynchronized?: boolean | null, orgId: string, unpackedFromId?: string | null, createdAt: string, updatedAt: string, updatedById?: string | null, organization: { __typename?: 'Organization', id?: string | null, name: string }, tags: Array<{ __typename?: 'Tag', id?: string | null, name?: string | null, color?: string | null }>, clonedFrom?: { __typename?: 'Template', id: string, name: string } | null, updatedBy?: { __typename?: 'User', id?: string | null, username?: string | null } | null, unpackedFrom?: { __typename?: 'Crate', id: string, name: string } | null } | null };

export type UpdateTemplateNameMutationVariables = Exact<{
  name?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
}>;


export type UpdateTemplateNameMutation = { __typename?: 'Mutation', template?: { __typename?: 'Template', id: string, name: string, description?: string | null, body: string, contentType: string, context?: any | null, language: string, cloneOverrides?: any | null, clonedFromId?: string | null, isShared?: boolean | null, isSynchronized?: boolean | null, orgId: string, unpackedFromId?: string | null, createdAt: string, updatedAt: string, updatedById?: string | null, organization: { __typename?: 'Organization', id?: string | null, name: string }, tags: Array<{ __typename?: 'Tag', id?: string | null, name?: string | null, color?: string | null }>, clonedFrom?: { __typename?: 'Template', id: string, name: string } | null, updatedBy?: { __typename?: 'User', id?: string | null, username?: string | null } | null, unpackedFrom?: { __typename?: 'Crate', id: string, name: string } | null } | null };

export type GetTemplateQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type GetTemplateQuery = { __typename?: 'Query', template?: { __typename?: 'Template', id: string, name: string, description?: string | null, body: string, contentType: string, context?: any | null, language: string, cloneOverrides?: any | null, clonedFromId?: string | null, isShared?: boolean | null, isSynchronized?: boolean | null, orgId: string, unpackedFromId?: string | null, createdAt: string, updatedAt: string, updatedById?: string | null, organization: { __typename?: 'Organization', id?: string | null, name: string }, tags: Array<{ __typename?: 'Tag', id?: string | null, name?: string | null, color?: string | null }>, clonedFrom?: { __typename?: 'Template', id: string, name: string } | null, updatedBy?: { __typename?: 'User', id?: string | null, username?: string | null } | null, unpackedFrom?: { __typename?: 'Crate', id: string, name: string } | null } | null };

export type DeleteTemplateMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteTemplateMutation = { __typename?: 'Mutation', deleteTemplate?: string | null };

export type UserOrganizationQueryVariables = Exact<{ [key: string]: never; }>;


export type UserOrganizationQuery = { __typename?: 'Query', userOrganization?: { __typename?: 'Organization', createdAt?: string | null, domain?: string | null, id?: string | null, managingOrgId?: string | null, name: string, orgSlug?: string | null, resultsRetentionDays?: number | null, rocSiteId?: string | null, tid?: string | null, managedOrgs: Array<{ __typename?: 'Organization', id?: string | null, name: string }> } | null };

export const TemplateFragmentDoc = gql`
    fragment template on Template {
  id
  name
  description
  body
  contentType
  context
  language
  cloneOverrides
  clonedFromId
  isShared
  isSynchronized
  orgId
  unpackedFromId
  createdAt
  updatedAt
  updatedById
  organization {
    id
    name
  }
  tags {
    id
    name
    color
  }
  clonedFrom {
    id
    name
  }
  updatedBy {
    id
    username
  }
  unpackedFrom {
    id
    name
  }
}
    `;
export const ListTemplatesMinimalDocument = gql`
    query listTemplatesMinimal($orgId: ID!) {
  templates(where: {orgId: $orgId}) {
    ...template
  }
}
    ${TemplateFragmentDoc}`;
export const CreateTemplateMinimalDocument = gql`
    mutation createTemplateMinimal($name: String!, $orgId: ID!) {
  template: createTemplate(template: {name: $name, orgId: $orgId, body: ""}) {
    ...template
  }
}
    ${TemplateFragmentDoc}`;
export const UpdateTemplateDocument = gql`
    mutation updateTemplate($template: TemplateUpdateInput!) {
  template: updateTemplate(template: $template) {
    ...template
  }
}
    ${TemplateFragmentDoc}`;
export const UpdateTemplateBodyDocument = gql`
    mutation updateTemplateBody($body: String, $id: ID!) {
  template: updateTemplate(template: {body: $body, id: $id}) {
    ...template
  }
}
    ${TemplateFragmentDoc}`;
export const UpdateTemplateNameDocument = gql`
    mutation updateTemplateName($name: String, $id: ID!) {
  template: updateTemplate(template: {name: $name, id: $id}) {
    ...template
  }
}
    ${TemplateFragmentDoc}`;
export const GetTemplateDocument = gql`
    query getTemplate($id: ID!) {
  template(where: {id: $id}) {
    ...template
  }
}
    ${TemplateFragmentDoc}`;
export const DeleteTemplateDocument = gql`
    mutation deleteTemplate($id: ID!) {
  deleteTemplate(id: $id)
}
    `;
export const UserOrganizationDocument = gql`
    query UserOrganization {
  userOrganization {
    createdAt
    domain
    id
    managingOrgId
    managedOrgs {
      id
      name
    }
    name
    orgSlug
    resultsRetentionDays
    rocSiteId
    tid
  }
}
    `;

export type SdkFunctionWrapper = <T>(action: (requestHeaders?:Record<string, string>) => Promise<T>, operationName: string, operationType?: string, variables?: any) => Promise<T>;


const defaultWrapper: SdkFunctionWrapper = (action, _operationName, _operationType, _variables) => action();

export function getSdk(client: GraphQLClient, withWrapper: SdkFunctionWrapper = defaultWrapper) {
  return {
    listTemplatesMinimal(variables: ListTemplatesMinimalQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ListTemplatesMinimalQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ListTemplatesMinimalQuery>({ document: ListTemplatesMinimalDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'listTemplatesMinimal', 'query', variables);
    },
    createTemplateMinimal(variables: CreateTemplateMinimalMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<CreateTemplateMinimalMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<CreateTemplateMinimalMutation>({ document: CreateTemplateMinimalDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'createTemplateMinimal', 'mutation', variables);
    },
    updateTemplate(variables: UpdateTemplateMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<UpdateTemplateMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<UpdateTemplateMutation>({ document: UpdateTemplateDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'updateTemplate', 'mutation', variables);
    },
    updateTemplateBody(variables: UpdateTemplateBodyMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<UpdateTemplateBodyMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<UpdateTemplateBodyMutation>({ document: UpdateTemplateBodyDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'updateTemplateBody', 'mutation', variables);
    },
    updateTemplateName(variables: UpdateTemplateNameMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<UpdateTemplateNameMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<UpdateTemplateNameMutation>({ document: UpdateTemplateNameDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'updateTemplateName', 'mutation', variables);
    },
    getTemplate(variables: GetTemplateQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<GetTemplateQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<GetTemplateQuery>({ document: GetTemplateDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'getTemplate', 'query', variables);
    },
    deleteTemplate(variables: DeleteTemplateMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<DeleteTemplateMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<DeleteTemplateMutation>({ document: DeleteTemplateDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'deleteTemplate', 'mutation', variables);
    },
    UserOrganization(variables?: UserOrganizationQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<UserOrganizationQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<UserOrganizationQuery>({ document: UserOrganizationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'UserOrganization', 'query', variables);
    }
  };
}
export type Sdk = ReturnType<typeof getSdk>;