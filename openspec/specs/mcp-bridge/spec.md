# MCP Bridge Specification

## Purpose

The extension can expose its authenticated Rewst sessions to external MCP clients
(and to its own in-process chat) as a set of tools, without handing those clients
a Rewst credential. This capability covers enabling the bridge, the localhost
token, which tools are exposed, and the working-scope rules that bound what a tool
may touch.

Source: `src/mcp/` (`McpServerController.ts`, `McpActions.ts`,
`McpDefinitionProvider.ts`, `runtime.ts`, `settings.ts`, `throttle.ts`),
`src/commands/mcp/`, `src/capabilities/*Capabilities.ts`,
`src/models/WorkingScopeManager.ts`.

## Requirements

### Requirement: Enable the bridge and run a localhost server

The system SHALL run the MCP bridge as a localhost HTTP server only when
`rewst-buddy.mcp.enable` is on (or the credential server is independently
enabled), and SHALL reject all MCP requests when the bridge is disabled.

#### Scenario: Bridge disabled

- **GIVEN** `rewst-buddy.mcp.enable` is false
- **WHEN** an MCP client calls a tool
- **THEN** the request is rejected because the bridge is not enabled

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

### Requirement: Gate write tools behind explicit settings

The system SHALL expose write tools (those with `access: 'write'`) only when
`rewst-buddy.mcp.enableWriteTools` is on, and SHALL expose the raw GraphQL
mutation tool only when `rewst-buddy.mcp.enableDangerousGraphqlMutation` is on.
Read tools are available without these switches.

#### Scenario: Write tools disabled

- **GIVEN** `enableWriteTools` is false
- **WHEN** a client lists tools
- **THEN** workflow/template/trigger/variable mutation tools are not callable

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
