# Workflow editing API — findings

Empirical notes from probing the live Rewst GraphQL API (`scripts/probe-workflow.mjs`,
`scripts/wf-roundtrip.mjs`) against the sandbox "Learning Workflow"
(`019ecc4c-b826-70b0-a8c7-e87ff2377833`, org `01940973-8a88-7109-8ba7-d64bfbb18950`).

Purpose: capture the disparity between the GraphQL **schema** and what is **actually
required** to read/edit workflows, so we can bundle the logic into native chat tools
instead of many GraphQL round-trips.

## The workflow graph model

A workflow is a directed graph of **tasks** (nodes) connected by **transitions** (edges).

- **Task (node)** — `WorkflowTask`: `id`, `name`, `actionId` (+ `action { ref }`),
  `input` (JSON params for the action), `transitionMode` (`FOLLOW_ALL` | `FOLLOW_FIRST`),
  `publishResultAs`, `join`, `timeout`, `with { items, concurrency }` (loop/fan-out),
  `metadata` (JSON), `retry`, `isMocked`/`mockInput`, `runAsOrgId`, `securitySchema`.
- **Transition (edge)** — lives on each task's `next: [WorkflowTransition]`:
    - `do: [taskId]` — **the actual edge**: downstream task id(s) this transition runs.
    - `when` — condition (`{{ SUCCEEDED }}`, `{{ FAILED }}`, or a Jinja expression).
    - `publish` — `[{key, value}]` context-variable assignments applied on this edge.
    - `label` — human label on the edge.
    - `top`, `left`, `orientation`, `targetHandles` — visual layout offsets (often null).
    - `from`, `to` — **observed null in v1.0**; routing is via `do`, not from/to.

## Disparity 1 — `updateWorkflow` replaces the whole graph

`updateWorkflow(workflow: WorkflowInput!, ...)`. `WorkflowInput.tasks` is the full task
list. The mutation **replaces wholesale** — any task you omit is deleted; any transition
you omit from a task's `next` is removed. There is no partial/patch update of a single task.

**Consequence:** every edit must resend the entire workflow. Read all tasks first, mutate
in memory, send everything back. This is the core "nothing is lost" requirement.

Round-trip confirmed faithful: read → convert → `updateWorkflow` → re-read gives an
identical graph (11/11 tasks, all transitions and publishes preserved).

## Disparity 2 — optimistic-concurrency token (`openedAt`)

- `openedAt: String` must be the **exact** `updatedAt` value (epoch-ms string) read when
  you fetched the workflow. Mismatch → `"A newer version of this workflow exists."`
    - It is **not** a `>=` comparison: passing "now" (hours after the stored `updatedAt`)
      still fails. It is checked for equality against the current version.
    - After a successful save, `updatedAt` changes, so the next edit needs the new value.
- `overwrite: true` **alone fails** with `"You must provide a patch ID to overwrite"`
  (server `rebaseWorkflowToPatch`). The force path is `overwrite: true` +
  `overwritePatchId: <patch id>`. Prefer the `openedAt` path for normal edits.
- `createPatch: true` snapshots a patch into history (undo point). Use it on every edit.

**Edit recipe:** read `updatedAt` → build full `WorkflowInput` → `updateWorkflow(workflow,
openedAt: updatedAt, createPatch: true, comment)`. On conflict, re-read and retry (or
force with `overwrite: true` + latest `overwritePatchId` from `workflowPatches`).

## Disparity 3 — read shape ≠ write shape; two read shapes

- **Read (typed):** `workflow.tasks { ... action { ref } ... next { ... } }` — camelCase,
  `action` is an object with `ref`. **This is the shape to convert into `WorkflowInput`.**
- **Read (raw):** `workflow.tasksObject` — a map keyed by task id with **snake_case** keys
  (`transition_mode`, `publish_result_as`, `is_mocked`, `mock_input`, `run_as_org_id`,
  `pack_overrides`, `security_schema`) and `action` = the **ref string**. Do **not** feed
  `tasksObject` straight into `WorkflowInput`; the field names and `action` differ.
- **Write:** `WorkflowTaskInput` uses `actionId` (UUID), camelCase, and `next:
[WorkflowTransitionInput]`. No `action.ref` — reference actions by `actionId`.
- **`publish` has two encodings:** typed read → `[{key, value}]`; `tasksObject` → `[{key:
value}]`. `WorkflowTransitionInput.publish` accepts the `[{key, value}]` form (verified
  by faithful round-trip). Convert raw → `{key, value}` if you ever start from `tasksObject`.

