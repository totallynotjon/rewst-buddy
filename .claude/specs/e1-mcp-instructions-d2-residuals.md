# Implementation Spec — Epic #129: E1 (MCP instructions + prompts) + D2.4/D2.6 residuals

Written for Sonnet 4.6 to execute. This spec is self-contained: every path, symbol, and line
reference below was verified against HEAD (`5cd5387`). Epic #129's own file:line references
predate PRs #130/#131 and are stale — use the references here, not the epic's.

## Target & scope

- **Epic items:** E1.1–E1.5 (full), D2.4 (residuals only — most landed in PR #131), D2.6
  (verification/close-out only — already shipped, see evidence below).
- **Out of scope:** C1 (codegen migration — must be its own PR), E2/E3 (epic's own next
  grouping), D3, everything else.
- **Branch:** `feat/e1-mcp-instructions-d2-residuals` off `main`. Never commit to main.
- **PR title:** `E1: MCP server instructions + recipe prompts; finish D2 helper dedup residuals`
- **PR:** `gh pr create --draft`. Never mark ready. PR body must note: "D2.6 verified already
  complete — bounding shipped in #70 (`formatMcpOutput` at the MCP boundary,
  `src/mcp/McpActions.ts:403,491`), chat rides the same path since #91
  (`src/ui/chat/model/buddyChatTools.ts:59` → `callTool`), identity formatters deleted in #131,
  spec requirement 'Page oversized tool results' exists in `openspec/specs/mcp-bridge/spec.md`,
  boundary test at `src/mcp/McpActions.test.ts:190`. Epic checkboxes D2.4 and D2.6 can be
  ticked on merge."

## Project summary (target slice)

VS Code extension exposing Rewst platform capabilities two ways: an in-extension MCP HTTP
server (`src/mcp/mcpServer.ts`, official `@modelcontextprotocol/sdk` ^1.29 `Server` +
`StreamableHTTPServerTransport`, one server per request, mounted at `/mcp`) and Cage-Free
Rewsty chat (which runs the same tools in-process via `callTool`). All tools are `Capability`
objects (`src/capabilities/*.ts`) built by `readCapability`/`writeCapability` factories
(`src/capabilities/capabilityFactories.ts`), registered in `src/capabilities/registry.ts`,
executed through `McpActions.callTool` which enforces settings gates, working-org scope,
throttle, approval, and output bounding (`formatMcpOutput`, 24k chars + cache paging via
`buddy_result_read`). Workflow tool prose lives in `src/workflow/specs.ts`
(`WORKFLOW_TOOL_SPECS`), mirrored byte-for-byte into `package.json`
`contributes.languageModelTools` (drift fails `Unit: package manifest` in
`src/packageManifest.test.ts`). Shared input helpers live in
`src/capabilities/inputHelpers.ts`. Path aliases (`@workflow`, `@capabilities`, `@mcp`, …)
come from `tsconfig.json` only.

## Spec delta (`openspec/specs/mcp-bridge/spec.md`)

**1. Update the Source block** (currently lines 13–17): add `` `mcpServer.ts` `` and
`` `instructions.ts` `` to the `src/mcp/` file list (note: `mcpServer.ts` is missing from it
today).

**2. Add two requirements** (place after the existing
`### Requirement: Page oversized tool results` section, matching house style):

```markdown
### Requirement: Provide working-method instructions to MCP clients

The system SHALL report a non-empty `instructions` string in the MCP initialize
handshake, assembled from the same steering fragments the workflow tool specs
use — summary-before-full detail, name-based edits, sub-workflow composition
over flat canvases, render-verify before and after edits, and the
run-and-check-logs loop — so an external MCP client receives the same
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
```

No spec changes for the D2 residuals — they are behavior-neutral refactors (all user-visible
strings, including error messages, stay byte-identical; existing tests are the contract).

## Test plan (write these FIRST — red before green)

**T1. `src/capabilities/inputHelpers.test.ts` — extend (runner: vitest; file already in
`vitest.suites.mjs`, imports `suite`/`test` from `../test/tdd`, relative imports, plain
assert).** New suite `Unit: inputHelpers — requireStringAllowEmpty`:

- returns `''` for an empty-string value;
- returns the string unchanged (no trimming) for a padded value;
- throws `/Missing required string argument "body"/` when the key is absent;
- throws when the value is a non-string (e.g. `42`).

