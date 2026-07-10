# MCP Bridge Specification

## Purpose

The extension can expose its authenticated Rewst sessions to external MCP clients
as a set of tools and lightweight resources, without handing those clients a
Rewst credential. The same central capability registry can also contribute tools
to in-process chat models, but chat tool availability is not controlled by the
external bridge enablement setting. This capability covers enabling the external
bridge, the localhost token, which tools and resources are exposed, and the
working-scope rules that bound what a tool may touch.

Source: `src/mcp/` (`McpServerController.ts`, `McpActions.ts`, `mcpServer.ts`,
`instructions.ts`, `McpDefinitionProvider.ts`, `runtime.ts`, `settings.ts`, `throttle.ts`),
`src/commands/mcp/`, `src/capabilities/*Capabilities.ts`,
`src/capabilities/workflowImpactCapability.ts`,
`src/models/WorkingScopeManager.ts`, `src/ui/chat/tools/graphqlTool.ts`,
`src/ui/chat/tools/workflowTools.ts`, `src/extension.ts`.

## Requirements

### Requirement: Enable the external bridge and run a localhost server

The system SHALL expose the external MCP bridge at `/mcp` only when
`rewst-buddy.mcp.enable` is on, while allowing the underlying localhost
credential server to run independently when `rewst-buddy.server.enabled` is on.
The system SHALL reject all external MCP requests when the bridge is disabled.
This setting SHALL NOT disable in-process Buddy tools contributed to Cage-Free
Rewsty chat.

#### Scenario: Bridge disabled

- **GIVEN** `rewst-buddy.mcp.enable` is false
- **WHEN** an MCP client calls a tool
- **THEN** the request is rejected because the bridge is not enabled

#### Scenario: Cage-Free Rewsty tools are unaffected

- **GIVEN** the user selects the Cage-Free Rewsty chat model
- **AND** `rewst-buddy.mcp.enable` is false
- **WHEN** the chat model lists available in-process Buddy tools
- **THEN** registry-backed Buddy tools are still contributed to chat subject to
  their local-tool eligibility, write-tool, dangerous-GraphQL, approval,
  throttle, and scope gates
- **AND** only the external `/mcp` transport is unavailable

### Requirement: Guard with a stable, rotatable token

The system SHALL protect the localhost endpoint with a token that is stable
across reloads, compared in constant time, and rotatable on demand. The token
guards localhost only and is not a Rewst credential.

#### Scenario: Token persists across reloads

- **GIVEN** the bridge minted a token on first use
- **WHEN** the window reloads
- **THEN** the same token remains valid

#### Scenario: Rotate the token

- **GIVEN** an active token
- **WHEN** the user runs `Rotate MCP Token` and confirms
- **THEN** a new token replaces it and clients holding the old token lose access

### Requirement: Export client configuration without embedding the token

The system SHALL provide a way to copy a credential-free client config that
references the token via the `REWST_BUDDY_MCP_TOKEN` environment variable, and a
way to register the bridge natively in VS Code with live token injection.

#### Scenario: Copy MCP config

- **GIVEN** the bridge is enabled
- **WHEN** the user runs `Rewst Buddy: Copy MCP Config to Clipboard`
- **THEN** the copied JSON points at the localhost `/mcp` URL and carries the
  token only as an env-var placeholder, not the literal value

#### Scenario: Add to VS Code

- **WHEN** the user runs `Rewst Buddy: Add MCP Server to VS Code`
- **THEN** the bridge is enabled if needed, the native provider is refreshed, and
  VS Code injects the live token without an env-var step

#### Scenario: Tool-set changes force reconnect

- **GIVEN** the bridge is registered with VS Code's native MCP surface
- **WHEN** the host, port, write-tool toggle, or dangerous-GraphQL toggle changes
- **THEN** the advertised MCP definition version changes so VS Code can reconnect
  to the current tool set
- **AND** the token itself is not included in that version string

### Requirement: Expose the registry-backed tool catalog

The system SHALL expose every capability that opts into MCP from the central
capability registry on the external bridge, subject to the bridge enablement,
write-tool, dangerous GraphQL, working-scope, and per-capability access gates.
The in-process Cage-Free Rewsty chat catalog SHALL use the same `mcp: true`
capability descriptors and gates, except that it is not gated by external bridge
enablement. The catalog includes Rewst read tools, GraphQL query/schema tools,
workflow helpers, workspace template-link helpers, template
link/sync/mutation/clone tools, workflow CRUD, trigger, form, tag, org variable,
org/user, pack/integration, page/site/Jinja, working-scope, and cached-result
tools.

#### Scenario: Read catalog is listed

- **GIVEN** the bridge is enabled and write toggles are off
- **WHEN** an MCP client lists tools
- **THEN** read capabilities such as org/template/workflow listing, GraphQL
  query/schema, workspace template-link search, working-scope reads, and
  cached-result reads are listed
- **AND** raw chat-only or write-only tools are not listed

#### Scenario: Capability opts out of MCP

- **GIVEN** a capability that is chat-only
- **WHEN** an MCP client lists or calls tools
- **THEN** that capability is unavailable on the MCP surface

### Requirement: Expose bounded MCP resources

The system SHALL expose MCP resources as thin collection views backed by the same
read capabilities and gates as tools. Resource URIs SHALL use the
`rewst://{orgId}/templates`, `rewst://{orgId}/templates/{templateId}`,
`rewst://{orgId}/workflows`, and `rewst://{orgId}/workflows/{workflowId}` forms.

#### Scenario: List resources

- **GIVEN** active sessions and exposed backing list tools
- **WHEN** an MCP client lists resources
- **THEN** the bridge advertises template and workflow collection resources for
  active primary organizations

#### Scenario: Read a collection resource

- **GIVEN** a `rewst://org-1/templates` resource URI
- **WHEN** an MCP client reads that resource
- **THEN** the bridge runs the same gated capability used by
  `buddy_search_templates`
- **AND** the read is subject to the same scope and rate-limit rules as a tool
  call

### Requirement: Gate write tools behind explicit settings

The system SHALL expose external MCP tools classified with `access: 'write'`
only when `rewst-buddy.mcp.enableWriteTools` is on, and SHALL expose the raw
GraphQL mutation tool only when
`rewst-buddy.mcp.enableDangerousGraphqlMutation` is on. Read-tier tools are
available without these switches, but a read-tier tool MAY still mutate local
workspace metadata when it does not mutate Rewst data; such behavior SHALL be
explicit in the tool description and result.

#### Scenario: Write tools disabled

- **GIVEN** `enableWriteTools` is false
- **WHEN** a client lists tools
- **THEN** workflow, template, trigger, tag, form, org-variable, and other Rewst
  mutation tools are not callable
- **AND** the raw GraphQL mutation tool is also unavailable unless its separate
  dangerous-GraphQL setting is enabled

#### Scenario: Local workspace state tools

- **GIVEN** the bridge is enabled
- **WHEN** a client lists tools
- **THEN** local workspace operations such as `buddy_template_link`,
  `buddy_template_unlink`, and `buddy_template_sync_on_save` may be exposed as
  read-tier tools because they do not mutate Rewst data