Mapping read→input (per task): `id, name, actionId, description, input, metadata,
transitionMode, publishResultAs, join, timeout, humanSecondsSaved, isMocked, mockInput,
runAsOrgId, securitySchema, retry, with`, and `next[]` mapped to `WorkflowTransitionInput`
(`id, when, label, do, publish, top, left, orientation, targetHandles`).

## Disparity 4 — node positions live in `task.metadata.{x,y}` (free, un-snapped)

Node canvas positions are stored on each task as `metadata.x` / `metadata.y` (the
top-left anchor). They were `{}` on the first sandbox workflow only because it was
built programmatically and never arranged in the editor; a hand-laid-out workflow
shows e.g. `metadata: { x: 696, y: -912, clonedFromId: ... }`. Key points:

- Coordinates are **free floats** (e.g. `-95.8`, `807.7`) — the editor does **not**
  hard-snap to a grid, so layout tools must not snap either.
- Transition `top`/`left`/`orientation`/`targetHandles` are separate **edge-label**
  offsets, usually null; they are not node positions.
- `updateWorkflow` round-trips `metadata.{x,y}` faithfully (verified live), so the
  edit tool must resend every task's `metadata` unchanged or it loses the layout.

**Calibrated geometry** (measured from a hand-arranged workflow where nodes were
placed flush to expose their size): node **height ≈ 88px**; node **width ≈ 209 +
127 × (outgoing transition count)** (≈ 335 at one transition — each transition adds
an output port and widens the node). Used for spacing in `buddy_workflow_edit`
placement and `buddy_workflow_autolayout`.

**Layout algorithm** (`autoLayout` in `workflowTools.ts`, hand-rolled, dependency-free,
deterministic): break cycles by DFS (back-edge = edge to a node on the stack);
longest-path ranks on the remaining acyclic graph (one row per rank); a back-edge's
source is pulled to its target's rank so a retry loop stays compact (the loop node
sits on its target's row, not down with the exit tasks); within a rank, tasks are
ordered strictly by a transition-order pre-order walk; barycenter sweeps center
parents over children. A near-terminal "catch" node fed by **more than 2** actions
whose feeders span **≥ 5 ranks** (e.g. a global `failure_catch`) is lifted out of the
main ranking and placed in a **lane to the right**, centered on its feeders, so it
does not drag long edges across every rank (matches the guideline that a normal end
node has at most one feeder). Incremental `add_task` placement (not full autolayout)
puts a new task one row below the action it connects from.

## Disparity 5 — action search is Hasura-style; parameters are the input schema

- Search: `actionsForOrg(orgId: ID!, search: ActionSearch, limit, offset)`. `ActionSearch`
  fields are Hasura comparison expressions, e.g. `{ name: { _ilike: "%email%" },
deprecated: { _eq: false } }`. Operators on `string_comparison_exp`: `_eq, _neq, _like,
_ilike, _nlike, _nilike, _in, _nin, _substr, _gt/_gte/_lt/_lte`.
- Results are **noisy**: a managed org has thousands of pack actions, many with identical
  names. A useful tool must search name **and** ref **and** category, filter deprecated,
  dedupe, and rank `core.*` / common actions first.
- A task references its action by `actionId`; `action.ref` is the human id (`core.noop`).
- To fill a task's `input`, fetch the action's **`parameters`** (JSON):
  `action(where: { id }) { ref name description parameters(populateOptions:false)
outputSchema }`. `parameters` is an object keyed by param name with `{type, label,
default, description}` — this is the input schema the assistant fills.
- Related: `commonlyUsedIntegrationActions(integrationId, orgId)`,
  `searchInstalledPackActions(orgId, ...)`, `roboRewstyWorkflowDraftState(orgId,
workflowId) { revision draftHash }` (AI draft-state bookkeeping).

## Disparity 6 — task ids must be de-dashed hex (32 chars), or edges break

New tasks may be created with a client-supplied `id`. **The server strips dashes from
the task id but NOT from the `do` references that point at it.** Sending a task id of
`a38c17c9-89d6-49b0-b431-83b40fdda57c` stores the task as `a38c17c989d649b0b43183b40fdda57c`
while the transition's `do` keeps the dashed form → the edge no longer matches any task.

