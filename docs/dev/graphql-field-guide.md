# Rewst GraphQL Query Field Guide

> Working engineering artifact for the MCP query-tool audit. Goal: probe every
> root `Query` field against a live org once, record what actually works and
> where the schema is misleading, so agents (and the dedicated MCP tools we
> build) stop re-discovering the same trial-and-error.
>
> **Status:** ✅ Query-surface audit complete — all 113 root `Query` fields probed live (2026-06-21).
> **Scope:** queries only (no mutations/subscriptions this pass).
> **Live probe org:** Jon's Sandbox — `01940973-8a88-7109-8ba7-d64bfbb18950` (the only org we test against).
> **Source of truth for tools:** the bulk of each finding gets hardened into a
> dedicated MCP capability/spec; cross-cutting gotchas are distilled into the
> "Common gotchas" section below and into steering.

## How to read an entry

Each probed field gets a block:

```text
### fieldName
- **status:** WORKS | ERROR | EMPTY (callable, no data in sandbox) | NEEDS-ARGS (required input we couldn't satisfy)
- **minimal working call:** the smallest query + variables that returned data (or the precise args needed)
- **gotchas:** misleading args, required-looking-optional (and vice-versa), orgId placement (args vs where vs variables), silent nulls, pagination/order behaviour, search-input shape
- **return shape:** the few fields on the return type worth knowing
- **tool candidate:** yes/no + why (is a dedicated paginated/ranked tool worth building?)
```

Status legend for the catalog coverage table: `pending` → not probed yet, `done` → probed + recorded below.

---

## Common gotchas (cross-cutting — fill from findings)

_Distilled rules that apply across many fields. These feed steering + tool descriptions._