Red: `requireStringAllowEmpty` is not exported from `./inputHelpers` yet.

**T2. `src/mcp/instructions.test.ts` — new file (runner: mocha extension host — it imports
`@workflow`, whose graph reaches `vscode`; do NOT add to `vitest.suites.mjs`).** Imports:
`* as assert`, `* as Mocha`, the fragment constants + `WORKFLOW_TOOL_SPECS` + tool-name
constants from `@workflow`, and `buildMcpInstructions`, `MCP_PROMPTS`, `renderMcpPrompt` from
`./instructions`. Suite `Unit: mcpInstructions`:

- `buildMcpInstructions()` contains each of `WORKFLOW_SUMMARY_DETAIL_STEERING`,
  `WORKFLOW_COMPOSITION_STEERING`, `RENDER_VERIFY_STEERING` verbatim, plus
  `WORKFLOW_RUN_TOOL_NAME`, `WORKFLOW_EXECUTION_LOGS_TOOL_NAME`, `'buddy_result_read'`, and
  `'approval_required'`;
- single-source guard: the `buddy_workflow_get` spec description contains
  `WORKFLOW_SUMMARY_DETAIL_STEERING`, the `buddy_workflow_edit` description contains
  `WORKFLOW_COMPOSITION_STEERING`, the `buddy_render_jinja` description contains
  `RENDER_VERIFY_STEERING` (look each up in `WORKFLOW_TOOL_SPECS` by name);
- `MCP_PROMPTS` has exactly the names `debug-execution`, `safe-workflow-edit`,
  `compose-sub-workflow`, each with a non-empty description;
- `renderMcpPrompt('debug-execution', { executionId: 'e-1' })` text includes `'e-1'` and
  `WORKFLOW_EXECUTION_LOGS_TOOL_NAME`;
- `renderMcpPrompt('safe-workflow-edit', {})` renders without arguments;
- `renderMcpPrompt('nope', {})` throws `/unknown prompt/i`.

**T3. `src/mcp/mcpServer.test.ts` — extend the existing
`MCP SDK server (in-memory transport)` suite** (mocha extension host), reusing the
`buildMcpServer` + `InMemoryTransport.createLinkedPair()` + `Client` harness at lines 56–98:

- after `client.connect`, `client.getInstructions()` is a non-empty string containing
  `'buddy_workflow_get'`;
- `client.listPrompts()` returns the three prompt names;
- `client.getPrompt({ name: 'debug-execution', arguments: { executionId: 'abc-123' } })`
  returns one message with `role === 'user'` and text containing `'abc-123'`;
- `client.getPrompt({ name: 'nope' })` rejects.

**T4. Existing tests as the refactor net (must stay green UNCHANGED — do not edit their
assertions):**

- `src/capabilities/templateMutateCapabilities.test.ts` (in-org rejections at lines
  173/281/359 assert `/Template t-1 is not in org org-sandbox/`; empty-body tests at 99/196);
- `src/capabilities/orgVariableMutateCapabilities.test.ts` (226/288 assert
  `/Org variable v1 is not in org org-sandbox/`; empty-value test at 114);
- `src/mcp/McpActions.test.ts`, `src/capabilities/capabilityFactories.test.ts`,
  `src/capabilities/registry.test.ts`;
- `src/ui/chat/tools/workflowTools.test.ts:113`
  (`buddy_workflow_get spec reserves full detail for ids and positions, not ordinary edits`)
  and `src/packageManifest.test.ts` (`Unit: package manifest`) — these two pin that the
  fragment extraction keeps descriptions **byte-identical**.

No integration test required: no live API behavior changes (instructions/prompts are local
server metadata; D2 residuals are internal).

## Ordered implementation steps

**Step 0 — branch.** `git checkout -b feat/e1-mcp-instructions-d2-residuals`.

### Part A — D2.4 residuals (commit 1: "D2.4 residuals: finish capability helper dedup")

**A1 (test first).** Write T1. Done-check:
`npx vitest run src/capabilities/inputHelpers.test.ts` fails on the new suite.

**A2. Hoist `requireStringAllowEmpty`.** Add to `src/capabilities/inputHelpers.ts` (next to
`requireString`, line ~94), exactly the existing semantics — no trimming, empty allowed:

```typescript
/** Requires a string argument that may be empty (e.g. a blank template body or variable value). */
export function requireStringAllowEmpty(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== 'string') throw new Error(`Missing required string argument "${key}".`);
	return value;
}
```

Delete the private copies at `src/capabilities/templateMutateCapabilities.ts:19-25` and
`src/capabilities/orgVariableMutateCapabilities.ts:63-67`; import from `./inputHelpers` in
both. Done-check: T1 green (`npx vitest run src/capabilities/inputHelpers.test.ts`).

**A3. Route `requireTemplateInOrg` through the generic.** In
`src/capabilities/templateMutateCapabilities.ts:34-46`, rewrite using `requireResourceInOrg`
from `./inputHelpers` (pattern: `requireTagInOrg`,
`src/capabilities/tagMutateCapabilities.ts:44-57`). Keep the wrapper — its name-extraction
return contract stays:

```typescript
async function requireTemplateInOrg(
	ctx: CapabilityContext,
	templateId: string,
	orgId: string,
): Promise<{ name: string }> {
	const template = await requireResourceInOrg({
		label: 'Template',
		id: templateId,
		orgId,
		fetch: () => ctx.session.getTemplate(templateId),
	});
	const name = (template as { name?: unknown }).name;
	return { name: typeof name === 'string' && name.length > 0 ? name : '(unnamed)' };
}
```

Error text is byte-identical (`Template ${id} is not in org ${orgId}.` — the generic produces
exactly this with label `Template`). The generic's default `inOrg` (`row.orgId === orgId`) is
equivalent to the old string check because `orgId` is a string. `getTemplate` throwing on an
unknown id propagates the same as before.

**A4. Route `requireOrgVariableInOrg` through the generic + `rawGraphqlOrThrow`.** In
`src/capabilities/orgVariableMutateCapabilities.ts:74-85`, mirror the tag pattern
(org-filtered query ⇒ `inOrg: () => true`):

```typescript
async function requireOrgVariableInOrg(
	ctx: CapabilityContext,
	variableId: string,
	orgId: string,
): Promise<OrgVariableRow> {
	return requireResourceInOrg({
		label: 'Org variable',
		id: variableId,
		orgId,
		fetch: async () => {
			const data = await rawGraphqlOrThrow(ctx.session, ORG_VARIABLE_BY_ID, { orgId, id: variableId });
			const rows = ((data as { orgVariables?: OrgVariableRow[] } | undefined)?.orgVariables ??
				[]) as OrgVariableRow[];
			return rows.find(r => r.id === variableId);
		},
		inOrg: () => true,
	});
}
```

Error text byte-identical. Keep the doc comment's secret-masking note.

**A5. Collapse the remaining two-step GraphQL sites in the same file**
(`orgVariableMutateCapabilities.ts:119-122`, `166-171`, `202-204`): replace each
`const { data, errors } = await ctx.session.rawGraphql(...); throwOnGraphqlErrors(errors);`
with `const data = await rawGraphqlOrThrow(ctx.session, ...);` (adjust the following casts —
they read `data` the same way). Update the file's imports: `rawGraphqlOrThrow`,
`requireResourceInOrg`, `requireStringAllowEmpty` from `./inputHelpers`; drop
`throwOnGraphqlErrors` from the `./mutationApproval` import (line 6).

**A6. Remove the vestigial re-export**
`export { throwOnGraphqlErrors } from './inputHelpers';` at
`src/capabilities/mutationApproval.ts:4` — after A5 its only non-test importer is gone. Grep
first: `throwOnGraphqlErrors.*mutationApproval` across `src/` (including tests) must return
nothing before deleting.

**A7. Dedupe `asString` in `src/mcp/McpActions.ts:179-182`.** Delete the local function; add
`export { asString } from './inputHelpers';` to `src/capabilities/index.ts` and add
`asString` to the existing `@capabilities` import at the top of `McpActions.ts`. All call
sites pass a defined `Record`, so the `| undefined` in the old local signature was vestigial —
the shared helper (`inputHelpers.ts:85-88`, identical trim/non-empty logic) drops in directly.