All existing task ids are 32-char hex with no dashes (`aa000001...`). **Generate new task
ids as `randomUUID().replace(/-/g, '')`** so the task id and every `do` reference agree.
(Transition `id`s, by contrast, are fine as dashed UUIDs.) Verified live: a de-dashed id
links cleanly; a dashed id does not.

## Disparity 7 — sub-workflow calls, workflow inputs, and data flow

These three trip up assistants constantly; verified live and encoded in the tools.

- **Calling a sub-workflow is not an action.** There is no `core.run_workflow`. A
  workflow exposes an action whose **id equals the workflow id** (`Workflow.action.id`
  == the workflow id, `ref` null). A sub-workflow call is a task whose `actionId` is
  the target workflow's id. `actionsForOrg` does **not** list workflows-as-actions, so
  searching for a "run workflow" action is a dead end — find the target via a workflow
  search and use its id. (`add_task` accepts `subWorkflowId` for this.)
- **Workflow inputs (the run/call form) are driven by `input` + the action's
  `parameters`, NOT `inputSchema`, and definitely not `varsSchema`.** The UI's
  `updateWorkflowParams` writes `input` (ordered names), `parameters` (the
  action-parameter form: `{name: {type, label, default, required, multiline,
description}}`), and `inputSchema` (a JSON-Schema mirror) together. Setting only
  `inputSchema` shows nothing in the UI (verified: a stale `inputSchema` entry never
  rendered while `input` + `action.parameters` did). `varsSchema` is a separate
  variables map (trigger/config vars) — putting inputs there is the classic mistake.
  `WorkflowInput.parameters` writes `Workflow.action.parameters`. Omitting
  `parameters`/`output` from `updateWorkflow` does **not** clear them (partial update
  for these fields, unlike `tasks` which is replaced wholesale). The `set_inputs`
  operation writes `input` + `parameters` + `inputSchema` together. **Input defaults
  are Jinja-expression strings** (`"{{ false }}"`, `"{{ 5 }}"`, `"{{ CTX.x }}"`) — a
  raw boolean/number default does not render in the UI, so `set_inputs` wraps raw
  scalars as `{{ value }}` and passes strings through.
- **`CTX` is callable in a live workflow.** Read a field as `{{ CTX.field }}`; dump the
  whole context with `{{ CTX() }}` (parentheses). Bare `{{ CTX }}` does not work at
  runtime (it is the function itself). Note `renderJinja` with an inline `vars` dict
  treats CTX as a plain object, so `{{ CTX }}` _appears_ to work there — prefer
  `{{ CTX() }}` to match real workflow behavior.
- **Data flow: branch on a task's output with `RESULT.<field>`** in that task's own
  outgoing transitions, or `CTX.<alias>.<field>` when the task sets
  `publishResultAs: <alias>`. A task's (or sub-workflow's) internally published
  variables are **not** in the parent's `CTX.<field>` — e.g. a sub-workflow that
  publishes `proceed` is read as `RESULT.proceed` / `CTX.<alias>.proceed`, never
  `CTX.proceed`.

## Task-creation conventions (enforced by `add_task` / the edit tool)

So the assistant produces well-behaved tasks rather than copying odd UI defaults:

- **Every saved task carries an explicit `transitionMode` and `join`.** Rewst's
  runtime default for an _unset_ `transitionMode` is `FOLLOW_ALL` (every matching
  transition fires in parallel) — which the assistant kept misreading as
  `FOLLOW_FIRST`, then branching on a task whose conditions all fire at once. Rather
  than rely on prompting to remind the model, the edit tool enforces the default in
  code (`ensureTaskDefaults`): it fills `FOLLOW_FIRST` + `join: 1` on any task missing
  them, fill-only so an intentional `FOLLOW_ALL` fan-out or an explicit `join` value is
  never clobbered. Since edits resend the whole workflow, every task's mode becomes
  explicit over time. The model only sets `transitionMode`/`join` for a non-default:
  `FOLLOW_ALL` for a parallel fan-out, or `join: 0` for a real join/merge that waits on
  multiple inbound paths. (`buddy_workflow_get` surfaces `transitionMode`/`join` only
  when they are a deliberate non-default, so it never re-introduces the noise.)
- **Every task ends up with at least one outgoing transition.** When nothing connects
  out of a task (a freshly added leaf, or a task left edgeless after a delete), the
  edit tool adds a terminal `{{ SUCCEEDED }}` transition with an empty `do` — the same
  shape Rewst uses for an end-of-branch task.