- **AND** their descriptions and results state that they may change local link
  metadata, sync-on-save state, or workspace files
- **AND** they canonicalize and validate file paths or URIs, reject malformed or
  ambiguous targets, and report whether a target is workspace-relative,
  absolute, or already linked before changing local state
- **AND** `buddy_template_sync` is write-gated in every direction — including
  download and metadata-only calls — because it can both push to Rewst and
  overwrite a workspace file; see template-sync's `Expose explicit sync tools`
  requirement for the full classification

#### Scenario: Read-tier label does not hide local mutation

- **GIVEN** a read-tier tool mutates local template link state
- **WHEN** the tool is advertised to chat or external MCP clients
- **THEN** the tool remains classified by Rewst write risk rather than by local
  filesystem mutation alone
- **AND** the advertised description and runtime result disclose the local state
  mutation clearly enough for an agent to choose it intentionally
- **AND** any tool that can overwrite local file contents is either classified as
  write-tier or has an explicit local-file overwrite contract and target guard

### Requirement: Bound writes to the effective allowed organizations

For every write tool, the system SHALL verify the target organization is in the
effective allowed set — the user's pinned working scope unioned with
`rewst-buddy.mcp.alwaysAllowedOrgs` — before any authenticated write, rejecting
out-of-scope orgs with `org_out_of_scope`. An empty effective set SHALL mean no
writes are allowed.

#### Scenario: Target org is in scope

- **GIVEN** a working org is pinned and a write tool targets that org
- **WHEN** the tool runs
- **THEN** the scope check passes and the write proceeds (subject to approval)

#### Scenario: Target org is out of scope

- **GIVEN** a write tool targets an org not in the effective allowed set
- **WHEN** the tool runs
- **THEN** it is rejected with `org_out_of_scope` before any authenticated I/O

#### Scenario: No working org set

- **GIVEN** no working org is pinned and `alwaysAllowedOrgs` is empty
- **WHEN** any write tool runs
- **THEN** it is rejected because the effective allowed set is empty

### Requirement: Verify resource ownership before approval on by-id writes

For every by-id write capability in the org-variable, tag, trigger, and
workflow CRUD families, the system SHALL fetch the target resource by id
scoped to the requested `orgId` and reject with a resource-specific "not in
org" error before requesting mutation approval. This pre-flight ownership
check is a distinct, additional verification step from the generic
`org_out_of_scope` check described above: the generic check validates only
that the requested `orgId` argument itself is in the effective allowed set,
while this check re-verifies that the specific resource id supplied actually
belongs to that org — closing the gap where a caller supplies an in-scope
`orgId` together with a resource id that belongs to a different org the same
session happens to manage.

#### Scenario: Resource id belongs to a different org

- **GIVEN** a write tool's `orgId` argument is in the effective allowed set
- **AND** the supplied resource id (e.g. a variable, tag, trigger, or workflow
  id) actually belongs to a different org
- **WHEN** the tool runs
- **THEN** it is rejected with a "not in org" error naming the resource and the
  requested org
- **AND** no approval prompt is shown and no mutation runs

#### Scenario: Ownership check runs before approval

- **GIVEN** a by-id write tool targets a resource that does belong to the
  requested org
- **WHEN** the tool runs
- **THEN** the ownership read happens first, then the mutation approval
  prompt, then the mutation itself

### Requirement: Bound writes to a pinned working workflow

When a working workflow is pinned, the system SHALL require a workflow-targeting
write to name a workflow in scope, rejecting others with `workflow_out_of_scope`.

#### Scenario: Write targets an out-of-scope workflow

- **GIVEN** a specific workflow is pinned as the working scope
- **WHEN** a write tool targets a different workflow
- **THEN** it is rejected with `workflow_out_of_scope`

### Requirement: Round-trip workflow fields exactly when editing

