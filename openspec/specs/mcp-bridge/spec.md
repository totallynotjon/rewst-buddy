# MCP Bridge Specification

## Purpose

The extension can expose its authenticated Rewst sessions to external MCP clients
as a set of tools and lightweight resources, without handing those clients a
Rewst credential. The same central capability registry can also contribute tools
to in-process chat models, but chat tool availability is not controlled by the
external bridge enablement setting. This capability covers enabling the external
bridge, the localhost token, which tools and resources are exposed, and the
working-scope rules that bound what a tool may touch.

Source: `src/mcp/` (`McpServerController.ts`, `McpActions.ts`,
`McpDefinitionProvider.ts`, `runtime.ts`, `settings.ts`, `throttle.ts`),
`src/commands/mcp/`, `src/capabilities/*Capabilities.ts`,
`src/models/WorkingScopeManager.ts`.

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
- **WHEN** the user runs `Copy MCP Config to Clipboard`
- **THEN** the copied JSON points at the localhost `/mcp` URL and carries the
  token only as an env-var placeholder, not the literal value

#### Scenario: Add to VS Code

- **WHEN** the user runs `Add MCP Server to VS Code`
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
  `buddy_list_templates`
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

### Requirement: Bound writes to a pinned working workflow

When a working workflow is pinned, the system SHALL require a workflow-targeting
write to name a workflow in scope, rejecting others with `workflow_out_of_scope`.

#### Scenario: Write targets an out-of-scope workflow

- **GIVEN** a specific workflow is pinned as the working scope
- **WHEN** a write tool targets a different workflow
- **THEN** it is rejected with `workflow_out_of_scope`

### Requirement: Scope reads per configuration

The system SHALL scope reads to the effective allowed set only when
`rewst-buddy.mcp.workingOrgScope` is `strict` and a working org is pinned. Under
`writes`, reads may target any organization the session manages. Organization-
discovery tools (those not requiring an org, e.g. `buddy_list_orgs`,
`buddy_get_working_scope`) SHALL never be scoped.

#### Scenario: Strict read scoping

- **GIVEN** `workingOrgScope` is `strict` and a working org is pinned
- **WHEN** a read tool targets a different org
- **THEN** it is rejected as out of scope

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

Because tool inputs are not validated against the advertised `inputSchema`, each
capability SHALL validate and coerce every input itself (required strings,
clamped numbers, enum checks) rather than trusting the schema.

#### Scenario: Out-of-range numeric input

- **GIVEN** a tool that accepts a `limit`
- **WHEN** a caller passes a value past the maximum
- **THEN** the capability clamps it to the allowed maximum rather than honoring
  the raw value

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

### Requirement: Reuse approvals only for reusable mutation scopes

The system SHALL remember approval for mutation scopes that are safe to reuse
within the current extension session, such as repeated writes to the same
approved GraphQL or workflow-edit scope. It SHALL still require fresh approval
for operations whose execution itself is the risky action, such as running a
workflow.

#### Scenario: Reused raw GraphQL mutation approval

- **GIVEN** a raw GraphQL mutation scope was approved for an org and resource
- **WHEN** the same mutation scope is requested again in the same session
- **THEN** the mutation can run without prompting again

#### Scenario: Workflow run approval is always fresh

- **GIVEN** a workflow run was approved previously
- **WHEN** the same workflow is run again
- **THEN** the user is prompted again before the run starts