- **Custom-condition transitions are ordered before the `{{ SUCCEEDED }}` catch-all.**
  Under `FOLLOW_FIRST` the first transition whose condition holds wins, and
  `{{ SUCCEEDED }}` is truthy on any success — so a success transition listed first
  shadows every custom condition after it and that custom Jinja never evaluates. The
  edit tool and `autoLayout` stable-partition each task's `next[]` so custom conditions
  come first and the success (or blank/whitespace-only) catch-all sits last; relative
  order within each group is preserved. Because within-rank node placement follows
  transition order, custom branches also render left of the success branch.

## Native tools (implemented; replace many GraphQL turns with one call each)

All are in `src/ui/chat/tools/workflowTools.ts`, gated by the
`rewst-buddy.ai.tools` setting (the `workflows` capability); the two mutating tools reuse the
in-chat per-workflow mutation-approval flow. They require `workflowId`,
`workflowName`, `orgId`, `orgName` for approval — `buddy_workflow_get` surfaces all
four (including **`orgName`** via `organization { name }`) so the assistant passes
real names, not ids.

1. **`buddy_workflow_get`** `{ workflowId, orgId, detail? }` → normalized graph: workflow
   (id, name, orgId, orgName, **inputs** from `action.parameters`), nodes (name, action ref,
   input, publishResultAs, non-default transitionMode/join, loop `with`), edges (`from`, `when`,
   `label`, `to[]` task names, `publish`). One call instead of schema-introspect + query + reshape.
   **`detail` defaults to `"summary"` — a concise ANALYSIS view that omits the edit/layout plumbing
   (task ids, transition ids, canvas `x/y`, version token) and refers to tasks/edges by name**, which
   is what `buddy_workflow_edit` ops use, so you can edit straight from it. `detail:"full"` adds task
   ids, transition ids, and positions — needed only to reposition a task or target one specific
   transition by id. The concise view is the default because the plumbing is pure noise for "what
   does this workflow do" analysis and the edit path resolves tasks by name + handles ids/version
   internally.
2. **`buddy_action_search`** `{ orgId, query, limit, includeDeprecated }` → ranked,
   deduped action matches (ref, id, category); describe mode `{ orgId, ref|actionId }`
   → `parameters` + `outputSchema` so the assistant can fill task `input` correctly.
   A "run/call workflow" query short-circuits to the sub-workflow guidance.
3. **`buddy_workflow_edit`** `{ workflowId, workflowName, orgId, orgName, operations[] }`
   → fetches full state, applies high-level ops (`add_task` [supports `subWorkflowId`],
   `update_task`, `delete_task`, `connect`, `disconnect`, `set_transition`, `reposition`,
   `set_inputs`) in memory, sends the **complete** `WorkflowInput` with correct
   `openedAt` + `createPatch`, retrying once on a version conflict. Nothing-lost,
   id-normalization, action-ref resolution, sub-workflow calls, input definitions
   (`set_inputs` writes `input` + `parameters` + `inputSchema`), and conflict handling
   are native.
4. **`buddy_workflow_autolayout`** `{ workflowId, workflowName, orgId, orgName }` →
   re-arranges every node with the layered algorithm above (strict transition order,
   loop nodes kept compact, terminal catches sent to a right lane) and saves.
5. **`buddy_render_jinja`** `{ orgId, template, executionId? | vars?, contextIndex? }` →
   renders a Jinja template via the `renderJinja` mutation against a real execution's
   context (fetched server-side from `workflowExecutionContexts`, so the large context
   never enters the chat) and returns only the result. Lets the assistant **confirm a
   condition/expression before editing** — `renderJinja`'s `vars` IS the `CTX` namespace,
   and the execution-contexts query returns an array of snapshots (the last is the most
   complete). This is the fix for the recurring failure mode where the assistant guesses
   a Jinja change (boolean vs `'true'`, `CTX.x` vs `CTX.<alias>.x`) and ships it wrong.
6. **`buddy_workflow_run`** `{ workflowId, workflowName, orgId, orgName, input?, wait? }` →
   triggers a run via the `testWorkflow` mutation (`testWorkflow(id, orgId, input) { executionId }`).
   By default it **waits** for the run to reach a terminal state (polling
   `workflowExecutions(where: { id })` until status leaves running/queued/pending) and reports the
   outcome; on failure it auto-fetches the failing task's log so the cause comes back in one call.
   `wait: false` returns immediately with just the `executionId`. Approval-gated per workflow.