The system SHALL apply `buddy_workflow_edit` and `buddy_workflow_autolayout`
operations by reading the full workflow and resending every task in a single
`updateWorkflow` call, because the GraphQL `tasks` array is a full replace — a
task omitted from that array is deleted, not left alone. Each resent task
SHALL explicitly carry forward its existing advanced settings
(`transitionMode`, `join`, `publishResultAs`, `timeout`, `humanSecondsSaved`,
`isMocked`, `mockInput`, `runAsOrgId`, `retry`, `with`, `metadata`,
`packOverrides`) so that an edit unrelated to those fields does not reset them.
An `add_task` or `update_task` operation SHALL set the advanced task fields
`runAsOrgId`, `packOverrides`, `isMocked`, `mockInput`, and `retry` when
supplied, validating each value's shape before saving, and SHALL reject an
operation field outside the supported set with an error naming that field
rather than silently dropping it (`transitionMode` and `join` are the
exception: they are accepted and reported as ignored, because the tool does
not set task parallelism).
Top-level workflow fields the tool does not write (such as `tags`, `notes`,
`triggers`, and the workflow's own `humanSecondsSaved`) SHALL be left
untouched by the mutation rather than reset, since `updateWorkflow` only
replaces fields actually present in its input — unlike the per-task `tasks`
array, the top level of the mutation behaves as a patch, not a full replace.
The workflow's `output` list SHALL follow the same rule: it is sent only when
a `set_output` operation provides it, so an unrelated edit never resends or
resets it. A `buddy_workflow_edit` operation that sets a task's `input`, `with`, or
`mockInput` object SHALL accept that value as a JSON-encoded string and parse
it back into an object rather than storing the literal string. A `set_transition`
operation that omits both `to` and `transitionId` SHALL resolve to the task's
sole outgoing transition when exactly one exists, and SHALL error asking the
caller to disambiguate with `to` or `transitionId` otherwise.

#### Scenario: Saving resends every existing task

- **GIVEN** a workflow has several tasks and an edit only adds one new task
- **WHEN** `buddy_workflow_edit` saves the workflow
- **THEN** the `updateWorkflow` mutation's `tasks` array includes every
  existing task plus the new one, not just the new one

#### Scenario: Editing one task preserves another task's advanced settings

- **GIVEN** a workflow has a task with a human-authored `transitionMode` of
  `FOLLOW_ALL` and a `packOverrides` entry
- **WHEN** `buddy_workflow_edit` applies an operation to a different task
- **THEN** the unrelated task's resent fields still carry its `transitionMode`,
  `join`, and `packOverrides` unchanged

#### Scenario: Untouched top-level fields are left as-is

- **GIVEN** a workflow has tags, notes, triggers, and output configured
  directly in Rewst
- **WHEN** `buddy_workflow_edit` saves an unrelated task change
- **THEN** the mutation input does not include `tags`, `notes`, `triggers`,
  `output`, or the workflow-level `humanSecondsSaved`
- **AND** those fields remain whatever they were before the edit

#### Scenario: A JSON-string task input is parsed

- **GIVEN** an `add_task` or `update_task` operation supplies a task's
  `"input"` (or `"with"`, or `"mockInput"`) as a JSON-encoded string rather
  than an object
- **WHEN** `buddy_workflow_edit` applies the operation
- **THEN** the string is parsed into an object before being sent, rather than
  stored as a literal string value

#### Scenario: An unsupported operation field fails loudly

- **GIVEN** an `add_task` or `update_task` operation carrying a misspelled or
  unsupported field
- **WHEN** `buddy_workflow_edit` applies the batch
- **THEN** the edit errors naming the unsupported field and nothing is saved

#### Scenario: set_transition disambiguates a single outgoing edge

- **GIVEN** a task has exactly one outgoing transition and the operation
  supplies neither `to` nor `transitionId`
- **WHEN** `set_transition` runs
- **THEN** it targets that sole transition
- **AND** if the task has more than one outgoing transition instead, the
  operation errors asking for `to` or `transitionId`

### Requirement: Surface non-default task fields when reading a workflow

`buddy_workflow_get` SHALL include a task's advanced fields in its graph view
only when they change behavior — `transitionMode` when not `FOLLOW_FIRST`,
`join` when not `1`, `runAsOrgId` when set, `isMocked` and `mockInput` only
when the task is mocked, and `retry` when configured — so the default view
stays concise without hiding behavior-changing state. In the summary view a
large `mockInput` payload SHALL be replaced by a size note that points at
`detail:"full"`; the full view keeps the verbatim payload.

#### Scenario: A mocked task is visible in the graph view

- **GIVEN** a workflow task with `isMocked` true and a mock payload
- **WHEN** `buddy_workflow_get` renders the summary view
- **THEN** the node shows `isMocked` and the payload (or a size note when the
  payload is large)
- **AND** a task with `isMocked` false shows neither field

### Requirement: Expose the sub-workflow output contract

The system SHALL let a caller define a workflow's outputs — the caller-visible
values another workflow reads as `RESULT.<name>` when it runs this workflow as
a sub-workflow task — via a `set_output` operation on `buddy_workflow_edit`,
and SHALL surface the existing outputs in `buddy_workflow_get` as name/value
pairs in the workflow header. `set_output` SHALL accept a `{name: "<jinja>"}`
object or a `[{name, value}]` array, store the result in the API's ordered
single-key-object list form, wrap raw boolean/number values as Jinja
expressions, treat an empty array as clearing the outputs, and error when
`outputs` is missing. The `buddy_workflow_edit` tool description SHALL
recommend sub-workflow composition — defining a reusable sequence as its own
workflow with `set_inputs`/`set_output` and calling it via `add_task` with
`subWorkflowId` — over growing a single large canvas.

#### Scenario: set_output writes the ordered output list

- **GIVEN** a `set_output` operation with
  `outputs: {success: "{{ CTX.success|d(false) }}"}`
- **WHEN** `buddy_workflow_edit` applies it
- **THEN** the mutation input's `output` is
  `[{"success": "{{ CTX.success|d(false) }}"}]`

#### Scenario: Outputs are visible to a prospective caller

- **GIVEN** a workflow whose `output` list is non-empty
- **WHEN** `buddy_workflow_get` reads it (either detail level)
- **THEN** the workflow header lists each output as a `{name, value}` pair

#### Scenario: Raw scalars become Jinja expressions

- **GIVEN** a `set_output` entry whose value is the boolean `true`
- **WHEN** `buddy_workflow_edit` applies it
- **THEN** the stored value is the Jinja expression string `{{ true }}`

### Requirement: Scope reads per configuration

The system SHALL scope reads to the effective allowed set only when
`rewst-buddy.mcp.workingOrgScope` is `strict` and a working org is pinned. Under
`writes`, reads may target any organization the session manages. Organization-
discovery tools (those not requiring an org, e.g. `buddy_list_orgs`,
`buddy_get_working_scope`) SHALL never be scoped. A tool that does not require
an org but reads organization-owned data by a globally unique id
(`buddy_execution_logs`) is not a discovery tool: under strict scope with a
working org pinned, an explicitly supplied `orgId` outside the effective
allowed set SHALL be rejected with `org_out_of_scope`.

#### Scenario: Strict read scoping

- **GIVEN** `workingOrgScope` is `strict` and a working org is pinned
- **WHEN** a read tool targets a different org
- **THEN** it is rejected as out of scope

#### Scenario: Explicit orgId on an org-optional read under strict scope

- **GIVEN** `workingOrgScope` is `strict` and a working org is pinned
- **WHEN** `buddy_execution_logs` is called with an `orgId` outside the
  effective allowed set
- **THEN** it is rejected with `org_out_of_scope` before any authenticated I/O

#### Scenario: Discovery tool is never gated

- **GIVEN** any scope configuration
- **WHEN** `buddy_list_orgs` is called
- **THEN** it runs without a scope check

#### Scenario: Sole pinned org fills a missing org id

- **GIVEN** exactly one working org is pinned
- **AND** a tool requires an organization but the caller omits `orgId`
- **WHEN** the tool runs
- **THEN** the bridge uses the pinned org as the target org

#### Scenario: Missing org cannot be inferred

- **GIVEN** no working org is pinned, or more than one working org is pinned
- **WHEN** an org-scoped tool is called without `orgId`
- **THEN** the bridge rejects the call with `org_required`

### Requirement: A model may only request a scope change

The system SHALL treat the working scope as the user's deliberate selection. A
model-driven tool SHALL only be able to _request_ a scope change
(`buddy_set_working_scope`), which takes effect after a VS Code modal; it SHALL
NOT be able to widen `alwaysAllowedOrgs`.

#### Scenario: Model requests a scope change

- **WHEN** a tool calls `buddy_set_working_scope`
- **THEN** the change is applied only after the user accepts the VS Code modal

### Requirement: Validate tool inputs defensively

Because tool inputs are not validated against the advertised `inputSchema` by
the MCP transport, each capability SHALL validate and coerce its own input
before use. Where a capability's input is defined as a schema object, that
schema SHALL be the single source for both the runtime parse and the
advertised `inputSchema` (derived from the schema), so the two can never drift
independently. A validation failure SHALL surface one clear, human-readable
message -- never a raw serialized list of every issue.

#### Scenario: Out-of-range numeric input

- **GIVEN** a tool that accepts a `limit`
- **WHEN** a caller passes a value past the maximum
- **THEN** the capability clamps it to the allowed maximum rather than honoring
  the raw value or rejecting the call

#### Scenario: Invalid enum argument is rejected with a clear message

- **GIVEN** a tool argument constrained to a fixed set of values
- **WHEN** a caller passes a value outside that set
- **THEN** the capability rejects the call with a single message naming the
  invalid value and the allowed values, not a raw validation-error dump

#### Scenario: Missing required argument is rejected with a clear message

- **GIVEN** a tool argument that is required
- **WHEN** a caller omits it or passes the wrong type
- **THEN** the capability rejects the call with a single message naming the
  missing argument

Implementation status: complete. All registry capabilities parse runtime input
through capability-local Zod schemas and derive advertised input schemas from
those schemas via `parseCapabilityInput` + `toInputSchema` (`inputHelpers.ts`).
The legacy hand-written string/integer helper exports (`requireString`,
`asString`, `asPositiveInt`, `requireStringAllowEmpty`, `ORG_ID_PROP`) have
been removed from `inputHelpers.ts` and from new capability authoring guidance.

### Requirement: Verify saved task inputs after a workflow edit

Because the Rewst API filters a task's `input` against the action's
`inputSchema` — dropping unknown keys and coercing mistyped values (a string in
an object-typed field becomes `{}`) while the save still reports success — the
system SHALL, after a `buddy_workflow_edit` save whose operations supplied a
task `input`, `with`, or an advanced task field (`runAsOrgId`,
`packOverrides`, `isMocked`, `mockInput`, `retry`), re-read the workflow and
compare each such task's stored values for those fields against what was
sent, appending a warning to the tool result naming each divergent dotted
path. The comparison SHALL be
one-directional (extra stored keys the server added are not divergences) and
SHALL tolerate textual-equal scalar coercion (`1` vs `"1"`). The tasks to
verify SHALL be tracked by task id while the operations are applied, so a
rename — in the same operation or later in the batch — cannot detach a task
from verification; a task deleted later in the batch SHALL NOT be verified.
Edits whose operations carry none of those fields SHALL NOT incur the
verification read. A failed verification read SHALL append a note advising a
manual re-read, not fail the edit.

#### Scenario: A dropped nested key is reported

- **GIVEN** an `update_task` operation whose `input` contains a key the
  action's schema does not accept
- **WHEN** the save succeeds but the server strips that key
- **THEN** the tool result contains a warning naming the task and the dotted
  path of the dropped key

#### Scenario: A rename in the same batch still verifies

- **GIVEN** operations that supply a task's `input` and rename that task —
  whether in one `update_task` or across the batch
- **WHEN** the save succeeds but the server drops a sent key
- **THEN** the tool result contains a warning naming the task and the dropped
  path

#### Scenario: Graph-only edits stay a single read

- **GIVEN** an edit whose operations only connect or reposition tasks
- **WHEN** the edit saves
- **THEN** no verification read is issued

#### Scenario: Verification read failure does not fail the edit

- **GIVEN** the save succeeded and the follow-up read errors
- **WHEN** the tool result is produced
- **THEN** it reports the applied operations and notes that the stored inputs
  could not be verified

#### Scenario: A newly created task's packOverrides mode is self-corrected

- **GIVEN** an `add_task` operation supplies `packOverrides` with a
  `configSelectionMode`/`configFallbackMode` other than the default, and the
  server stores `USE_DEFAULT` for that field on the same write that creates the
  task (a known server-side quirk: the mode is honored on an update of an
  already-existing task but not on the task's creation)
- **WHEN** the verification read detects that divergence for a task the batch
  itself created
- **THEN** the tool automatically replays one corrective `updateWorkflow` call
  resending that task's `packOverrides`, then re-verifies
- **AND** if the replay's stored values now match what was sent, the tool
  result omits the divergence warning and instead notes that the mode was
  auto-corrected
- **AND** if the replay still diverges, the original divergence warning is
  kept and no further replay is attempted

### Requirement: Rate-limit, audit, and attribute tool calls

The system SHALL rate-limit tool calls, audit every call (tool, org, outcome,
duration), and tag the approval origin so that approval prompts name the caller.

#### Scenario: Burst of calls

- **GIVEN** an MCP client issuing many calls in a short window
- **WHEN** the rate limit is exceeded
- **THEN** further calls are throttled

#### Scenario: Audit log cannot be forged

- **GIVEN** a caller supplies a tool name or input containing line separators or
  secret-looking values
- **WHEN** the bridge writes the audit record
- **THEN** the audit line contains the tool, resolved org, outcome, and duration
- **AND** the log does not include tool arguments or embedded line separators

### Requirement: Resolve execution logs across all active sessions

Because a Rewst session only sees its own org hierarchy and
`buddy_execution_logs` resolves an execution by its globally unique id without
requiring an org, the system SHALL NOT report an execution as having no task
logs based on the first active session alone: when the primary session returns
zero rows, it SHALL query each other active session (skipping ones that error)
and use the first non-empty result, noting that the logs came from another
session. The tool SHALL accept an optional `orgId` that routes the primary
lookup to the session managing that org, falling back to the default session
when no session manages it. Before reading task logs for a supplied `orgId`, it
SHALL resolve the execution by id and accept the `orgId` when it matches the
execution owner org, the execution workflow's org, or the execution owner's
managing org; this allows Rewst result URLs anchored on a managing org to
diagnose child-org executions without weakening the ownership check. When no
session has rows, the result SHALL say that none of the active sessions can see
the execution rather than implying the execution has no logs. Under strict
scope with a working org pinned (see `Scope reads per configuration`), the
primary lookup and the sweep SHALL be confined to sessions managing an org in
the effective allowed set.

#### Scenario: Execution owned by another signed-in account

- **GIVEN** two active sessions and an execution in the second session's org
  hierarchy
- **WHEN** `buddy_execution_logs` runs without an `orgId`
- **THEN** the first session's empty result triggers a sweep and the second
  session's task logs are returned, noting the alternate source

#### Scenario: No session can see the execution

- **GIVEN** an execution id no active session has access to
- **WHEN** `buddy_execution_logs` runs
- **THEN** the result states that none of the active sessions can see task
  logs for it

#### Scenario: Result URL names the managing org

- **GIVEN** an execution owned by a child org whose workflow or managing org is
  the org named in the result URL
- **WHEN** `buddy_execution_logs` runs with that URL org as `orgId`
- **THEN** it resolves the execution owner from the execution id and returns
  the child-org task logs
- **AND** it does not require the supplied `orgId` to equal the execution row's
  `orgId`

#### Scenario: Strict scope confines the sweep

- **GIVEN** `workingOrgScope` is `strict`, a working org is pinned, and the
  execution is visible only to a session managing no in-scope org
- **WHEN** `buddy_execution_logs` runs without an `orgId`
- **THEN** the out-of-scope session is never queried and its rows do not
  appear in the result

### Requirement: Surface sub-workflow executions in execution logs

Because a sub-workflow call appears in its parent's task logs as a single
opaque task whose child run is otherwise invisible, `buddy_execution_logs`
SHALL look up the execution's direct child executions and mark each task that
spawned one with the child's workflow name, execution id, and status, and
SHALL summarize the spawned children with a pointer to drill down by calling
the tool again with a child's execution id. An `includeSubExecutions` option
SHALL additionally inline the task logs of the first few child executions
(bounded, so a wide fan-out cannot flood the output). A child execution whose
spawning task is not shown — unmatched, or hidden by `failedOnly` — SHALL
still be listed in the result so its execution id stays reachable. A failed
child-execution lookup SHALL NOT fail the call: the task logs are returned
with a note that sub-executions could not be checked.

#### Scenario: A task that ran a sub-workflow is marked

- **GIVEN** an execution with a task that spawned a sub-workflow execution
- **WHEN** `buddy_execution_logs` runs
- **THEN** that task's entry names the child's workflow, execution id, and
  status, and the result summarizes how many sub-executions were spawned

#### Scenario: Sub-execution details on demand

- **GIVEN** the same execution
- **WHEN** `buddy_execution_logs` runs with `includeSubExecutions: true`
- **THEN** the result appends the child execution's own task logs

#### Scenario: Child lookup failure degrades gracefully

- **GIVEN** the child-execution lookup errors
- **WHEN** `buddy_execution_logs` runs
- **THEN** the parent's task logs are returned with a note that sub-workflow
  executions could not be checked

### Requirement: Page oversized tool results

The system SHALL keep MCP tool responses below the transport-friendly output
limit by returning a preview for oversized text results and caching the full
result in memory for `buddy_result_read`. Cached result reads SHALL support
offset/limit paging and line search, and SHALL fail clearly when an id has been
evicted or was never cached.

#### Scenario: Oversized output

- **GIVEN** a tool produces text longer than the MCP output preview limit
- **WHEN** the bridge formats the result
- **THEN** the returned text contains a preview, a cache id, a continuation call
  for `buddy_result_read`, and a search example

#### Scenario: Read cached output

- **GIVEN** an oversized result was cached
- **WHEN** `buddy_result_read` is called with that id and an offset
- **THEN** the bridge returns the requested character slice without re-running the
  original Rewst API call

### Requirement: Provide working-method instructions to MCP clients

The system SHALL report a non-empty `instructions` string in the MCP initialize
handshake, assembled from the same steering fragments the workflow tool specs
use — summary-before-full detail, name-based edits, sub-workflow composition
over flat canvases, crate-and-workflow reuse before building, impact checks
before sub-workflow contract changes, render-verify before and after edits, and
the run-and-check-logs loop — so an external MCP client receives the same
working-method guidance as the in-process chat surface and the wording cannot
drift between the two.

#### Scenario: Instructions reach the client

- **GIVEN** the MCP server
- **WHEN** a client completes the initialize handshake
- **THEN** the client receives instructions that cover summary-first workflow
  reading, sub-workflow composition, and the run-and-check-logs loop

#### Scenario: Instructions share one source with tool descriptions

- **GIVEN** a shared steering fragment
- **WHEN** the instructions are generated
- **THEN** the fragment text appears verbatim in both the instructions and the
  corresponding workflow tool description

#### Scenario: Reuse and impact guidance included

- **WHEN** the instructions are generated
- **THEN** they include, verbatim from the shared fragments, the
  crate-reuse-before-building steering and the run-impact-before-changing-a-
  sub-workflow-contract steering

### Requirement: Expose recipe prompts

The system SHALL expose the MCP prompts `debug-execution`, `safe-workflow-edit`,
and `compose-sub-workflow`, each rendering a user-role text message that walks
the standard tool sequence for that task and incorporates any provided
`executionId`/`workflowId`/`goal` arguments. Requesting an unknown prompt name
SHALL fail with a clear error.

#### Scenario: Prompts are listed

- **GIVEN** the MCP server
- **WHEN** a client lists prompts
- **THEN** all three recipe prompts are returned with descriptions and argument
  declarations

#### Scenario: A prompt renders with its arguments

- **GIVEN** the `debug-execution` prompt
- **WHEN** a client requests it with an `executionId`
- **THEN** the rendered user message contains that execution id and the
  execution-log tool sequence

#### Scenario: Unknown prompt name

- **GIVEN** a prompt name the server does not define
- **WHEN** a client requests it
- **THEN** the request fails with an error naming the unknown prompt

### Requirement: Render Jinja against a merged execution context

Because an execution's stored context snapshots are per-publish deltas — each
frame holds only the keys that publish wrote, so the last frame is not the
most complete view — `buddy_render_jinja` SHALL, when given an `executionId`
and no `contextIndex`, merge all snapshots in order into one cumulative
context (later writes to a key win) and use that as `CTX`. A `contextIndex`
SHALL select that single raw snapshot without merging. Keys mode SHALL report
how many snapshots the listed context was merged from.

#### Scenario: Early-frame keys stay visible by default

- **GIVEN** an execution whose first snapshot holds the run inputs and whose
  later snapshots each hold only newly published keys
- **WHEN** `buddy_render_jinja` renders `{{ CTX.<run input> }}` with no
  `contextIndex`
- **THEN** the value renders from the merged context rather than being
  undefined

#### Scenario: contextIndex inspects one raw delta

- **GIVEN** an execution with several snapshots
- **WHEN** `buddy_render_jinja` is called with `contextIndex: 0`
- **THEN** the render context is exactly that snapshot, unmerged

### Requirement: Derive the Jinja docs engine host and cache only successful fetches

`buddy_get_jinja_filter_docs` SHALL derive the Jinja engine host from the
session's region GraphQL host by replacing a leading `api.` with `engine.`,
falling back to a hardcoded `https://engine.rewst.io` default when the
region's host is missing, does not start with `api.`, or fails to parse as a
URL. A successfully fetched filter catalog SHALL be cached in memory per engine
host for the life of the extension session. A failed fetch SHALL NOT be
cached, so the next call retries the fetch rather than repeating the failure
from a cached error.

#### Scenario: Region host maps to the engine host

- **GIVEN** the session's region GraphQL host is `api.rewst.io`
- **WHEN** `buddy_get_jinja_filter_docs` runs
- **THEN** the catalog is fetched from `engine.rewst.io`

#### Scenario: Unrecognized region falls back to the default engine host

- **GIVEN** the session's region host is missing or does not start with `api.`
- **WHEN** `buddy_get_jinja_filter_docs` runs
- **THEN** the catalog is fetched from the hardcoded default engine host

#### Scenario: A failed fetch is not cached

- **GIVEN** a catalog fetch for an engine host fails
- **WHEN** `buddy_get_jinja_filter_docs` is called again
- **THEN** the tool retries the fetch rather than reusing a cached failure

### Requirement: Reuse approvals only for reusable mutation scopes

The system SHALL remember approval for mutation scopes that are safe to reuse
within the current extension session, such as repeated writes to the same
approved GraphQL scope or repeated auto-layouts of the same workflow, in a
single process-global cache keyed by organization id and resource id. This
cache is not transport-specific: it is shared by both the in-process Cage-Free
Rewsty chat tool path and the external MCP transport, behind the one
mutation-approval modal both paths call — see ai-chat's `Run in-process Buddy
tools with a per-response cap` requirement for the chat-side description of
this same mechanism. The system SHALL still require fresh approval for
operations whose execution itself is the risky action: running a workflow,
editing a workflow's definition (each edit is a distinct graph change the user
has not seen), and any delete-type mutation (delete template, delete tag,
delete org variable, delete workflow) regardless of any prior non-delete
approval already recorded for that same resource — the approval scope is keyed
only by organization and resource id, with no operation-type component, so a
delete sharing a resource's scope with an earlier rename/update approval must
never silently reuse it (#177).

#### Scenario: Reused raw GraphQL mutation approval

- **GIVEN** a raw GraphQL mutation scope was approved for an org and resource
- **WHEN** the same mutation scope is requested again in the same session
- **THEN** the mutation can run without prompting again

#### Scenario: Approval reuse crosses the chat/MCP transport boundary

- **GIVEN** a mutation scope was approved through the in-process Cage-Free
  Rewsty chat tool path
- **WHEN** the same org+resource scope is requested again through the external
  MCP transport in the same extension session
- **THEN** the mutation can run without prompting again
- **AND** the reverse also holds: a scope approved through the external MCP
  transport is reused for the in-process chat path

#### Scenario: Workflow run approval is always fresh

- **GIVEN** a workflow run was approved previously
- **WHEN** the same workflow is run again
- **THEN** the user is prompted again before the run starts

#### Scenario: Workflow edit approval is always fresh

- **GIVEN** a workflow edit was approved previously for a workflow
- **WHEN** another edit to the same workflow is requested in the same session
- **THEN** the user is prompted again before the edit is saved

#### Scenario: Approving a non-delete mutation does not pre-approve a delete on the same resource

- **GIVEN** a non-delete mutation (e.g. rename, update, or auto-layout) on a
  resource was approved in the current session
- **WHEN** a delete-type mutation is requested for that same org+resource
- **THEN** the user is prompted again before the delete runs, rather than the
  delete silently reusing the earlier approval

### Requirement: Diagnose a failed execution in one call

The system SHALL expose `buddy_workflow_diagnose`, a read capability that
composes an execution's failing-task logs, its workflow definition's
transition path, any sub-workflow executions it spawned, and its merged
Jinja render context into one ordered digest, so an agent does not need the
usual `buddy_workflow_executions` → `buddy_execution_logs` →
`buddy_workflow_get` → `buddy_render_jinja` round trip. It SHALL accept an
`executionId` directly, or a `workflowId` (with `orgId`) to find that
workflow's most recent `FAILED` execution. It is `requiresOrg:false` with
`scopedSessions:true`, and SHALL use the same multi-session sweep semantics
as `buddy_execution_logs` to locate task logs across active sessions. When an
execution's owner org differs from the workflow's org, the digest SHALL use the
execution owner org for task logs and context, and the workflow org for reading
the workflow definition and transition path.

#### Scenario: Root cause found

- **GIVEN** an execution with one earlier failing task followed by a later
  cascading failure
- **WHEN** `buddy_workflow_diagnose` is called with that execution's id
- **THEN** the digest names the EARLIEST failing task as the likely root
  cause, with its message, input, and result
- **AND** it includes that task's incoming and outgoing transitions from the
  workflow definition

#### Scenario: Executed path is ordered and annotated

- **GIVEN** an execution whose task logs arrive out of order
- **WHEN** `buddy_workflow_diagnose` is called with that execution's id
- **THEN** the digest includes an `Executed path` section that lists the tasks
  in execution order
- **AND** each step includes the corresponding graph transition line between
  tasks, including publish details when present

#### Scenario: Workflow definition lives in the managing org

- **GIVEN** an execution owned by a child org and a workflow definition owned by
  its managing org
- **WHEN** `buddy_workflow_diagnose` is called with that execution's id
- **THEN** the digest fetches the workflow definition from the workflow org
  reported by the execution metadata
- **AND** it includes the transition path instead of reporting the workflow
  definition unavailable in the child org

#### Scenario: No failing task

- **GIVEN** an execution whose task logs contain no failed status
- **WHEN** `buddy_workflow_diagnose` is called with that execution's id
- **THEN** the digest reports that no failing task was found instead of
  erroring

#### Scenario: Failure originates in a sub-workflow call

- **GIVEN** the earliest failing task spawned a child execution that itself
  failed
- **WHEN** `buddy_workflow_diagnose` is called
- **THEN** the digest flags the child execution as the likely deeper cause
  and names its id for a follow-up `buddy_workflow_diagnose` call

#### Scenario: Diagnose by workflow id

- **GIVEN** no `executionId` is known
- **WHEN** `buddy_workflow_diagnose` is called with `workflowId` and `orgId`
- **THEN** it finds and diagnoses that workflow's most recent `FAILED`
  execution
- **AND** it reports plainly when no `FAILED` execution exists rather than
  erroring

#### Scenario: Best-effort supplementary sections

- **GIVEN** the workflow definition or the merged execution context cannot
  be fetched (e.g. a GraphQL error)
- **WHEN** `buddy_workflow_diagnose` is called
- **THEN** the digest still returns the failing task's logs
- **AND** it notes which supplementary section is unavailable instead of
  failing the whole call

### Requirement: Report the impact of changing a workflow or pack action

The system SHALL expose `buddy_workflow_impact`, a read capability that lists
the workflows that would break when a contract changes, in exactly one of two
modes per call. Given `workflowId` (with `orgId`), it SHALL first verify the
workflow belongs to the requested org, then list every workflow that calls it
as a sub-workflow, resolved from the platform's parent-workflow relation and
deduplicated by calling workflow. Given `actions` (each entry a pack ref with
one or more action refs), it SHALL list the workflows the platform reports as
affected by breaking changes to those pack actions. A call supplying neither
or both of `workflowId` and `actions` SHALL be rejected with a validation
error. The `buddy_workflow_edit` tool description SHALL steer agents to run
this tool before `set_inputs` or `set_output` on a workflow other workflows
may call.

#### Scenario: Sub-workflow callers listed

- **GIVEN** a workflow called as a sub-workflow by tasks in two other
  workflows
- **WHEN** `buddy_workflow_impact` is called with that `workflowId` and
  `orgId`
- **THEN** both calling workflows are listed with their names, ids, and the
  calling task names, deduplicated by calling workflow

#### Scenario: No callers

- **GIVEN** a workflow no other workflow calls
- **WHEN** `buddy_workflow_impact` is called with its `workflowId`
- **THEN** the result states plainly that no workflows call it, rather than
  returning an empty string or erroring

#### Scenario: Workflow outside the requested org

- **GIVEN** a `workflowId` whose workflow belongs to a different org than the
  requested `orgId` (or does not exist)
- **WHEN** `buddy_workflow_impact` is called
- **THEN** the call fails closed with an error naming the workflow id and org

#### Scenario: Pack-action impact

- **GIVEN** a set of pack action refs
- **WHEN** `buddy_workflow_impact` is called with `actions` and `orgId`
- **THEN** each affected workflow is listed with its name, id, and the
  affected action names, and an empty platform response is reported as "no
  affected workflows" rather than an empty string

#### Scenario: Exactly one mode

- **WHEN** `buddy_workflow_impact` is called with both `workflowId` and
  `actions`, or with neither
- **THEN** the call is rejected with a validation error naming both fields

### Requirement: Discover prebuilt Crates

The system SHALL expose `buddy_search_crates`, a read capability over the
Rewst Crate marketplace, so an agent can check whether a prebuilt automation
already exists before building a workflow. The default source SHALL search
the crate catalog visible to the authenticated session, matching an optional
filter case-insensitively against crate names, and SHALL flag crates already
unpacked in the requested org. A `public` source SHALL list the public crate
listing instead, applying the name filter client-side. Results SHALL be
bounded by a clamped limit, and long crate descriptions SHALL be truncated.
The workflow-creation tool description SHALL steer agents to search Crates
and existing workflows before building anew.

#### Scenario: Catalog search with install status

- **GIVEN** a crate catalog containing a matching crate that is unpacked in
  the requested org and one that is not
- **WHEN** `buddy_search_crates` is called with `orgId` and a name filter
- **THEN** matching crates are listed with name, id, and category, and only
  the unpacked crate carries the installed marker

#### Scenario: No matches

- **WHEN** `buddy_search_crates` matches nothing
- **THEN** the result states plainly that no crates matched, rather than
  returning an empty string or erroring

#### Scenario: Public listing

- **WHEN** `buddy_search_crates` is called with `source: "public"`
- **THEN** the public crate listing is returned, filtered client-side by the
  optional name filter

#### Scenario: Invalid source

- **WHEN** `buddy_search_crates` is called with an unknown `source` value
- **THEN** the call is rejected with an error naming the valid sources

### Requirement: Unpack a Crate into an organization

The system SHALL expose `buddy_unpack_crate`, a write capability that installs
(unpacks) one prebuilt Crate into one organization over the platform's unpack
stream, gated by the write-tools setting and per-call approval like every
other write capability. Because crates declare their own configuration
dynamically as an ordered list of tokens (free-text inputs and single- or
multi-select options), the capability SHALL resolve every value-bearing token
from the caller-supplied values (keyed by token name or id) with fallback to
the crate's own defaults, and when any token remains unresolved it SHALL
return a structured `input_required` response describing each missing token
(name, type, options, default, hint) and each default that resolved — without
prompting or mutating — so the caller can retry with complete values. The
unpack input SHALL mirror the shape the Rewst web unpack wizard sends: the
workflow carries the crate's source-workflow name and time-savings figure (no
org id — targeting is the top-level org id), every crate trigger (a crate can
carry several) is covered with its own name and criteria forwarded from the
underlying trigger, and multiselect token values are serialized as a
Jinja-wrapped JSON list. The crate's triggers SHALL install disabled unless
the caller explicitly enables them, and the success response SHALL name the
unpacked workflow and any org variables the crate requires.

#### Scenario: Discover a crate's configuration dynamically

- **GIVEN** a crate whose tokens include one with neither a supplied value
  nor a default
- **WHEN** `buddy_unpack_crate` is called without covering that token
- **THEN** the result is `input_required`, listing the missing token with its
  type and options and the tokens that resolved via defaults
- **AND** no approval is requested and nothing is mutated

#### Scenario: Unpack with approval

- **GIVEN** every value-bearing token resolves from supplied values or
  defaults
- **WHEN** `buddy_unpack_crate` is called and the user approves the prompt
- **THEN** the unpack runs with token arguments in wizard order, triggers
  defaulting to disabled, and the unpacked workflow id is reported along with
  the crate's required org variables

#### Scenario: Approval denied

- **WHEN** the user denies the approval prompt
- **THEN** the result is `approval_required` and the unpack stream is never
  started

#### Scenario: Multiselect token values

- **WHEN** a multiselect token is supplied an array of option values
- **THEN** the values are serialized into the single Jinja-wrapped JSON list
  token argument the platform expects

#### Scenario: Multiple triggers

- **GIVEN** a crate that carries several triggers
- **WHEN** the unpack input is built
- **THEN** every crate trigger is included, each with its own trigger name and
  criteria and its underlying trigger's managed-orgs default

#### Scenario: Unknown crate

- **WHEN** `buddy_unpack_crate` names a crate id that is not visible to the
  session
- **THEN** the call is rejected with an error naming the crate id

### Requirement: Install a Crate interactively

The system SHALL provide an `Install Crate` command that walks the user from
crate discovery to a completed install: an organization pick, a searchable
catalog pick that marks already-installed crates, a configuration wizard
generated dynamically from the crate's token metadata (option pickers for
select tokens including multi-select, prefilled input boxes for free-text
tokens), a workflow-name prompt, a trigger enablement choice defaulting to
disabled, and a modal confirmation summarizing the install before the unpack
stream runs with visible progress. Cancelling any step SHALL abort the
install without mutating anything.

_Implementation status:_ the interactive command builds the same unpack input
as `buddy_unpack_crate` and shares its behavior guarantees; the full
end-to-end wizard interaction (organization pick through confirmation) is
exercised manually rather than by an automated UI test.

#### Scenario: Dynamic token wizard

- **GIVEN** a crate with a free-text token and a multiselect token
- **WHEN** the user runs `Install Crate` and selects the crate
- **THEN** the free-text token prompts with its default prefilled and the
  multiselect token offers its options with defaults preselected, in the
  crate's wizard order

#### Scenario: Cancel aborts cleanly

- **WHEN** the user dismisses any wizard step or the final confirmation
- **THEN** the command returns without starting the unpack stream

### Requirement: Reject task-level retry configuration (#161)

The system SHALL reject any `add_task` or `update_task` operation that supplies
a `retry` or `retries` field, because the Rewst engine fails to initialize a
task saved with a retry object and the run dies with no task logs. The rejection
SHALL name the field and explain the correct alternative (a loop: wrap the
action in its own sub-workflow, route its failure transition to a delay task,
and loop back with a bounded attempt counter). Existing stored `retry` values
SHALL survive round-trips unchanged — `buddy_workflow_get` still shows them and
`updateWorkflow` still carries them forward — so that workflows already
configured in the Rewst UI are not silently corrupted.

#### Scenario: add_task with retry is rejected

- **GIVEN** an `add_task` operation that includes a `retry` field
- **WHEN** `buddy_workflow_edit` applies the batch
- **THEN** the call errors with a message naming `retry` and describing the
  loop alternative, and nothing is saved

#### Scenario: update_task.set with retry is rejected

- **GIVEN** an `update_task` operation whose `set` object includes a `retry`
  field
- **WHEN** `buddy_workflow_edit` applies the batch
- **THEN** the call errors with a message naming `retry` and describing the
  loop alternative, and nothing is saved

#### Scenario: Existing retry survives round-trip

- **GIVEN** a workflow whose task already has a `retry` object stored in Rewst
- **WHEN** `buddy_workflow_edit` applies an unrelated edit
- **THEN** the task's existing `retry` value is carried forward in the
  `updateWorkflow` mutation unchanged

### Requirement: Require labels on custom transitions (#160)

The system SHALL reject a `connect` or `set_transition` operation that would
produce a transition whose condition is not the default success condition
(`{{ SUCCEEDED }}`) and whose label is empty or whitespace. Success and default
transitions SHALL remain label-optional. Validation SHALL be per-operation at
apply time so a batch cannot defer labeling to a later call.

#### Scenario: connect with custom condition and no label is rejected

- **GIVEN** a `connect` operation with a non-success `when` and an empty
  `label`
- **WHEN** `buddy_workflow_edit` applies the batch
- **THEN** the call errors naming the missing label, and nothing is saved

#### Scenario: connect with success condition needs no label

- **GIVEN** a `connect` operation with `when: "{{ SUCCEEDED }}"` and no label
- **WHEN** `buddy_workflow_edit` applies the batch
- **THEN** the transition is created without error

#### Scenario: set_transition producing an unlabeled custom transition is rejected

- **GIVEN** a `set_transition` operation that sets a custom `when` without
  setting a `label`
- **WHEN** `buddy_workflow_edit` applies the batch
- **THEN** the call errors asking for a label in the same operation

### Requirement: Auto-layout after structural edits (#163)

The system SHALL automatically run a full auto-layout pass after any
`buddy_workflow_edit` batch that changes the graph structure
(`add_task`, `delete_task`, `connect`, `disconnect`, `set_transition`), unless
the same batch also positions tasks explicitly (`reposition`, `autolayout`, or
`add_task` with numeric `x` and `y`). Content-only edits (rename, input
changes, `set_inputs`, `set_output`) SHALL NOT trigger auto-layout. When
auto-layout runs automatically, the `applied` list SHALL include an
`autolayout (automatic after structural edits)` entry so the caller knows
positions changed.

#### Scenario: Structural edit triggers auto-layout

- **GIVEN** a batch containing an `add_task` operation with no explicit
  position
- **WHEN** `buddy_workflow_edit` saves the batch
- **THEN** a full auto-layout runs and the applied list includes
  `autolayout (automatic after structural edits)`

#### Scenario: Explicit positioning suppresses auto-layout

- **GIVEN** a batch containing an `add_task` with numeric `x` and `y`
- **WHEN** `buddy_workflow_edit` saves the batch
- **THEN** only `layoutNewTasks` runs (placing only position-less tasks) and
  the applied list does NOT include the automatic autolayout entry

#### Scenario: Content-only edit does not move tasks

- **GIVEN** a batch containing only an `update_task` that changes a task's
  input
- **WHEN** `buddy_workflow_edit` saves the batch
- **THEN** only `layoutNewTasks` runs and no auto-layout entry appears

### Requirement: List recently edited workflows (#155)

The system SHALL provide a `buddy_recent_workflow_edits` tool that lists one
org's workflows ordered by most-recent edit, returning each workflow's name,
id, last-updated timestamp (as an ISO-8601 string), and the username of the
last editor. An optional `username` filter SHALL narrow results to workflows
whose last editor's username contains the supplied substring
(case-insensitive). Username filtering SHALL be performed client-side after
fetching a larger result set, so the GraphQL `where` clause is never widened
beyond the org filter. The tool SHALL accept an optional `limit` (default 25,
max 100).

#### Scenario: List recent edits

- **GIVEN** an org with several workflows edited at different times
- **WHEN** `buddy_recent_workflow_edits` is called
- **THEN** workflows are returned newest-first with name, id, ISO timestamp,
  and last editor's username (or `(unknown user)` when the user record is
  absent)

#### Scenario: Filter by username

- **GIVEN** an org where multiple users have edited workflows
- **WHEN** `buddy_recent_workflow_edits` is called with `username: "alice"`
- **THEN** only workflows whose last editor's username contains `alice`
  (case-insensitive) are returned

#### Scenario: Empty result

- **GIVEN** no workflows match the filter
- **WHEN** `buddy_recent_workflow_edits` is called
- **THEN** a clear message is returned naming the org and the filter (if any)

### Requirement: Attribute workflow patches to their author (#155)

The system SHALL include the authoring user's username in each row returned by
`buddy_list_workflow_patches`. An optional `username` filter SHALL narrow
results to patches whose author's username contains the supplied substring
(case-insensitive), using the same client-side filtering pattern as
`buddy_recent_workflow_edits`.

#### Scenario: Patch list includes author

- **GIVEN** a workflow with several patches made by different users
- **WHEN** `buddy_list_workflow_patches` is called
- **THEN** each row includes `by <username>` (or `by (unknown user)`) after
  the creation timestamp

#### Scenario: Filter patches by username

- **GIVEN** the same workflow
- **WHEN** `buddy_list_workflow_patches` is called with `username: "bob"`
- **THEN** only patches authored by a user whose username contains `bob`
  (case-insensitive) are returned

### Requirement: Resolve workflow names before scope approval (#154)

The system SHALL resolve each requested workflow id to its name before
presenting any approval modal, so the user sees `<name> (<id>)` rather than a
raw UUID. If no active session can resolve a workflow id, the tool SHALL error
immediately with a message naming the unresolvable id, before any modal is
shown. Org approvals and workflow approvals SHALL be issued as separate modal
requests — one for the org group and one per workflow — so the user can
approve or deny each independently. The status bar tooltip and the
`SetWorkingScope` command quick-pick SHALL display workflow names alongside
ids wherever names are known.

#### Scenario: Unresolvable workflow id errors before modal

- **GIVEN** a `buddy_set_working_scope` call with a workflow id that no active
  session can see
- **WHEN** the tool runs
- **THEN** it errors immediately with a message naming the unresolvable id,
  and no approval modal is shown

#### Scenario: Org and workflow approvals are separate

- **GIVEN** a `buddy_set_working_scope` call with one org id and two workflow
  ids
- **WHEN** the tool runs
- **THEN** the user sees three separate approval modals: one for the org and
  one for each workflow

#### Scenario: Partial approval is reported

- **GIVEN** the user approves the org modal but denies one workflow modal
- **WHEN** `buddy_set_working_scope` completes
- **THEN** the response has `status: "partial"` with `approved` and `denied`
  lists, and only the approved parts are applied to the working scope

#### Scenario: Status bar shows workflow names

- **GIVEN** a workflow has been added to the working scope with a resolved name
- **WHEN** the user hovers the status bar item
- **THEN** the tooltip shows `<name> (<id>)` for that workflow

### Requirement: Drill into nested sub-workflow executions (#152)

The system SHALL accept a `depth` parameter on `buddy_execution_logs` and
`buddy_workflow_diagnose` that controls how many levels of nested
sub-workflow executions are fetched and surfaced. The default depth for
`buddy_execution_logs` SHALL be 1 (direct children only, preserving existing
behavior). The default depth for `buddy_workflow_diagnose` SHALL be 3. The
maximum depth SHALL be 5. A depth that exceeds the maximum SHALL be silently
clamped. When the total number of sub-execution fetches would exceed the
fetch cap, the result SHALL note that the tree was truncated rather than
silently omitting levels. Per-node fetch errors SHALL degrade gracefully
(appended as notes) and SHALL NOT fail the call.

#### Scenario: depth=1 preserves existing behavior

- **GIVEN** `buddy_execution_logs` is called without a `depth` argument
- **THEN** only direct child executions are surfaced, matching pre-feature
  behavior

#### Scenario: depth=2 surfaces grandchildren

- **GIVEN** an execution whose child spawned its own sub-workflow
- **WHEN** `buddy_execution_logs` is called with `depth: 2`
- **THEN** both the child and grandchild executions appear in the result

#### Scenario: Fetch cap triggers truncation notice

- **GIVEN** a deeply nested execution tree that would require more fetches
  than the cap allows
- **WHEN** `buddy_execution_logs` is called with a large depth
- **THEN** the result includes a truncation notice naming the cap, rather
  than silently stopping

#### Scenario: Per-node fetch error degrades gracefully

- **GIVEN** one node in the sub-execution tree cannot be fetched
- **WHEN** `buddy_execution_logs` runs
- **THEN** the error is appended as a note and the rest of the tree is still
  returned