- `buddy_graphql_query` is read-only — mutations/subscriptions are rejected at the MCP boundary.
- The MCP tool injects the caller's `orgId` into variables; a conflicting `variables.orgId` is rejected. It only provides a **top-level** `$orgId` variable — fields that scope org **inside `where`** (e.g. `template`, `templates`) still need `where.orgId` written explicitly (reference `$orgId`).
- **`where` vs `search` are different filter surfaces that compose.** `where` = exact field equality (`{ orgId, id }`). `search` = comparison-operator expressions (`{ name: { _ilike: "%x%" } }`, also `_eq`, `_in`). Many list fields take both.
- **`order` is `[[String!]!]`** — a list of `[fieldName, direction]` pairs, e.g. `[["updatedAt", "desc"]]`.
- **JSON-typed args (`JSON!`) must be passed as GraphQL variables**, never inline literals — inline fails with `Expected Name, found String`.
- **Several resolvers are broken server-side** (return all-null or crash). Confirmed dead so far: `jinjaTemplate` (crashes), `jinjaFilterDocumentation` (singular — always null; use the plural `jinjaFiltersDocumentation`). Singular-by-id resolvers often crash on not-found instead of returning null (`orgInterpreterSetting`).
- **No default `limit`** on some list fields (e.g. `templates`) — omitting it returns _everything_. Always cap.
- Timestamp scalars are sometimes **millisecond-epoch strings**, not ISO (e.g. template `updatedAt`, packConfig `createdAt`/`updatedAt`).
- **⚠ Cross-org data leak:** global catalog fields (`actions`, `packs`, `actionOptions`) return records from _other_ orgs unless you filter explicitly — they are NOT org-scoped at the resolver. Prefer the `*ForOrg` variants (`actionsForOrg`, `packsForOrg`) for org-aware queries. `packs(where:{orgId})` silently returns `[]` (dead filter path — use `packsForOrg`).
- **⚠ The schema lies about pagination.** Some fields advertise `limit`/`offset` in introspection but the resolver rejects them at runtime (`packConfigs` → `Unknown argument "limit"`). Don't trust the signature; verify against the live resolver.
- **Declared-but-unused variables are a validation error.** The MCP tool injects an `$orgId` _value_, but the query document must both declare `query Q($orgId: ID!)` **and** reference `$orgId`. For global fields that don't take org, do NOT declare `$orgId` (else `Variable $orgId is never used`).
- **UUID vs string-ref is inconsistent across sibling fields.** `commonlyUsedIntegrationActions.integrationId` wants a pack **UUID** (a ref string throws `invalid input syntax for type uuid`); `packAuthUrl.packName` / `pack(where:{ref})` want a **string ref**. Check per field.
- **Some resolvers are auth-gated** (`verifyUserManagesOrg`) and throw `Not Authorized` from a normal user session (`packActionOptions`); the singular sibling may instead return `null`.
- **Singular-by-id resolvers return `null` on not-found** (no error) for most catalog types (`action`, `pack`, `packConfig`) — but a few crash instead (see Templates batch). No org-boundary enforcement on bare-id lookups, so they can cross orgs.
- **Auto-injected `$orgId` scopes auth but does NOT auto-filter results.** For most list fields (`triggers`, `forms`, `workflows`, `users`…) you must still pass `where: { orgId: $orgId }` explicitly, or you get cross-org / arbitrary rows.
- **Several list fields crash without an explicit scope.** `tags` (and `crateTags`, `tag`) throw a Sequelize `Invalid value` auth-middleware crash when called with no `where`/`search` at all — always pass `where: { orgId }`.
- **`search.organization` / `search.organizationId` nested joins are broken** on `triggers`, `forms`, `sites` (`missing FROM-clause entry` / `column ... does not exist`). Use `where: { orgId }` for org scoping on those.
- **Enum-typed args must be unquoted GraphQL enum literals**, not strings: `category: secret` (not `"secret"`), `modelName: PackConfig`. Comparison-exp inputs are Hasura-style (`_eq`, `_ilike`, `_like`, `_substr`, `_in`, `_neq`).
- **`AUTH_ERR` often means "missing required scope arg," not a permission problem.** `workflowNotes`/`workflowNote` return `AUTH_ERR` unless you pass a scoping `workflowId` (or valid note `id`).
- **Ordering arg is not uniform.** Most lists use `order: [[String!]!]` (e.g. `[["updatedAt","DESC"]]`), but `workflowPatches` uses a single-enum `orderBy: createdAt_DESC`. Date filters likewise vary: `workflowPatches.createdSince` accepts **only epoch-ms strings** (ISO throws `Invalid time value`).
- **Secret hygiene:** `orgVariable(s)` return **plaintext secrets** unless you pass `maskSecrets: true` — always set it in tools. `visibleOrgVariables` always masks and includes cascaded/inherited vars (the row's `orgId` identifies the source org).
- **Some "my/me" fields ignore the request org** and resolve against the _token's_ home org: `me`, `userOrganization`, `user`/`users` only see users _directly_ in the named org (no parent inheritance).
- **Broken / unusable resolvers found so far (avoid; use the noted replacement):**
    - `visibleWorkflows` — crashes both with and without `orgId` (SQL join bug: `missing FROM-clause entry for table "visibleForOrganizations"`). ⚠ **CONFIRMED LIVE: our shipped `buddy_list_workflows` MCP tool is 100% broken** because it wraps this. Replacement (verified): `workflows(where: { orgId }, order: [["updatedAt","DESC"]])`, mapping the name filter to `search: { name: { _ilike: "%<term>%" } }`.
    - `jinjaTemplate` — crashes for any input. `jinjaFilterDocumentation` (singular) — always all-null; use plural `jinjaFiltersDocumentation`.
    - `myAccessibleOrganizations` — server crash (`findAll` of undefined).
    - `visibleOrgVariablesCount` — returns null for a non-null `Int!` field.
    - `packActionOptions` — `Not Authorized` (`verifyUserManagesOrg`) from a normal session.
    - `conversationMessageVotes` (when filtered) & `messageVoteStats` (always) — crash `No info provided to datasource` (resolver calls `findOne` without passing `info`). `conversations` with no `where` also crashes — pass `where:{orgId}` explicitly.
    - `componentInstances(orgId: ID!)` — broken **via MCP specifically**: the resolver wraps the incoming `orgId` into `{ where: { orgId: [Object] } }` and Sequelize crashes, for every calling pattern. `componentTree` / `recentComponentVersions` crash on not-found ids (null-deref / explicit error) rather than returning null/`[]`.
    - `organizationsWithFeaturePreviewSettingEnabled` — staff/support only.
    - `workflows(hasTokens: true)` — crashes (`relation "tokens" does not exist`); other boolean flags work.
    - `packConfigs(limit:)` — `Unknown argument` despite the schema advertising it (no pagination).
- **Date args want ISO 8601, output timestamps are epoch-ms — opposite directions.** Date-argument fields (`createdSince`, `startDate`, `endDate`, `date`, `updatedAt` on the stats/exec queries) require ISO strings (`YYYY-MM-DD` or full `…T…Z`); epoch-ms is rejected (`date/time field value out of range`). But object timestamps come back as **epoch-ms strings**. Lone exception: `workflowPatches.createdSince` wants epoch-ms only (ISO throws). Verify per field.
- **`pendingTasksAggregate` requires `status`** (enum: `pending`/`expired`/`success`/`delayed`/`canceled`) even though the schema marks it optional — omitting crashes (`Named replacement ":status" has no entry`).
- **For org-scoped `taskLogs`, use `search:{ principalOrgId:{_eq} }`, not `where:{ principalOrgId }`** — the `where` path full-table-scans and times out; `search` (and a specific `workflowExecutionId` in `where`) are fast.
- **Timeout-prone aggregates (unindexed scans) — avoid or guard ranges in tools:**
    - `taskExecutionStats` — times out always (use `workflowExecutionStats` or `dailyTaskCountsByDateRange` instead).
    - `hourlyTimeSavedByDate` — times out always (its sibling `hourlyTaskCountByDate` is fine — reads a pre-agg table).
    - `timeSavedGroupByWorkflow` / `timeSavedGroupBySubOrg` with `useStatsTable: true` — time out; pass `false`.
    - `dailyTimeSavedByDateRange` — only safe for short ranges (≤~3 weeks); long ranges time out.
    - `dailyTaskCountsByDateRange` — fast (pre-agg) but returns **future-dated rows** (projected/pre-filled), so don't treat rows as live counts.

---

## Tool candidates (fill from findings)

_Fields/operations worth a dedicated MCP tool — especially where we can beat
Rewst's native behaviour by paginating ourselves and ranking locally._

### P0 — ✅ FIXED (branch `feat/mcp-graphql-query-audit`)

- **`buddy_list_workflows` was broken in production.** Now swapped from `visibleWorkflows` to `workflows(where:{orgId}, order:[["updatedAt","DESC"]])` with the name filter mapped to `search:{ name:{ _ilike:"%term%" } }`. Source: `src/capabilities/rewstReadCapabilities.ts` (`WORKFLOWS_QUERY` / `runListWorkflows`); colocated unit test `rewstReadCapabilities.test.ts` (passing in the VS Code host); changelog note added. _(Known minor limitation: `%`/`_` in search terms are not escaped — matches prior behaviour.)\_

### ✅ Built this session — 26 new read tools + 1 fix (all type-check + unit-test green)

Status: implemented, type-checked, unit-tested (full unit suite green), and live-smoke-tested over MCP against the sandbox org.

**`src/capabilities/rewstReadCapabilities.ts`** (+ `inputHelpers.ts`):

- `buddy_list_workflows` (FIX — `workflows(where:{orgId})`, name filter → `_ilike`)
- `buddy_resolve_reference` — universal name→id over `localReferenceOptions` (13 model types)
- `buddy_list_org_variables` — `orgVariables` with `maskSecrets:true`
- `buddy_find_action` — `searchInstalledPackActions`, flatten + cap client-side
- `buddy_list_workflow_executions`, `buddy_latest_workflow_execution`, `buddy_get_workflow_execution_stats`
- `buddy_list_workflow_tasks`, `buddy_list_workflow_patches`, `buddy_get_workflow_patch`
- `buddy_find_executions_by_variable` — find a workflow's executions by an input/output/context variable name (+ optional value); input/output inline via `conductor`, context via the N+1 `workflowExecutionContexts` fetch

**`triggerFormCapabilities.ts`**: `buddy_list_triggers`, `buddy_list_forms`, `buddy_list_tags`, `buddy_list_org_trigger_instances`, `buddy_get_trigger_error_status`
**`packIntegrationCapabilities.ts`**: `buddy_list_installed_packs`, `buddy_get_pack_auth_status`, `buddy_list_pack_configs`, `buddy_list_integrations`
**`orgUserCapabilities.ts`**: `buddy_search_organizations`, `buddy_list_users`, `buddy_list_roles`
**`pageTemplateCapabilities.ts`**: `buddy_search_templates`, `buddy_list_pages`, `buddy_list_sites`, `buddy_list_jinja_filters`

### Not built (deferred — lower value / informed by Haiku findings)

- Richer org search beyond `buddy_search_organizations` (`organizations(where:{managingOrgId},search)` for very large MSPs).
- Form-for-trigger (`evaluatedForm`), pre-upgrade impact (`workflowsAffectedByBreakingChanges`), workflow-completion listeners.
- Execution-context debug (`workflowExecutionContexts`), task-count/time-saved dashboards (mind the timeout roster).
- Crate browse (`crates`/`publicCrates`), App-Platform page nodes (`pageElements`/`pageNode`), RoboRewsty config (`roboRewstyConfigOptions`).

### Cross-cutting tool-design rules (bake into every query tool)

- Always pass `where:{orgId}` for org-scoped fields (auto-injected `$orgId` only scopes auth, not results); never rely on global catalog fields for org data (they leak cross-org).
- Always set an explicit `limit`; never trust schema-advertised pagination without runtime verification.
- Mask secrets; use unquoted enum literals; treat epoch-ms timestamp strings on output.

---

## Usability findings — cold Haiku pass (2026-06-21)

A Haiku (weak) model ran 9 realistic tasks against the live tools using **descriptions only** (no field guide). 6 solved cleanly, 2 partial, all completed. Tool-description/narrowing fixes it surfaced:

1. **`buddy_find_action` — filter scope unspecified.** Description doesn't say what the `filter` matches (name? ref? description?). It matches the **display name** only (case-insensitive substring) — `filter:"send email"` finds nothing though "Send Mail…" actions exist. → State the scope explicitly.
2. **`buddy_find_action` — return format ambiguous.** `"ref-or-name (id) — pack: description"` doesn't say which token is the ref vs the name, or when `ref` is null (workflow-as-action rows show the name). → Spell out the line format + that `id` is the action id, `ref` the callable reference (null ⇒ name shown).
3. **`buddy_search_organizations` — `orgId` semantics unclear.** It reads as a scope filter but is only session routing; results span **all** managed orgs filtered by name, not sub-orgs of `orgId`. → Say "orgId only selects the session; results span all managed orgs."
4. **Action `ref` vs `id` usage not documented** — model couldn't tell which to use downstream. → One line in `buddy_find_action`.
5. **`buddy_search_organizations` vs `buddy_list_orgs` overlap** — two ways to find orgs. → Cross-reference: `buddy_search_organizations` is preferred for name lookup; `buddy_list_orgs` is the full enumeration.
6. **`buddy_find_action` vs existing `buddy_action_search` overlap** — two action finders. → Cross-reference (buddy_find_action = org-scoped installed-pack actions).

Also observed: for "find a workflow by name," Haiku reached for `buddy_workflow_search` over `buddy_resolve_reference(Workflow)` — the generic resolver competes with type-specific tools (acceptable; both work). **No tool removals indicated** — all fixes are description tightenings.

## Catalog — coverage tracker (113 root Query fields)

Grouped by domain. `wave` = which explorer batch owns it; `status` updated as findings land.

### Templates & Jinja — _wave 1 · ✅ done_

`template` · `templates` · `jinjaTemplate` · `cratesForTemplate` · `jinjaFiltersDocumentation` · `jinjaFilterDocumentation` · `extractJinjaValues` · `jinjaRenderSession` · `monacoFilterCompletionItems` · `latestInterpreterVersions` · `orgInterpreterSetting` · `orgInterpreterSettings`

### Workflows (core) — _wave 1 · ✅ done_

`workflow` · `workflows` · `visibleWorkflows` · `workflowNote` · `workflowNotes` · `workflowTask` · `workflowTasks` · `workflowPatch` · `workflowPatches` · `workflowIOConfigurations` · `workflowCompletionListeners`

### Workflow executions, tasks & stats — _wave 1 · ✅ done_

`workflowExecution` · `workflowExecutions` · `latestWorkflowExecution` · `workflowExecutionContexts` · `workflowExecutionStats` · `taskLog` · `taskLogs` · `taskExecutionStats` · `dailyTaskCountsByDateRange` · `hourlyTaskCountByDate` · `pendingTasksAggregate` · `timeSavedGroupByWorkflow` · `timeSavedGroupBySubOrg` · `dailyTimeSavedByDateRange` · `hourlyTimeSavedByDate` · `workflowStatsByOrg`

### Actions & Packs — _wave 1 · ✅ done_

`action` · `actions` · `actionsForOrg` · `actionOption` · `actionOptions` · `commonlyUsedIntegrationActions` · `searchInstalledPackActions` · `workflowsAffectedByBreakingChanges` · `pack` · `packs` · `packsByTag` · `packsForOrg` · `packConfig` · `packConfigs` · `packConfigsForOrg` · `packActionOption` · `packActionOptions` · `packBundle` · `packBundles` · `packsAndBundlesByInstalledState` · `resourceTypesByPack` · `packAuthUrl` · `localReferenceOptions`

### Orgs, Users & Variables — _wave 1 · ✅ done_

`organization` · `organizations` · `managedAndSubOrganizations` · `orgSearch` · `searchManagedOrgs` · `myAccessibleOrganizations` · `userOrganization` · `isOrgManagedBy` · `orgBreadcrumb` · `softDeletedOrgs` · `organizationsWithFeaturePreviewSettingEnabled` · `me` · `user` · `users` · `checkUserManagesOrg` · `userInvite` · `userInvites` · `orgVariable` · `orgVariables` · `visibleOrgVariables` · `visibleOrgVariablesCount`

### Triggers, Sensors, Forms, Tags, Sites, Integrations — _wave 1 · ✅ done_

`trigger` · `triggers` · `triggerType` · `triggerTypes` · `triggerDbNotificationErrors` · `getTriggerErrorStatus` · `sensorType` · `sensorTypes` · `orgTriggerInstance` · `orgTriggerInstances` · `form` · `forms` · `evaluatedForm` · `packConfigsForForm` · `tag` · `tags` · `crateTags` · `site` · `sites` · `getAppPermissions` · `getSiteTheme` · `validateSiteDomain` · `integrations`

### Components & Pages — _wave 2 · ✅ done_

`component` · `components` · `componentsByRoots` · `componentTree` · `recentComponentVersions` · `componentInstance` · `componentInstances` · `componentInstancesByPage` · `componentInstancesByComponentVersion` · `page` · `pages` · `pageVars` · `pageNode` · `pageNodes` · `livePage` · `pageElements`

### Conversations & RoboRewsty — _wave 2 · ✅ done_

`conversation` · `conversations` · `conversationMessageVotes` · `messageVoteStats` · `activeConversationRequest` · `activeConversationRequests` · `roboRewstyWorkflowDraftState` · `roboRewstyConfigOption` · `roboRewstyConfigOptions` · `userRoboRewstyPreferences` · `myRoboRewstyPreferences`

### Crates — _wave 2 · ✅ done_

`crate` · `crates` · `crateUseCase` · `crateUseCases` · `crateTokenTypes` · `crateCategories` · `crateExportInfo` · `crateUnpackingArgumentSet` · `publicCrates` · `cratesForForm`

### Permissions, Roles & Audit — _wave 2 · ✅ done_

`permission` · `permissions` · `checkAuthorization` · `check` · `checkSpiceDBPermission` · `formPermissionState` · `bulkFormPermissionsAudit` · `permissionAuditLog` · `warrants` · `roles` · `roleUserCounts` · `roleOrganizationMemberships` · `roleOrganizationMembershipCounts` · `bulkOrganizationsAudit`

### Onboarding, Imports & Admin long-tail — _wave 2 · ✅ done_

`organizationImport` · `organizationImports` · `organizationOnboardingCrateRequirement` · `organizationOnboardingCrateRequirements` · `organizationOnboardingPackRequirement` · `organizationOnboardingPackRequirements` · `organizationOnboardingRequirement` · `onboardingQuestionnaireResponse` · `onboardingQuestionnaireResponses` · `reservedOrganizationName` · `reservedOrganizationNames` · `featurePreviewSetting` · `featurePreviewSettings` · `foreignObjectReference` · `foreignObjectReferences` · `orgFormFieldInstance` · `orgFormFieldInstances` · `orgFormFieldInstanceStatus` · `appPlatformReservedDomain` · `appPlatformReservedDomains`

### External integrations long-tail (CSP / PSA / misc) — _wave 2 · ✅ done_

`microsoftCSPCustomer` · `microsoftCSPCustomers` · `microsoftAllCSPCustomers` · `psaFilterOptions` · `psaOrganizations` · `listDelegatedAccess` · `getHaloLiveChatToken` · `getSkilljarLoginToken` · `getCannyToken` · `getTestUsers` · `getTestUserSession` · `debug` · `login` · `home`

---

## Findings

### Templates & Jinja — _wave 1 · done_

**Batch gotchas:** `template`/`templates` need `orgId` inside `where`. `template` without `id` returns an arbitrary first row (no stable order) — always pass `id`. `templates` has no default limit. `jinjaTemplate` and singular `jinjaFilterDocumentation` are broken. JSON args must be variables.

| field                         | status     | notes                                                                                                                                |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `template`                    | WORKS      | `where:{ orgId, id }`. Returns full body. `updatedAt` = ms-epoch string.                                                             |
| `templates`                   | WORKS      | `where` (exact) + `search:{ name:{_ilike} }` compose; `order:[["updatedAt","desc"]]`; `offset` paginates; **no default limit**.      |
| `jinjaTemplate`               | ERROR      | Crashes `Cannot read properties of null (reading 'override')` for any input — dead resolver.                                         |
| `cratesForTemplate`           | EMPTY      | `templateId` top-level (no org arg); `[]` unless template came from a crate.                                                         |
| `jinjaFiltersDocumentation`   | WORKS      | No args/global. ~100+ filters, large → page with `buddy_result_read`. param names Title-Cased.                                       |
| `jinjaFilterDocumentation`    | ERROR      | Singular always returns all-null for any `filterName` — broken; use the plural + filter client-side.                                 |
| `extractJinjaValues`          | EMPTY      | `fields: JSON!` must be a variable; `orgId` top-level (auto-injected). Returns null in sandbox — likely needs live workflow context. |
| `jinjaRenderSession`          | NEEDS-ARGS | `id` is a conversation/render-session UUID from a prior render; non-existent id crashes.                                             |
| `monacoFilterCompletionItems` | WORKS      | No args/global. ~100+ items, large. `kind` always 1; `label.detail` holds signature. Powers IDE autocomplete.                        |
| `latestInterpreterVersions`   | WORKS      | `language` optional (omit = all). Returns list.                                                                                      |
| `orgInterpreterSetting`       | EMPTY      | **Must** pass both `orgId` AND `language` — `language`-less call crashes; by-`id` crashes on not-found.                              |
| `orgInterpreterSettings`      | EMPTY      | `orgId: ID!` top-level. Safe plural — `[]` not crash.                                                                                |

**Tool candidates:** enhance existing `buddy_list_templates` with `search`+`order`+pagination (currently it just enumerates); a Jinja-filter-docs search wrapper (large payload → searchable, return signature-only); `cratesForTemplate` clean single-arg lookup.

### Workflows (core) — _wave 1 · done_

**Batch gotchas:** `workflows(where:{orgId})` is the workhorse list (where+search compose, all boolean flags work except `hasTokens`). `visibleWorkflows` is BROKEN — do not use. `order` is `[[String!]!]` except `workflowPatches` (`orderBy: createdAt_DESC` enum). Timestamps are epoch-ms strings.

**Variable fields (input / output / context) — filter CLIENT-SIDE only.** A `Workflow` exposes all three variable kinds inline in the bulk `workflows(...)` list query (no per-workflow round-trip): `input: [String!]!` (declared input var names), `output: [JSON]!` (array of single-key `{varName: "<jinja>"}` objects — names are the keys), and `varsSchema: JSON` (declares the workflow's **variables** — inputs whose values are set statically in each trigger's settings via `Trigger.vars`, constant per trigger fire, as opposed to run/call inputs the caller supplies per execution; keyed by name). **No server-side filter works for any of them:** `where.input` is exact full-array equality only; `search:{input|output:{_ilike}}` crashes at Postgres (`operator does not exist: jsonb ~~* unknown` — the schema mistypes these jsonb columns as `string_comparison_exp`); `varsSchema` has no filter surface at all (`not defined by type "WorkflowSearch"`/`WorkflowWhereInput`). So variable-name filtering = bulk fetch + in-memory match. ⚠ `varsSchema` holds only the **declared** trigger variables; runtime-only `CTX.x` set by tasks (e.g. `set_context`) is not captured — scanning that needs task bodies (`tasks`/`tasksObject`). _(Reference only — no workflow-definition variable-filter tool ships; the real need was filtering **executions** by variable, see the executions section's `buddy_find_executions_by_variable`.)_

| field                         | status     | notes                                                                                                                                                  |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workflow`                    | WORKS      | `where:{id}`. Ignores org for auth (bare-id crosses orgs). Wrapped by existing `buddy_get_workflow`.                                                   |
| `workflows`                   | WORKS      | ⭐ primary list/search. `where`(exact)+`search`(`_ilike`); flags work **except `hasTokens:true` crashes**; `order:[[String!]!]`; **no default limit**. |
| `visibleWorkflows`            | ERROR      | ⚠ BROKEN both forms (SQL join). Use `workflows(where:{orgId})` instead — `buddy_list_workflows` now does (see **P0 ✅ FIXED** above).                  |
| `workflowNote`                | NEEDS-ARGS | only by valid `id`; other filters → `AUTH_ERR`.                                                                                                        |
| `workflowNotes`               | EMPTY      | `where:{workflowId}` required else `AUTH_ERR`.                                                                                                         |
| `workflowTask`                | WORKS      | task id = **dash-less hex**; `where:{id}` or `{workflowId,name}`.                                                                                      |
| `workflowTasks`               | WORKS      | `where:{workflowId}`; enumerate tasks; `next`=transition edges.                                                                                        |
| `workflowPatch`               | WORKS      | `id:ID!` top-level; `patch`=RFC-6902 JSON array; "Patch not found" error (not null).                                                                   |
| `workflowPatches`             | WORKS      | ⚠ `workflowId` runtime-required; uses `orderBy: createdAt_DESC` enum; `createdSince`=epoch-ms only.                                                    |
| `workflowIOConfigurations`    | WORKS      | `ids:[ID!]!` batch; IO contract fields (input/output/schemas).                                                                                         |
| `workflowCompletionListeners` | WORKS      | `where:{orgId\|workflowId}`; **no `limit`/`offset`/`order`** args; name null.                                                                          |

**Tool candidates:** `workflows` list/search (replace the broken `visibleWorkflows` under `buddy_list_workflows`); `workflowTasks` (task inspection); `workflowPatches`+`workflowPatch` (revision history/diff); `workflowIOConfigurations` (batch IO contracts for sub-workflow analysis); `workflowCompletionListeners` (who-listens-to-this-workflow).

### Actions & Packs — _wave 1 · done_

**Batch gotchas:** org-scope is inconsistent — `actions`/`packs`/`actionOptions` are global and LEAK cross-org; use `actionsForOrg`/`packsForOrg`. `searchInstalledPackActions` = best "find an action." `commonlyUsedIntegrationActions` needs a pack UUID; `packAuthUrl`/`pack` need a string ref. `packConfigs` lies about `limit`.

| field                                | status        | notes                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action`                             | WORKS         | `where:{id\|ref}`; null on not-found; `Action.orgId` null for global.                                                                                                                                                                        |
| `actions`                            | WORKS(global) | ⚠ leaks cross-org; don't declare unused `$orgId`; `ActionSearch._ilike`.                                                                                                                                                                     |
| `actionsForOrg`                      | WORKS         | org-aware (preferred); `orgId` arg; where+search compose.                                                                                                                                                                                    |
| `actionOption`                       | EMPTY         | null in sandbox; prefer `packConfig.actionOptions`.                                                                                                                                                                                          |
| `actionOptions`                      | WORKS         | ⚠ leaks cross-org without `where.organizationId`.                                                                                                                                                                                            |
| `commonlyUsedIntegrationActions`     | EMPTY         | `integrationId`=pack **UUID** (ref string crashes); needs usage history.                                                                                                                                                                     |
| `searchInstalledPackActions`         | WORKS         | ⭐ best "find an action"; returns `[Pack]` w/ nested matched `actions`. ⚠ nested `actions(limit:N)` is **not respected** (returns far more) and total result is large → a dedicated tool must flatten + cap client-side. No top-level limit. |
| `workflowsAffectedByBreakingChanges` | EMPTY         | `actions:[{packRef,actionRefs}]` (refs); upgrade-impact analysis.                                                                                                                                                                            |
| `pack`                               | WORKS         | `where:{ref\|id}`; null on not-found.                                                                                                                                                                                                        |
| `packs`                              | WORKS(global) | ⚠ `where:{orgId}` silently `[]` — use `packsForOrg`.                                                                                                                                                                                         |
| `packsByTag`                         | WORKS         | `tagName` string; global; no pagination.                                                                                                                                                                                                     |
| `packsForOrg`                        | WORKS         | org-aware; `includeSpec:true` for schema fields.                                                                                                                                                                                             |
| `packConfig`                         | WORKS         | `where:{orgId,packId}`; ts epoch-ms.                                                                                                                                                                                                         |
| `packConfigs`                        | WORKS         | ⚠ advertises `limit`/`offset` but resolver rejects `limit` — no pagination.                                                                                                                                                                  |
| `packConfigsForOrg`                  | WORKS         | `packIds:[ID!]!` required, non-empty.                                                                                                                                                                                                        |
| `packActionOption`                   | EMPTY         | null; singular.                                                                                                                                                                                                                              |
| `packActionOptions`                  | ERROR         | `Not Authorized` (`verifyUserManagesOrg`).                                                                                                                                                                                                   |
| `packBundle`                         | WORKS         | `where:PackBundleWhereInput!` required; nested packs.                                                                                                                                                                                        |
| `packBundles`                        | WORKS         | `search.ref` plain String (inconsistent).                                                                                                                                                                                                    |
| `packsAndBundlesByInstalledState`    | WORKS         | ⭐ installed vs marketplace; best install-state call.                                                                                                                                                                                        |
| `resourceTypesByPack`                | WORKS         | no args/global; large.                                                                                                                                                                                                                       |
| `packAuthUrl`                        | WORKS         | `packName`=string **ref**; null if already authed.                                                                                                                                                                                           |
| `localReferenceOptions`              | WORKS         | ⭐ generic dropdown options; `modelName` enum (Crate/Organization/PackConfig/Template/Workflow/Trigger/Form/Site/Page/Role/User…); name→id resolver.                                                                                         |

**Tool candidates:** `searchInstalledPackActions` (find-an-action); `localReferenceOptions` (universal name→id resolver — high value); `packsAndBundlesByInstalledState` (install state); `actionsForOrg` (org action catalog); `workflowsAffectedByBreakingChanges` (pre-upgrade impact).

### Orgs, Users & Variables — _wave 1 · done_

**Batch gotchas:** `searchManagedOrgs(input:{search})` = simplest "find org by name" (server substring, case-insensitive). `organizations` needs an explicit `limit` (3315-org account!). Always `maskSecrets:true`. Enum literals unquoted. Several broken resolvers (see roster).

| field                                           | status | notes                                                                                                                |
| ----------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `organization`                                  | WORKS  | `where:{id\|orgSlug}`+search; single.                                                                                |
| `organizations`                                 | WORKS  | where(exact)+search(`_ilike`); ⚠ **no default limit**; search-alone is global.                                       |
| `managedAndSubOrganizations`                    | WORKS  | `parentOrgId!` (not auto-orgId); includes self; search only.                                                         |
| `orgSearch`                                     | WORKS  | `rootOrgId!`+`breadcrumbRootOrgId!`; ⚠ rootOrgId scoping unreliable (global tree); breadcrumbs null when in-subtree. |
| `searchManagedOrgs`                             | WORKS  | ⭐ `input:{search,limit,offset}`; substring/case-insensitive; `managingOrgId` null on results.                       |
| `myAccessibleOrganizations`                     | ERROR  | server crash (`findAll` undefined).                                                                                  |
| `userOrganization`                              | WORKS  | token's **home** org (ignores request orgId).                                                                        |
| `isOrgManagedBy`                                | WORKS  | `orgId,parentOrgId`; transitive; Boolean.                                                                            |
| `orgBreadcrumb`                                 | WORKS  | ancestors **above** rootOrgId (inverted); empty if in-subtree.                                                       |
| `softDeletedOrgs`                               | EMPTY  | `managingOrgId!`; no limit.                                                                                          |
| `organizationsWithFeaturePreviewSettingEnabled` | ERROR  | staff-only.                                                                                                          |
| `me`                                            | WORKS  | auth user; home org may ≠ session org.                                                                               |
| `user`                                          | WORKS  | `where.orgId: ID!` required; only users _directly_ in org; null on not-found.                                        |
| `users`                                         | WORKS  | `where:{orgId}` required; `search._ilike`.                                                                           |
| `checkUserManagesOrg`                           | WORKS  | Boolean; cheap auth check.                                                                                           |
| `userInvite` / `userInvites`                    | EMPTY  | scope w/ `where.orgId`.                                                                                              |
| `orgVariable`                                   | WORKS  | `where:{orgId,name}`; ⚠ plaintext secrets unless `maskSecrets:true`; category enum unquoted.                         |
| `orgVariables`                                  | WORKS  | ⭐ pass `maskSecrets:true`; where+`search._ilike`.                                                                   |
| `visibleOrgVariables`                           | WORKS  | `visibleForOrgId!`; always masks; includes cascaded (row `orgId`=source).                                            |
| `visibleOrgVariablesCount`                      | ERROR  | returns null for `Int!` — broken.                                                                                    |

**Tool candidates:** `searchManagedOrgs` (find-org-by-name — the common case); `organizations` scoped search (`where:{managingOrgId}`+`search._ilike`); `orgVariables`/`visibleOrgVariables` (always mask); `me`+`checkUserManagesOrg` (auth/whoami); `users` list.

### Triggers, Sensors, Forms, Tags, Sites, Integrations — _wave 1 · done_

**Batch gotchas:** org scope via `where:{orgId}` everywhere (search.organization joins are broken). `tags` crashes with no scope. `sensorTypes`/`triggerTypes`/`integrations` are global catalogs. `nextFireTime`=epoch-ms, `state`=JSON.

| field                                        | status        | notes                                                                            |
| -------------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| `trigger`                                    | WORKS         | `where:{orgId\|id}`; first match.                                                |
| `triggers`                                   | WORKS         | `where:{orgId}` to filter; `hasTagIds`/`excludeTagIds` `[ID!]`.                  |
| `triggerType`                                | WORKS(global) | `where:{ref}`; no `search` on singular.                                          |
| `triggerTypes`                               | WORKS(global) | `search.isPoll`/`isWebhook` plain Boolean.                                       |
| `triggerDbNotificationErrors`                | EMPTY         | `triggerId` req; field `raised_at` snake_case.                                   |
| `getTriggerErrorStatus`                      | WORKS         | batch JSON map `{id:bool}`; health check.                                        |
| `sensorType` / `sensorTypes`                 | WORKS(global) | infra catalog; low agent utility.                                                |
| `orgTriggerInstance` / `orgTriggerInstances` | WORKS         | schedule/state; `nextFireTime` epoch-ms; `state` JSON (cron/tz).                 |
| `form`                                       | WORKS         | `where:{orgId,name}`; `orgContextId` for shared; `search.organizationId` broken. |
| `forms`                                      | WORKS         | `where:{orgId}` only; `hasTagIds` `[ID]`.                                        |
| `evaluatedForm`                              | WORKS         | `where:{orgId!,triggerId!}`; the form for a trigger.                             |
| `packConfigsForForm`                         | EMPTY         | `formId!,orgId!`; pass `orgId:$orgId` explicitly.                                |
| `tag`                                        | WORKS         | `where:{orgId,name}`; crashes w/o orgId.                                         |
| `tags`                                       | WORKS         | ⚠ crashes with no scope; `search.orgId` bypasses scope (global).                 |
| `crateTags`                                  | EMPTY         | crate-marketplace tags; not org-owned.                                           |
| `site`                                       | WORKS         | `where:{orgId,name}`; `search.organizationId` broken.                            |
| `sites`                                      | WORKS         | **no `limit`/`offset`/`order`** args.                                            |
| `getAppPermissions`                          | WORKS         | `orgId!`; sites the org can access (perm-filtered).                              |
| `getSiteTheme`                               | WORKS         | `domain\|id`; large MUI JSON; not agent-useful.                                  |
| `validateSiteDomain`                         | WORKS         | pre-create check; `isValid`+`message`.                                           |
| `integrations`                               | WORKS(global) | no org filter; `numInstalled` platform-wide.                                     |

**Tool candidates:** `triggers` list (workflow-invocation context); `orgTriggerInstances` (schedule view); `getTriggerErrorStatus` (batch health); `forms` + `evaluatedForm` (form for a trigger); `tags` list (resolve ids for `hasTagIds`); `getAppPermissions`/`sites`.

### Workflow executions, tasks & stats — _wave 1 · done_

**Batch gotchas:** date args = ISO 8601, output ts = epoch-ms. Several aggregates time out (see roster). `pendingTasksAggregate` needs `status`. Org-scoped `taskLogs` → use `search`, not `where`. Stats fields take `orgId` as a named arg (`$orgId`), not auto-filter.

**Execution variable fields (input / output / context) — filter CLIENT-SIDE only, scoped to ONE workflow.** Run input/output live on the nested `WorkflowExecution.conductor` object: `conductor.input` (JSON `{varName: value}`, the values a run started with) and `conductor.output` (JSON, same; `null` until the run completes) — both selectable **inline** in the bulk `workflowExecutions(...)` list, so one round-trip. The run's CTX is NOT on `WorkflowExecution`; it is the separate root field `workflowExecutionContexts(workflowExecutionId)` (JSON array of frames, each a flat `{key: value}`), so context = **one extra call per execution** (N+1, ~1–3 KB each; `conductor.state.contexts` is always `[]` — not the CTX source). **No server-side variable filter exists at all** — `WorkflowExecutionWhereInput`/`WorkflowExecutionSearchInput` expose no input/output/context/conductor field (attempts fail at GraphQL validation, stricter than the `Workflow`-def case). Filterable fields are only `id, orgId, status, originatingExecutionId, numAwaitingResponseTasks, workflowId, createdAt, processedCompletionAt`. ⚠ `workflowExecutions` with no `where` leaks other orgs' runs — always pass `where:{orgId, workflowId}`. Org-wide var search is infeasible (100+ runs/workflow), so the tool requires `workflowId`. Built as `buddy_find_executions_by_variable` (`kind: input|output|context`, optional `value`).

| field                        | status  | notes                                                                                                             |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `workflowExecution`          | WORKS   | `where`(exact)+`search`(ops); first match; ts epoch-ms.                                                           |
| `workflowExecutions`         | WORKS   | ⭐ list; `where:{orgId}` + `order:[["createdAt","DESC"]]`; `search.status._eq`.                                   |
| `latestWorkflowExecution`    | WORKS   | `workflowId!`+`orgId!` named args; optional `status`.                                                             |
| `workflowExecutionContexts`  | WORKS   | `workflowExecutionId` literal (no `$orgId` — would be unused); returns raw JSON context array. Unique debug data. |
| `workflowExecutionStats`     | WORKS   | ⭐ `orgId`+`createdSince!` (ISO); fast status counts + `humanSecondsSaved`.                                       |
| `taskLog`                    | WORKS   | `where:{workflowExecutionId}`; `executionTime`=Python duration string.                                            |
| `taskLogs`                   | WORKS   | `search:{principalOrgId:{_eq}}` (⚠ `where:{principalOrgId}` times out); `order` pairs.                            |
| `taskExecutionStats`         | ERROR   | times out always — avoid.                                                                                         |
| `dailyTaskCountsByDateRange` | WORKS   | `startDate!`/`endDate!` ISO; ⚠ returns future-dated rows (pre-agg).                                               |
| `hourlyTaskCountByDate`      | WORKS   | `date!` ISO; always 24 rows (`"HH:00"`), UTC, zero-filled.                                                        |
| `pendingTasksAggregate`      | WORKS   | ⚠ `status` required (crash without); `where.workflowExecution.orgId` for scope; `{count}`.                        |
| `timeSavedGroupByWorkflow`   | EMPTY   | `updatedAt!` ISO + `useStatsTable: false` (true times out); empty unless time-saved configured.                   |
| `timeSavedGroupBySubOrg`     | EMPTY   | MSP-tier; same caveats; `ranForOrg`=org name.                                                                     |
| `dailyTimeSavedByDateRange`  | WORKS\* | short ranges only (≤~3 wks; longer times out); `seconds` per day.                                                 |
| `hourlyTimeSavedByDate`      | ERROR   | times out always (unlike `hourlyTaskCountByDate`) — avoid.                                                        |
| `workflowStatsByOrg`         | WORKS   | ⭐ `startDate!`/`endDate!` ISO; reliable per-workflow cumulative stats; good `timeSaved*` alternative.            |

**Tool candidates:** `workflowExecutions` list + `latestWorkflowExecution` (run history/debug); `workflowExecutionStats` + `workflowStatsByOrg` (reliable dashboards); `workflowExecutionContexts` (execution-context debugging — unique data); `taskLogs` (with `search` scoping); `pendingTasksAggregate` (monitoring, status required). Avoid the timeout-prone aggregates or guard ranges tightly.

<!-- WAVE-1 FINDINGS APPENDED ABOVE THIS LINE -->

### Conversations & RoboRewsty — _wave 2 · done_

**Batch gotchas:** `conversations` needs explicit `where:{orgId}` (no-where crashes). Vote resolvers broken. `myRoboRewstyPreferences` (no-arg) beats the userId-scoped `userRoboRewstyPreferences`. RoboRewsty config is global (not org-scoped).

| field                                                      | status | notes                                                                                                                                                |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation`                                             | WORKS  | `id` arg; `messages(limit:)`, `metadata`=full workflow snapshot; `firstUserMessage` has no `id`.                                                     |
| `conversations`                                            | WORKS  | `where:{orgId}` required (no-where crashes); filter by `type`/`userId`. RoboRewsty chat history.                                                     |
| `conversationMessageVotes`                                 | ERROR  | crashes when filtered (`No info provided to datasource`); `[]` unfiltered.                                                                           |
| `messageVoteStats`                                         | ERROR  | crashes always (same bug).                                                                                                                           |
| `activeConversationRequest` / `activeConversationRequests` | WORKS  | ephemeral in-flight state; null/`[]` outside active streaming.                                                                                       |
| `roboRewstyWorkflowDraftState`                             | WORKS  | `orgId!`+`workflowId!`; null unless Rewsty mid-edit.                                                                                                 |
| `roboRewstyConfigOption`                                   | WORKS  | `where:{configName,configKey,id}`; single AI config record.                                                                                          |
| `roboRewstyConfigOptions`                                  | WORKS  | global AI config (prompts/models/functions); `configName`: jinja_autocomplete, documentation_generator, component_generator, chart_generator; large. |
| `userRoboRewstyPreferences`                                | WORKS  | `where:{userId}` = own id only (else Unauthorized); prefer `my…`.                                                                                    |
| `myRoboRewstyPreferences`                                  | WORKS  | ⭐ no-arg; current user's `alwaysAllowedTools` allowlist + `customInstructions`.                                                                     |

**Tool candidates:** `conversations`+`conversation` (read RoboRewsty chat history); `roboRewstyConfigOptions` (inspect AI config); `myRoboRewstyPreferences` (tool allowlist). Most of the rest is ephemeral/broken.

### Crates — _wave 2 · done_

**Batch gotchas:** `crate.orgId` = **authoring** org (not caller's) — don't filter by it; use `selectedOrgId` + `isUnpackedForSelectedOrg` for "installed here?". `crateCategories.selectedOrgId` is required. `crateExportInfo` = 13 MB (always page). UseCases empty in sandbox.

| field                            | status | notes                                                                                                      |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `crate`                          | WORKS  | `where:{name\|id}`+`selectedOrgId` (optional; populates `isUnpackedForSelectedOrg`); `where.orgId`=author. |
| `crates`                         | WORKS  | ⭐ browse marketplace w/ per-org install status via `selectedOrgId`.                                       |
| `crateUseCase` / `crateUseCases` | EMPTY  | no records in sandbox; callable, no error.                                                                 |
| `crateTokenTypes`                | WORKS  | no-arg static `[String!]` enum list.                                                                       |
| `crateCategories`                | WORKS  | `selectedOrgId: ID!` **required**; JSON `[{label,description}]` (6 cats).                                  |
| `crateExportInfo`                | WORKS  | `workflowId`=crate's primary wf; ⚠ **13 MB** JSON → always `buddy_result_read`.                            |
| `crateUnpackingArgumentSet`      | WORKS  | by `id` (or `orgId`); null by `crateId` alone; saved install args.                                         |
| `publicCrates`                   | WORKS  | no auth/org; trimmed `PublicCrate` type; `limit`/`offset` only.                                            |
| `cratesForForm`                  | EMPTY  | `formId` req; `[]` everywhere tested.                                                                      |

**Tool candidates:** `crates`/`crate` (marketplace browse + install-status); `publicCrates` (unauth discovery); `crateTokenTypes`/`crateCategories` (static UI enums). Skip the empty/oversized ones for agents.

### Permissions, Roles & Audit — _wave 2 · done_

**Batch gotchas:** mostly walled. Three auth tiers, all unclearable by a normal session: `requiresSuperuser` (`warrants`) > `requiresStaffOrSupportRole` (`checkSpiceDBPermission`) > SpiceDB-feature-flag (`formPermissionState`, `bulkFormPermissionsAudit`, `bulkOrganizationsAudit`). `checkAuthorization`/`check` use **WorkOS** (not SpiceDB) and reject `objectType:"organization"` (`resource-type organization not found` — correct type unknown). `permissions` leaks cross-org with sparse/null fields. The `roles` family is the usable part.

| field                              | status | notes                                                                           |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `permission`                       | WORKS  | sparse — only `id`/`relation` reliably populated.                               |
| `permissions`                      | WORKS  | ⚠ cross-org, 9 MB, mostly-null fields — too noisy.                              |
| `checkAuthorization` / `check`     | ERROR  | WorkOS; `resource-type organization not found` (correct type unknown).          |
| `checkSpiceDBPermission`           | ERROR  | staff/support only.                                                             |
| `formPermissionState`              | ERROR  | SpiceDB flag required.                                                          |
| `bulkFormPermissionsAudit`         | ERROR  | SpiceDB flag required.                                                          |
| `permissionAuditLog`               | ERROR  | crashes (null for non-null `!`); org-enrollment gated.                          |
| `warrants`                         | ERROR  | superuser only.                                                                 |
| `roles`                            | WORKS  | `where:{orgId}` (else cross-org); `userCount` null here — use `roleUserCounts`. |
| `roleUserCounts`                   | WORKS  | `roleIds!`+`orgId!`; batch user counts.                                         |
| `roleOrganizationMemberships`      | WORKS  | `roleId!`; orgs assigned a role; paginates.                                     |
| `roleOrganizationMembershipCounts` | WORKS  | `roleIds!`+`orgId!`; batch org-membership counts.                               |
| `bulkOrganizationsAudit`           | ERROR  | SpiceDB flag required.                                                          |

**Tool candidates:** `roles` + `roleUserCounts`/`roleOrganizationMemberships(Counts)` (role inspection). Everything else is auth-gated or broken — skip.

### Onboarding, Imports & Admin long-tail — _wave 2 · done_

**Batch gotchas:** onboarding tables are empty in sandbox (callable, `[]`/null). `reservedOrganizationName(s)` + `appPlatformReservedDomain(s)` are superuser-only. `onboardingQuestionnaireResponses` (plural) is `verifyUserManagesOrg`-gated though the singular returns null. Onboarding `*SearchInput` are plain-equality despite the name. `organizationImport`/`orgFormFieldInstanceStatus` throw NOT_FOUND (not null) on bad ids.

| field                                                    | status | notes                                                                                   |
| -------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `organizationImport`                                     | WORKS  | `id` arg; NOT_FOUND on bad id; import-job status.                                       |
| `organizationImports`                                    | EMPTY  | `orgId` positional; `status`/`importType` enum filters; `[]` in sandbox.                |
| `organizationOnboardingCrateRequirement(s)`              | EMPTY  | `where.orgId: ID!` required; search=plain equality.                                     |
| `organizationOnboardingPackRequirement(s)`               | EMPTY  | `where.orgId` required; pack install/config state.                                      |
| `organizationOnboardingRequirement`                      | EMPTY  | ⭐(if populated) one-call onboarding summary w/ nested pack+crate reqs + questionnaire. |
| `onboardingQuestionnaireResponse`                        | EMPTY  | no `orgId` in where; filter by `onboardingRequirementId`.                               |
| `onboardingQuestionnaireResponses`                       | ERROR  | `verifyUserManagesOrg` auth-gated.                                                      |
| `reservedOrganizationName` / `reservedOrganizationNames` | ERROR  | superuser-only (`where!` / `order!` required).                                          |
| `featurePreviewSetting`                                  | WORKS  | singular, arbitrary first; filter by `label`/`id`.                                      |
| `featurePreviewSettings`                                 | WORKS  | full list (no pagination); `order!` required; feature-flag discovery.                   |
| `foreignObjectReference(s)`                              | EMPTY  | niche cross-object tracing; no pagination on plural.                                    |
| `orgFormFieldInstance`                                   | EMPTY  | by `id` only; silent null on miss.                                                      |
| `orgFormFieldInstances`                                  | EMPTY  | `formFieldId` positional; no discovery path.                                            |
| `orgFormFieldInstanceStatus`                             | WORKS  | `formId`+`orgId` positional; Boolean; NOT_FOUND on bad form.                            |
| `appPlatformReservedDomain(s)`                           | ERROR  | superuser-only.                                                                         |

**Tool candidates:** `organizationImports`+`organizationImport` (import-job monitoring); `organizationOnboardingRequirement` (onboarding summary, if a real onboarding org); `featurePreviewSettings` (feature-flag discovery). Rest is empty/superuser-gated.

### Components & Pages — _wave 2 · done_

**Batch gotchas:** Pages family is solid; Components are empty in sandbox (need an App-Platform org). `componentInstances` is broken via MCP. `components`/`pages` take `orgId` (inline literal / nested `where.orgId`) — don't rely on a top-level `$orgId` here. `encoded` fields are compressed craft.js trees. `livePage` needs `domain`+`path` despite schema optionality.

| field                                  | status | notes                                                                                               |
| -------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `component`                            | EMPTY  | `id`; null on miss; no components in sandbox.                                                       |
| `components`                           | WORKS  | `orgId` **inline literal** (not `$orgId`); `[]` in sandbox.                                         |
| `componentsByRoots`                    | EMPTY  | `rootIds`; unclear semantics (component roots?).                                                    |
| `componentTree`                        | ERROR  | crashes on not-found (`reading 'versions'`); `encoded` craft.js tree.                               |
| `recentComponentVersions`              | ERROR  | crashes on not-found (`Component … not found`); version history.                                    |
| `componentInstance`                    | EMPTY  | by `id`; null on miss; `pageNodes` encoded string.                                                  |
| `componentInstances`                   | ERROR  | broken via MCP (orgId-injection collision).                                                         |
| `componentInstancesByPage`             | WORKS  | `pageId`; `[]` in sandbox.                                                                          |
| `componentInstancesByComponentVersion` | WORKS  | `componentVersionId`; impact analysis.                                                              |
| `page`                                 | WORKS  | `where:PageWhereInput!` (`id`/`path`/`orgId`); single page.                                         |
| `pages`                                | WORKS  | ⭐ `where:{orgId}`(inline) + `search:{name,siteId}` (plain, no `_ilike`) + `order`. Page discovery. |
| `pageVars`                             | WORKS  | `id`; JSON array of page vars; `[]` in sandbox.                                                     |
| `pageNode`                             | WORKS  | `id`; single node w/ full `props`/`type` JSON.                                                      |
| `pageNodes`                            | WORKS  | `where:PageWhereInput!`; `encoded` full node tree (bulk).                                           |
| `livePage`                             | WORKS  | `domain`+`path` (both effectively required); resolves page as a visitor.                            |
| `pageElements`                         | WORKS  | ⭐ `pageId`; flat list of all page nodes (omit `props` unless needed). Page inspection.             |

**Tool candidates:** `pages`+`page` (App-Platform page discovery/fetch); `pageElements`+`pageNode` (page UI inspection); `components`+`componentTree`/`recentComponentVersions` (component inspection, for orgs that use them). Skip the broken `componentInstances`.

### External integrations long-tail (CSP / PSA / misc) — _wave 2 · done_

**Batch gotchas:** CSP needs a caller-owned `cspPackConfigId` (`microsoftAllCSPCustomers` is feature-flag gated). PSA `psaRef` is an **undocumented string allowlist** (`connectwise`/`autotask`/`halo` all rejected as `Unsupported PSA type`) — no enum exposed. `login`/`home` are `!`-typed but crash (null) on standard domains (white-label only). `debug` is always null. `PsaAccountType`/`PsaStatus` expose `label`, not `name`.

| field                                                              | status | notes                                                                    |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| `microsoftCSPCustomer` / `microsoftCSPCustomers`                   | ERROR  | `verifyUserManagesCSPCustomer`; need caller-owned `cspPackConfigId`.     |
| `microsoftAllCSPCustomers`                                         | ERROR  | org feature-flag gated.                                                  |
| `psaFilterOptions` / `psaOrganizations`                            | ERROR  | NEEDS valid `psaRef` (undocumented allowlist) + configured PSA pack.     |
| `listDelegatedAccess`                                              | ERROR  | `Partner delegated access feature not enabled`; arg is `organizationId`. |
| `getHaloLiveChatToken` / `getSkilljarLoginToken` / `getCannyToken` | WORKS  | return short-lived auth tokens (don't surface values); no MCP utility.   |
| `getTestUsers`                                                     | EMPTY  | `where.orgId: ID!` required; `[]` in sandbox.                            |
| `getTestUserSession`                                               | EMPTY  | null; test infra.                                                        |
| `debug`                                                            | EMPTY  | always null (vestigial).                                                 |
| `login`                                                            | ERROR  | `Login!` but null-crashes on standard domains (white-label only).        |
| `home`                                                             | ERROR  | `String!` but null-crashes on standard domains.                          |

**Tool candidates:** none — all pack/flag/white-label-gated or vestigial.

<!-- WAVE-2 FINDINGS APPENDED ABOVE THIS LINE -->

_All 113 root Query fields probed. See the coverage tracker above and the prioritized tool plan near the top._