**A8. Delete the 57 dead `args:` literals.** `readCapability`/`writeCapability` always call
`withGeneratedArgs(spec)` (`src/capabilities/capabilityFactories.ts:33,41`), which
**unconditionally overwrites** `args` from `inputSchema` — every hand-written `args: '...'`
string in a capability spec is dead weight and documented drift risk (CodeRabbit flagged it
twice on #131). In each of these 17 files, delete the `args:` property from every spec
literal and change the const annotation from `ToolSpec` to `ToolSpecDefinition` (both
exported from `'../ui/chat/tools/toolProtocol'`): `jinjaDocsCapabilities`,
`resultReadCapability`, `templateSyncCapabilities`, `orgUserCapabilities`,
`pageTemplateCapabilities`, `templateLinkCapabilities`, `tagMutateCapabilities`,
`packIntegrationCapabilities`, `orgVariableMutateCapabilities`, `rewstReadCapabilities`,
`templateCloneCapabilities`, `triggerMutateCapabilities`, `templateMutateCapabilities`,
`graphqlMutateCapability`, `workflowCrudCapabilities`, `workingScopeCapability`,
`triggerFormCapabilities` (all under `src/capabilities/`), plus the one remaining literal in
`src/ui/chat/tools/graphqlTool.ts` (its `GRAPHQL_TOOL_SPECS` already passes through
`withGeneratedArgsForAll` at line 16). Guard: before deleting in a file, confirm the spec
array/const is only consumed via the factories or `withGeneratedArgsForAll` — the only raw
`.args` reader in production code is `buildToolInstructions` (`toolProtocol.ts:68`), which
reads post-generation specs.

Done-check for Part A: `npm run type-check` clean, then `npm run test:unit` fully green, then
`npm run test:grep -- "Unit: templateMutateCapabilities"` and
`npm run test:grep -- "Unit: orgVariableMutateCapabilities"` and
`npm run test:grep -- "Unit: package manifest"` green.

### Part B — E1 (commit 2: "E1: MCP server instructions + recipe prompts")

**B1 (tests first).** Write T2 (`src/mcp/instructions.test.ts`) and T3 (mcpServer.test.ts
additions). Done-check: `npm run test:grep -- "Unit: mcpInstructions"` and
`npm run test:grep -- "Unit: mcpServer"` fail (module missing / handlers missing).

**B2. Extract the shared steering fragments in `src/workflow/specs.ts`.** Add three exported
constants and interpolate them so each description's final string is **byte-identical** to
today's:

```typescript
/** Shared steering fragments: interpolated into tool descriptions below AND
 * assembled into the MCP server instructions (src/mcp/instructions.ts), so the
 * two surfaces cannot drift. Editing a fragment changes both; the package
 * manifest mirror test will flag the description change. */
export const WORKFLOW_SUMMARY_DETAIL_STEERING =
	'Summary is sufficient for understanding, explaining, and most name-based edits (buddy_workflow_edit operations resolve tasks by name). Pass detail "full" only when you need task ids, transition ids, or canvas positions';

export const WORKFLOW_COMPOSITION_STEERING =
	'PREFER COMPOSITION over one giant canvas: repeated sequences, independently testable sections, or many tasks doing one business operation are a sign to split; give the reusable sequence (ticket lifecycle, user lookup, license handling) its own workflow with set_inputs for its run inputs and set_output for its return values, then call it as a sub-workflow task.';

export const RENDER_VERIFY_STEERING =
	'CONFIRM a transition condition, task input, or publish expression evaluates the way you expect BEFORE editing a workflow';
```

Interpolation sites (verify each is an exact substring before cutting):

- `buddy_workflow_get` description (specs.ts:28):
  `...refers to tasks/edges by name. ${WORKFLOW_SUMMARY_DETAIL_STEERING}, such as repositioning a task or targeting one specific transition by id.`
  (convert that description to a template literal; the `detail` property description lower
  down is different wording — leave it alone);
- `buddy_workflow_edit` description (specs.ts:84, already a template literal): replace the
  trailing `PREFER COMPOSITION ... sub-workflow task.` sentence with
  `${WORKFLOW_COMPOSITION_STEERING}`;
- `buddy_render_jinja` description (specs.ts:196): use **string concatenation**, not a
  template-literal rewrite —
  `"...return only the result. Use this to " + RENDER_VERIFY_STEERING + " — the agent otherwise guesses wrong ..."`
  — the rest of that double-quoted literal contains `'\\\\\\\\1'`-style escape sequences;
  re-quoting it risks silently changing bytes.

Export the three constants from `src/workflow/index.ts`. This step must update
`package.json` **not at all** — byte-identity is proven by
`npm run test:grep -- "Unit: package manifest"` and the wording test.

**B3. New file `src/mcp/instructions.ts`.** Imports from `@workflow`: the three fragments
plus `WORKFLOW_EDIT_TOOL_NAME`, `WORKFLOW_RUN_TOOL_NAME`,
`WORKFLOW_EXECUTION_LOGS_TOOL_NAME`, `WORKFLOW_SEARCH_TOOL_NAME`; `RESULT_READ_TOOL_NAME`
from `../capabilities/resultReadCapability` (or via `@capabilities` — either is fine, no
cycle: the `@capabilities` barrel does not import `@mcp`). Exports:

```typescript
export function buildMcpInstructions(): string;
export interface McpPromptSpec {
	name: string;
	description: string;
	arguments: { name: string; description: string; required: boolean }[];
}
export const MCP_PROMPTS: McpPromptSpec[];
export function renderMcpPrompt(
	name: string,
	args: Record<string, unknown> | undefined,
): { description: string; text: string };
```

`renderMcpPrompt` reads argument values defensively (string-typed, non-empty after trim — the
MCP layer does not validate prompt arguments either) and throws
`new Error(\`Unknown prompt "${name}".\`)`for undefined names (message must match T2's`/unknown prompt/i`). Instructions text (use exactly this, fragments interpolated):

```text
Rewst Buddy MCP server: tools for reading and editing Rewst templates, workflows, executions, and org data through the user's authenticated VS Code sessions. This server does not grant direct filesystem or network access. Write tools are gated by VS Code settings, the user's working-org scope, and a per-call approval prompt shown in the VS Code window.

Working method for workflow tasks:
- Resolve names to ids with ${WORKFLOW_SEARCH_TOOL_NAME}; read a workflow with buddy_workflow_get. ${WORKFLOW_SUMMARY_DETAIL_STEERING}.
- Make changes with ${WORKFLOW_EDIT_TOOL_NAME}; operations resolve tasks by name and the tool saves with conflict detection. ${WORKFLOW_COMPOSITION_STEERING}
- Use buddy_render_jinja to ${RENDER_VERIFY_STEERING}, and again after saving to confirm the change behaves as intended.
- To verify end to end: ${WORKFLOW_RUN_TOOL_NAME} runs the workflow (per-call approval, every time) and reports the failing task's log on failure; inspect deeper with ${WORKFLOW_EXECUTION_LOGS_TOOL_NAME}, fix, and repeat until the run succeeds.
- A result with status "approval_required" means the operation was not executed and the user must respond to a prompt in the VS Code window running Rewst Buddy.
- Oversized results return a preview plus a cache id; continue with ${RESULT_READ_TOOL_NAME} as the result instructs.
```

Prompt texts (each returns one user-role message; `${...}` placeholders below mean: include
the line/value only when the argument was provided, otherwise the fallback shown):

- `debug-execution` — description
  `Diagnose a failed Rewst workflow execution from its logs and context.`; arguments
  `executionId` (optional, "Execution id to diagnose; omit to find a recent failed run"),
  `workflowId` (optional, "Workflow to search for recent failed executions when executionId
  is omitted"). Text:

```text
Diagnose a failed Rewst workflow execution.
Target: ${execution <executionId> | workflow <workflowId> | ask me which workflow or execution to look at}.
1. If no execution id is known, resolve the workflow with buddy_workflow_search and list recent failures with buddy_workflow_executions (status "failed").
2. Read the failure with buddy_execution_logs. If a failed task spawned a sub-workflow execution, drill into that execution id too.
3. Confirm the suspect expression or condition with buddy_render_jinja against the execution's real context before proposing a fix.
4. Report the root cause and the minimal fix. Only edit the workflow (buddy_workflow_edit) if I ask; after an approved edit, re-run with buddy_workflow_run and re-check the logs.
```

- `safe-workflow-edit` — description
  `Read, edit, and verify a Rewst workflow with the smallest set of changes.`; arguments
  `workflowId` (optional), `goal` (optional, "What the edit should accomplish"). Text:

```text
Edit a Rewst workflow safely.
Target: ${workflow <workflowId> | resolve the workflow by name with buddy_workflow_search}. Goal: ${<goal> | ask me}.
1. Read the workflow with buddy_workflow_get (summary detail is sufficient; edits resolve tasks by name).
2. Verify any assumption about live data with buddy_render_jinja against a recent execution before editing.
3. Apply the smallest set of buddy_workflow_edit operations that accomplishes the goal.
4. Re-read the workflow to confirm the change, then run it with buddy_workflow_run (this prompts for approval every time) and check the outcome; on failure use buddy_execution_logs and iterate.
```

- `compose-sub-workflow` — description
  `Extract a reusable sequence from a large workflow into a sub-workflow.`; arguments
  `workflowId` (optional). Text:

```text
Refactor a large Rewst workflow toward composition.
Target: ${workflow <workflowId> | resolve the workflow by name with buddy_workflow_search}.
1. Read it with buddy_workflow_get (summary) and identify extraction candidates. ${WORKFLOW_COMPOSITION_STEERING}
2. Create the sub-workflow (buddy_create_workflow), add its tasks with buddy_workflow_edit, and define its contract with set_inputs and set_output.
3. In the original workflow, replace the inlined tasks with one sub-workflow task (subWorkflowId set to the new workflow's id); the caller reads its result as RESULT.<task name>.
4. Verify: run the sub-workflow alone with buddy_workflow_run, then the parent; check failures with buddy_execution_logs.
```

**B4. Wire into `src/mcp/mcpServer.ts`.** In `buildMcpServer()` (line 41): construct the
server as
`new Server(SERVER_INFO, { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: buildMcpInstructions() })`;
import `ListPromptsRequestSchema`, `GetPromptRequestSchema` from
`@modelcontextprotocol/sdk/types.js`; add handlers:

```typescript
server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: MCP_PROMPTS }));

server.setRequestHandler(GetPromptRequestSchema, request => {
	const { description, text } = renderMcpPrompt(request.params.name, request.params.arguments);
	return { description, messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
});
```

An unknown prompt name throws out of `renderMcpPrompt`; the SDK surfaces it as a JSON-RPC
error (matches T3's rejection assertion — same pattern the resource handler uses at
mcpServer.ts:76-83). Optionally export `buildMcpInstructions` from `src/mcp/index.ts` for
symmetry.

Done-check: `npm run test:grep -- "Unit: mcpInstructions"` and
`npm run test:grep -- "Unit: mcpServer"` green.

**B5. Docs + changelog (commit 2 continued).**

- `docs/features.md`, section `### Rewst MCP tools` (line 103): after the oversized-results
  paragraph (line 127), add a short paragraph: the server now sends working-method guidance
  to MCP clients in the initialize handshake (same steering the in-editor chat uses), and
  exposes three recipe prompts — `debug-execution`, `safe-workflow-edit`,
  `compose-sub-workflow` — which VS Code surfaces as slash commands when the server is
  registered. User-facing language only; no internals.
- Changelog note per below. No `docs/reference.md` change (no new commands/settings), no
  README change required.

## Tricky sections (wrong vs required)

1. **Byte-identical fragment extraction.** Wrong: "improving" the description wording while
   extracting, or re-typing the `buddy_render_jinja` double-quoted literal as a template
   literal (its `'\\\\\\\\1'` escapes are easy to corrupt). Required: extraction changes the
   _source construction_ only; the runtime strings stay byte-identical, proven by
   `Unit: package manifest` and `workflowTools.test.ts:113`. If either fails, the extraction
   changed bytes — fix the code, never the mirror or the test.
2. **D2.6 is done — do not re-implement.** Wrong: adding new truncation inside
   `src/workflow/` runners or capability handlers because the epic bullet says "bound tool
   outputs". Required: nothing. Bounding is a boundary concern, already centralized in
   `formatMcpOutput` at `McpActions.ts:403/491`; chat rides the same `callTool` path. Adding
   inner caps would double-truncate and break the paging contract.
3. **Error-message stability in A3/A4.** Wrong: letting the generic produce a
   differently-worded message, or changing `'(unnamed)'`/name-preservation behavior.
   Required: `label: 'Template'` / `label: 'Org variable'` reproduce today's messages
   exactly; the five existing regex assertions (T4) are the proof. `requireOrgVariableInOrg`
   must keep returning the full row (update path reuses `name`/`category`/`cascade`).
4. **Prompt/instructions wording rules** (CLAUDE.md "AI Prompt Steering Directives"):
   neutral, descriptive, transport-focused. Never say the instructions
   "override"/"supersede" anything; never imply `detail:"full"` is needed for ordinary edit
   prep (the shared fragment says the opposite — that's the point); describe approval as a
   VS Code-hosted flow, not an error.
5. **MCP prompt arguments arrive unvalidated** — same rule as tool inputs: read every arg
   defensively in `renderMcpPrompt` (string-typed, trimmed non-empty, else treat as absent).
   Never blind-cast `request.params.arguments`.
6. **Runner assignment.** Wrong: adding `src/mcp/instructions.test.ts` to
   `vitest.suites.mjs` ("it looks pure") — its `@workflow` import graph reaches `vscode` via
   `@utils` logging. Required: extension-host mocha (auto-discovered, no registration). Only
   T1's additions live in vitest (file already registered).
7. **`args` deletion scope.** Wrong: also deleting `args` from `ToolSpec` (the type) or
   touching `withGeneratedArgs`. Required: only the dead literals in spec _definitions_ go;
   the generated `args` field remains the live contract (`buildToolInstructions`,
   `toolProtocol.ts:68`, reads it).
8. **Stale epic line numbers.** Every file:line in epic D2.4/D2.6/E1 bullets predates
   #130/#131; use the references in this spec (verified at HEAD `5cd5387`), not the epic's.

## Do NOT

- Do not fork the MCP instructions text from the chat steering — fragments are single-source
  (epic E1.2 requirement).
- Do not use XML-style authority wrappers, "override/supersede/ignore your system prompt"
  language, or refusal-as-error framing in any AI-facing text (CLAUDE.md steering rules).
- Do not edit `CHANGELOG.md` directly; do not put internals in the changelog note or user
  docs.
- Do not touch `assertScopeAllowed`, the approval flow, or `McpActions.callTool` sequencing
  (epic C2.5 guardrail applies here too).
- Do not refactor to the MCP SDK's `registerTool`/`registerPrompt` high-level API — keep the
  existing `setRequestHandler` pattern.
- Do not add Zod or begin C1/C2 work; do not rename or consolidate any tools (that's D3,
  even-minor gated).
- Do not mark the PR ready for review; do not commit to main.
- Do not run grep test labels without a pattern; never `vscode-test -- --grep`.
- Do not edit the existing T4 test assertions to make a refactor pass — a red T4 means the
  refactor changed behavior.

## Left to implementer discretion

Exact placement/order of the new helpers within `inputHelpers.ts`; whether
`buildMcpInstructions` is exported via `src/mcp/index.ts`; precise fallback phrasing inside
prompt texts when optional args are absent (keep the numbered tool sequences and quoted names
as specified); commit message wording; minor doc-paragraph phrasing.

## Changelog

`changelog.d/mcp-instructions-prompts.md` (exact contents):

```markdown
---
category: Added
---

- **MCP server instructions and recipe prompts** — external MCP clients now receive working-method guidance during the initialize handshake, plus three recipe prompts (`debug-execution`, `safe-workflow-edit`, `compose-sub-workflow`) that compatible clients, including VS Code, surface as slash commands.
```

(D2 residuals are internal-only and ride this note-carrying PR; no second note needed.)

## Acceptance criteria (run in order, all green)

1. `npm run lint`
2. `npm run type-check`
3. `npm run test:unit`
4. `npm run test:grep -- "Unit: mcpInstructions"`
5. `npm run test:grep -- "Unit: mcpServer"`
6. `npm run test:grep -- "Unit: templateMutateCapabilities"`
7. `npm run test:grep -- "Unit: orgVariableMutateCapabilities"`
8. `npm run test:grep -- "Unit: package manifest"` (required: workflow tool descriptions were
   reconstructed — must prove byte-identity)
9. `npm run changelog:check -- --base main --include-working-tree`
10. Integration suite not required (no live API behavior changed).

## Blocking questions

None.
