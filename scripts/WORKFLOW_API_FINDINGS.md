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
an output port and widens the node). Used for spacing in `rewst_workflow_edit`
placement and `rewst_workflow_autolayout`.

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

## Native tools (implemented; replace many GraphQL turns with one call each)

All four are in `src/ui/chat/tools/workflowTools.ts`, gated by the
`rewst-buddy.ai.enableWorkflowTools` setting; the two mutating tools reuse the
in-chat per-workflow mutation-approval flow. They require `workflowId`,
`workflowName`, `orgId`, `orgName` for approval — `rewst_workflow_get` surfaces all
four (including **`orgName`** via `organization { name }`) so the assistant passes
real names, not ids.

1. **`rewst_workflow_get`** `{ workflowId, orgId }` → normalized graph: workflow
   (id, name, orgId, orgName, version token), nodes (id, name, action ref, input,
   position), edges (`from`, when, label, `to[]` task names, publish). One call
   instead of schema-introspect + query + reshape.
2. **`rewst_action_search`** `{ orgId, query, limit, includeDeprecated }` → ranked,
   deduped action matches (ref, id, category); describe mode `{ orgId, ref|actionId }`
   → `parameters` + `outputSchema` so the assistant can fill task `input` correctly.
3. **`rewst_workflow_edit`** `{ workflowId, workflowName, orgId, orgName, operations[] }`
   → fetches full state, applies high-level ops (`add_task`, `update_task`,
   `delete_task`, `connect`, `disconnect`, `set_transition`, `reposition`) in memory,
   sends the **complete** `WorkflowInput` with correct `openedAt` + `createPatch`,
   retrying once on a version conflict. Nothing-lost, id-normalization, action-ref
   resolution, and conflict handling are native.
4. **`rewst_workflow_autolayout`** `{ workflowId, workflowName, orgId, orgName }` →
   re-arranges every node with the layered algorithm above (strict transition order,
   loop nodes kept compact, terminal catches sent to a right lane) and saves.