7. **`buddy_workflow_executions`** `{ workflowId, orgId, status?, limit? }` → lists recent
   executions newest-first via `workflowExecutions(where: { workflowId, orgId, status }, order:
[["createdAt","desc"]])`. `status` is a lowercase string (`"failed"`, `"succeeded"`,
   `"running"`); results come back oldest-first without the explicit `order`, so it always
   requests `createdAt desc`. Pairs with `buddy_execution_logs` / `buddy_render_jinja` to debug.
8. **`buddy_execution_logs`** `{ executionId, failedOnly?, includeResult? }` → per-task logs for
   one execution via `taskLogs(where: { workflowExecutionId }, order: [["createdAt","ASC"]])`
   (note the field is **`originalWorkflowTaskName`**, the arg is **`order`** not `orderBy`, and
   pagination is `limit`/`offset` not `take`). Returns each task's status, and for failed tasks
   the `message`, the `input` it received, and the `result` it produced (truncated). This is the
   "**why did it fail**" tool — it replaces the agent hand-writing `taskLogs` GraphQL and
   rediscovering those field names every time. A failed task's `input` shows exactly what it got
   (an empty-string id ⇒ the caller passed nothing); its `result` shows the real output shape.
9. **`buddy_workflow_search`** `{ query?, orgId?, refresh?, limit? }` → resolve a workflow by name
   instead of guessing its id. On first call it builds a **session-lived cache** from a single
   **un-scoped** workflows query, paginated:
   `workflows(limit, offset, order:[["name","asc"]]) { id name orgId organization { id name } }`.
   Key finding: with **no `where`/orgId**, this returns workflows across the **entire accessible
   hierarchy — managed orgs AND sub-orgs**, each carrying its `organization { name }`. Per-org
   enumeration (`user { managedOrgs }` then `workflows(where:{orgId})`) is **wrong**: `managedOrgs`
   does **not** list sub-orgs the session can still read (verified live — Jon's Sandbox is reachable
   yet absent from `managedOrgs`), so it silently drops them. The un-scoped query catches everything
   and needs no separate org-name lookup. **Matching is tokenized and forgiving:** lowercase, strip
   punctuation to spaces, and require every query word to appear (as a substring, any order) — so
   `jon sandbox` finds `Jon's Sandbox` and `lock workflow` finds `[RAVEN] Workflow Lock`. Hits are
   split: **name/id matches** are listed (exact-name first), while workflows that match only because
   their **org name** matched (e.g. `jon's sandbox` → every workflow in the "Jon's Sandbox" org) are
   **summarized, not listed** (`Org (count; orgId …)`), so an org-name query can't flood the result
   — pass that orgId to list them. Returns each hit's **name, id, and org name (+ org id)**. The
   cache is built lazily on the first search (never at startup) and reused until `refresh: true`.
   This replaces the "guess an id and fail" loop; "list the workflows" is this tool, not raw GraphQL
   or the native `listWorkflow`.

## Troubleshooting knowledge (baked into tool prompts)

- **`renderJinja` runs against the STORED context snapshot, which is the `CTX` namespace only.**
  The live runtime objects `WORKFLOW`, `ORG`, `USER`, `RESULT` do **not** exist there, so
  `{{ WORKFLOW.id }}` / `{{ WORKFLOW.execution_id }}` render empty in `buddy_render_jinja`. Their
  CTX equivalents: execution id = `CTX.execution_id`, org id = `CTX.organization.id`, and the
  running workflow's own id = `CTX.trigger_instance.trigger.workflow_id`. (Even `WORKFLOW.workflow_id`
  does not exist at runtime — Rewst's docs only list `WORKFLOW.org_id`, `WORKFLOW.name`,
  `WORKFLOW.timeout`, `WORKFLOW.type`.) `buddy_render_jinja` with `keys: true` dumps the context's
  top-level keys so the agent discovers what's available instead of guessing field paths.
- **Read a task's `result` before assuming a wrapper key.** Some actions (e.g.
  `rewst.generic_graph_request`) return the list/value **directly**, not wrapped in
  `{ <fieldName>: [...] }`. `buddy_execution_logs` shows the real shape.
- **A default referenced in a publish/transition expression isn't in `CTX` until it's set.** A
  required input with a UI default (`5`) is still missing from `CTX` while an upstream transition
  runs, so `CTX.ignore_threshhold_minutes | int` is `0` there — add the same `| d(5)` in the
  expression, not just on the input.
