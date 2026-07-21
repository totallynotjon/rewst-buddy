# Changelog

## [1.0.0] - 2026-07-21

Rewst Buddy's first stable release. Local template editing and sync now pair with an experimental MCP server that gives AI assistants — in Cage-Free Rewsty chat and in external clients — broad read access to your Rewst environment and approval-gated, org-scoped writes.

### Added

- **MCP server (experimental)** — Rewst Buddy can now expose your authenticated Rewst sessions to external MCP clients (Claude Desktop, Claude Code, Cursor) over local HTTP. Off by default behind `rewst-buddy.mcp.enable` and read-only at the boundary; new commands register it in VS Code or copy a config for external clients. (#58)
- **MCP guardrails** — every external tool call is audit-logged to the Rewst Buddy output channel as one `[MCP audit]` line (tool, org, outcome, duration — never argument values or secrets) (#64); a new **Rotate MCP Token** command revokes access by minting a fresh endpoint token (#65); and the server sends working-method guidance to clients on connect, plus `debug-execution`, `safe-workflow-edit`, and `compose-sub-workflow` recipe prompts. (#136)
- **Working scope: pin which orgs (and workflows) Rewst tools may touch.** Set it from the status bar or _Set Working Scope_; writes — in chat and over MCP — stay within it and are blocked until you pin an org or list one in `alwaysAllowedOrgs`, with reads scoped too under strict mode. Approval prompts and the status bar show workflow names instead of raw ids. (#87, #167)
- **Read tools across the Rewst object model** — read-only MCP tools list and search organizations, users, roles, masked org variables, templates, installed pack actions, integration packs and OAuth setup status, App Platform pages and sites, triggers, forms, tags, and trigger activation instances, plus a batch trigger health check (`buddy_get_trigger_error_status`), name-to-id resolution (`buddy_resolve_reference`), and the global Jinja filter catalog.
- **Execution and history reads** — list a workflow's recent executions, fetch the latest run or aggregate status counts, list its tasks, find executions by input/output/context variable (`buddy_find_executions_by_variable`), and browse its patch history with attribution (`buddy_list_workflow_patches` / `buddy_get_workflow_patch`). (#155, #167)
- **Workflow write tools (experimental)** — when write tools are enabled, external MCP clients can create, edit, auto-layout, run, and delete Rewst workflows (`buddy_create_workflow`, `buddy_workflow_edit`, `buddy_workflow_autolayout`, `buddy_workflow_run`, `buddy_delete_workflow`). Structural edits re-arrange the canvas automatically, every write is org-scoped and re-verified against the target org, and each change requires a per-workflow approval inside VS Code — an external client can never approve its own write. (#68, #80, #163, #167)
- **One-call failure diagnosis** — `buddy_workflow_diagnose` composes a failed execution's root-cause task, its transition path, any sub-workflow it spawned, and its render context into a single digest; `buddy_execution_logs` marks tasks that spawned sub-workflow executions and, with `includeSubExecutions` and `depth`, inlines the child runs' task logs. (#126, #167)
- **Workflow quality and discovery tools** — `buddy_workflow_lint` audits a workflow's structure (unreachable tasks, shadowed or missing default transitions, missing retry/timeout, enabled mock input) without editing it; `buddy_workflow_impact` lists the workflows that would break before a sub-workflow or pack action change; and `buddy_search_crates` finds prebuilt Rewst Crates with per-org install status, so agents reuse instead of rebuilding.
- **Sub-workflow composition** — `buddy_workflow_edit` gains a `set_output` operation for defining the values a workflow returns to its caller (shown by `buddy_workflow_get`), and **workflow input profiles** save named payloads for repeatable `buddy_workflow_run` test runs without retyping JSON. (#120)
- **Trigger management** — read a trigger in full (`buddy_get_trigger`: tags, activation orgs, clone overrides, criteria, parameters), safely edit its tags (`buddy_set_trigger_tags`), set its org activation and auto-activate flag without disturbing clone overrides (`buddy_set_trigger_activation`), and turn it on or off (`buddy_set_trigger_enabled`). Each edit creates a revertable patch and reports a before/after diff. (#80, #184, #186)
- **Template tools over MCP** — `buddy_template_sync_status` and `buddy_template_sync` drive the link-and-sync workflow, stopping on a conflict instead of overwriting (#21); `buddy_template_link`, `buddy_template_unlink`, `buddy_template_sync_on_save`, and `buddy_template_link_status` manage local file ↔ template links without touching Rewst (#85, #92); write tools create, update, rename, and delete templates behind per-change approvals (#80); and `buddy_template_bundle_clone` deep-copies a template and everything it references into a target org behind one approval, rolling back on failure (#85).
- **Org variable and tag write tools (experimental)** — when write tools are enabled, external MCP clients can create, update, and delete Rewst configuration variables and tags, each org-scoped and gated by a per-change approval inside VS Code. (#80)
- **MCP GraphQL primitives (experimental)** — schema introspection (`buddy_graphql_schema`) and read-only queries (`buddy_graphql_query`) when GraphQL tools are enabled, plus a write tool (`buddy_graphql_mutate`) that requires `rewst-buddy.mcp.enableDangerousGraphqlMutation` and a per-resource approval inside VS Code before any mutation runs. (#60)
- **Crate Installer** — browse the Crate catalog and install a Crate into an org with the new `Install Crate` command, through a guided wizard built from the crate's own configuration options. Triggers install disabled by default so nothing fires until you review them. (#166)
- **Conflicts now show a diff against the current Rewst version.** Resolve with Keep Local / Take Remote buttons on the diff's own toolbar or the accompanying notification. A new "Diff Against Rewst" command compares any linked file against Rewst any time.
- **Jinja IntelliSense for linked files** — autocomplete and hover docs for Rewst's built-in Jinja filters, template-name completion inside `template("...")` calls, and basic keyword highlighting for Rewst's Jinja dialect. A companion `buddy_get_jinja_filter_docs` tool serves the same filter documentation to assistants. (#93)
- **Live Jinja preview** — preview how the active linked template renders against a real workflow execution's context, updating as you type, via "Preview Jinja Render" (`Ctrl+Shift+Enter` / `Cmd+Shift+Enter`). Opens as native editor panes with a "Pick Jinja Preview Context" command for layering manual variable overrides on top of the execution's context. (#153)
- **Large AI tool results** — oversized tool output is cached in memory and returned as a preview plus a result id, so assistants page or search the full result with `buddy_result_read` instead of rerunning. Cache size: `rewst-buddy.ai.toolResultCacheLimitMB` (default 500 MB). (#48, #70)
- **Configurable tool-call cap** — `rewst-buddy.ai.maxBuddyToolRounds` sets how many in-process Buddy tool calls Cage-Free Rewsty may run in one answer (1–100, default 8), so long investigations can raise the limit. (#99)
- **Remove a single session** — previously "Clear Sessions" was all-or-nothing. A new "Remove Session" command (also available by right-clicking a session in the Sessions view) removes one session without touching the others. (#111)
- **Nightly pre-release channel** — every merge to `main` now publishes a pre-release build to the VS Code Marketplace. Opt in via the extension's "Switch to Pre-Release Version" button in the Extensions panel to ride the latest changes ahead of stable releases. (#66)

### Changed

- **Chat and MCP tools share one definition** — Cage-Free Rewsty's chat tools and the MCP server's tools now come from a single capability registry, so workflow, GraphQL, and MCP tool routing stay aligned between chat and external clients instead of drifting. (#61)
- **MCP exposure now uses three settings** — `rewst-buddy.mcp.enable` exposes read capabilities, `rewst-buddy.mcp.enableWriteTools` exposes workflow writes, and `rewst-buddy.mcp.enableDangerousGraphqlMutation` separately exposes raw GraphQL mutation. The old MCP family checklist (`rewst-buddy.ai.tools`) and the per-tool allowlist (`rewst-buddy.mcp.enabledTools`) were both removed.
- **Rewst tools moved to MCP-only** — Rewst Buddy no longer contributes its `buddy_*`, `list_template_links`, approval, or cached-result reader tools as VS Code language-model tools. Rewst capabilities are now exposed through the MCP server, while VS Code's built-in chat tools continue to work in Cage-Free Rewsty chat.
- **Buddy tool names are simpler** — duplicate template, Jinja filter, action, and execution tools now use canonical replacements.
- **Linked-template discovery is a bounded search** — `buddy_search_template_links` returns a filtered list (search by path, template name, id, or org) instead of dumping every linked file. (#92)
- **MCP write approval message** — when a write tool returns "approval required," the message now explains that the prompt appears in the VS Code window running Rewst Buddy (and won't surface in the external MCP client), rather than implying a modal pops up wherever the client runs. (#80)
- **Workflow tool guidance** — `buddy_workflow_edit` now documents transition first-match order, publishing on failure edges, `with.items` loops (`item()` and collected results), the full `update_task` field list, and recommends sub-workflow composition for large workflows. (#120)
- **Workflow lint suggests a self-defaulting Jinja counter for manual retry loops** — the `task-retry-configured` finding shows the `CTX.retry|d|int` idiom so you don't need an extra task to initialize the counter before the loop starts. (#184)
- **Cage-Free Rewsty keeps its todo list current and finishes it** — the assistant now marks each todo in progress when it starts and completed the moment it finishes, drives the list to completion, and reconciles against recorded todo state before declaring a task done.
- **Expanded test coverage** — broad unit coverage added across utilities, UI, MCP, and sessions. (#179)

### Removed

- **Buddy tool aliases removed** — deprecated template, Jinja filter, action, and workflow-execution tool names now require their canonical replacements.
- Removed the `web_search` AI tool from Cage-Free Rewsty.

### Fixed

- **Workflow action edits no longer corrupt or drop a task's settings** — editing a task through `buddy_workflow_edit` now preserves every advanced setting (integration override, retry, timeout, run-as org, mock, loop `with`, and the rest) instead of reverting it, and the workflow graph view shows a task's integration override. (#83)
- **No more silent input loss** — after a workflow edit, the tool re-reads the saved workflow and warns when the server dropped or coerced task inputs it had accepted; previously such edits reported plain success while data quietly went missing. (#120)
- **Creating a task with a specific pack config selection now sticks on the first try** — Rewst's API silently defaults `configSelectionMode`/`configFallbackMode` on a newly created task, honoring them only on a follow-up update; `buddy_workflow_edit` now detects that and auto-corrects it, instead of requiring a manual second edit. (#174)
- **Workflow tooling reliability** — advanced task fields, mocking, workflow search, run timeouts, and Jinja diagnostics now surface clearly instead of being silently lost or misleading; workflow edits prompt consistently, mock data must use the `mock_result` wrapper, and workflow diagnose shows the executed path. (#126, #150)
- **`buddy_list_workflows` works again** — listing an organization's workflows over MCP no longer fails; the tool now returns your workflows reliably.
- **Sub-workflow executions** — `buddy_workflow_executions` now surfaces runs of workflows that are only ever called as sub-workflows; pass `rootOnly:false` to search by workflow id across the invoking orgs. (#98)
- **Execution diagnostics across accounts and managed orgs** — `buddy_execution_logs` and `buddy_workflow_diagnose` now resolve an execution's owner from its id across every signed-in session, so runs owned by another account or a managed child org no longer come back empty; an optional `orgId` targets the right account directly, and workflow definitions are still fetched from the workflow's owning org. (#120)
- **`buddy_execution_logs` now nests like `buddy_workflow_diagnose`** — combining `includeSubExecutions` with `depth` inlines full task logs at every requested nesting level, not just the first; `buddy_workflow_diagnose`'s nested drill-down sections now show a sub-execution's complete task log instead of only its failing task. (#171)
- **Accurate Jinja test context** — `buddy_render_jinja` now sees the full execution context during tests, so earlier variables and run inputs are available. (#120)
- **`buddy_template_sync` downloads are now reliable under load** — concurrent downloads no longer race each other's save and mostly fail; a download is now retried and, if it still can't save, the local file is left exactly as it was instead of silently reporting a false "in-sync" status. (#171)
- **Safer template syncing** — sync-on-save, auto-fetch, and interactive sync now verify the remote template belongs to the expected organization before changing anything; auto-fetch only downloads when the remote timestamp is provably newer; and metadata-only timestamp drift no longer blocks safe local uploads when the remote body is unchanged.
- **Sub-org template links keep their real org** — syncing a template that lives in a sub-organization no longer relabels its link with your main org, so link tools, "Open in Rewst", and sync point at the correct sub-org. Mislabeled links self-correct on their next sync, and MCP link/search/sync tools report the template's actual organization. (#96)
- **Re-linking a file no longer returns stale results** — pointing a file at a different template or org now clears the old lookup entry, so hover, ctrl-click, and open-by-template no longer resolve to the previously linked file. (#92)
- **Renaming a template now updates the status bar and tree view immediately** — `buddy_rename_template` previously left the locally cached template name stale until the next sync or reload; it now refreshes the local link cache right away. (#176)
- **Template linking handles missing org details** — linking no longer crashes when Rewst omits a template's organization relation.
- **Jinja Live Preview now renders immediately, even before picking an execution context** — it previously blocked on a context pick before showing anything; it now renders right away using empty/override-only variables, per Jinja's normal undefined-variable handling. (#173)
- **Session and org resolution across managed orgs** — sessions now index the union of directly managed orgs and the sub-org tree (an earlier scoping fix accidentally replaced one list with the other), opening or linking a template finds the session that manages a sub-organization, and org lookups refresh a stale session or fall through to another valid one instead of failing.
- **Session restore is more reliable** — Rewst Buddy now stores credentials per signed-in user and avoids startup races when several session consumers load at once.
- **Expired sessions now prompt once** — Rewst Buddy stops repeating cookie-refresh errors, marks dead sessions expired, and offers a Re-authenticate action.
- **Delete operations, and raw GraphQL mutations, now always prompt for approval** — approving a rename or update could previously pre-approve a later delete, or a raw mutation reusing the same scope, with no further prompt. (#177)
- Fixed working-scope approval modal visibility, redundant workflow success fallbacks, and workflow run approvals so test/run prompts every time.
- **Cage-Free Rewsty now keeps its Rewst tools** — when the MCP server is on, Rewst tools are advertised and run directly in chat, so they survive VS Code's 128-tool-per-request cap instead of being dropped and mis-called when many other tools are enabled. (#88)
- **Cage-Free Rewsty keeps Buddy tools available without the MCP server** — the in-chat Buddy tools no longer require enabling the external MCP endpoint; write tools still follow the existing write-tool gates.
- **Buddy tools stay preferred in chat** — Cage-Free Rewsty now reliably routes Rewst actions through Buddy tools, so chat answers and workflow edits run on the local, approval-gated path, and repeated workflow searches return results matched to each request. (#106)
- **Workflow AI steering** — keep workflow listing, reading, editing, running, and debugging on the dedicated workflow tools when GraphQL is also enabled, and steer workflow reads to the concise summary view by default, reserving the full (ids/positions) view for edits that specifically need task ids, transition ids, or canvas positions. (#47)
- **Chat no longer forwards raw terminal scrollback as if it were instructions** — terminal tool output is now capped much tighter and clearly marked as likely-unrelated context, instead of being sent to the assistant verbatim and sometimes mistaken for the actual request. (#168)
- **The chat assistant retries much harder before giving up when the backend keeps requesting a server-side tool by mistake** — it previously surfaced a "stopped" message after a single correction attempt; it now escalates through many attempts, so the stop message should now rarely, if ever, appear. (#175)
- **Rewst Buddy read tools** now return clearer errors for malformed arguments.
- Toggling the MCP write or dangerous-mutation switches now changes the advertised MCP server version, so VS Code reconnects to the in-editor MCP server and refreshes its tool list instead of holding the stale set until the window is reloaded.
- **Production hardening** — hardened filename sanitization, cookie parsing, WebSocket URL construction, Jinja/template pattern matching, markdown fence parsing, and MCP org scoping. (#179)

### Security

- **"Clear Sessions" now actually deletes stored credentials** — previously it only cleared the in-memory session list; saved cookies, the known-profile cache, and the Sessions tree could all still show or restore a "cleared" session. Clearing now removes every stored cookie (including managed-org keys) and the known-profile cache.
- **Local server now enforces loopback-only access** — the credential server refuses to bind a non-localhost host, and rejects any session or template-open request whose remote address, `Host`, or browser `Origin` isn't local, instead of using wildcard CORS.

## [0.44.1] - 2026-06-18

### Changed

- **Chat continuity survives a window reload** - the conversation map that lets a chat reuse one warm backend conversation (instead of re-shipping its whole transcript plus the engineering directive every turn) was in-memory only, so reloading the window forced every existing chat to downgrade to a stateless, full-transcript turn. It is now persisted to workspace storage (debounced, fire-and-forget) and restored on activation; stale server-side conversations still fall back cleanly through the existing error→downgrade path. (#38)
- **Workspace overview is no longer re-scanned every turn** - the first-message workspace overview (a `readDirectory` scan) was rebuilt before every backend call; it is now cached, removing a filesystem round-trip from the front of each turn. Freshness is event-driven — the cache is invalidated when a top-level workspace file is created/removed/renamed, when the linked-template set changes, or when workspace folders change — with a TTL backstop for changes no event reports, and overlapping turns share a single in-flight scan.
- **Prompt assembly is memoized** - the engineering directive, native-tool reminder, and tool-instruction text are pure functions of the permitted-tool set but were rebuilt (heavy string assembly) every turn; they are now cached per tool set, which is stable across a chat.

## [0.44.0] - 2026-06-17

### Added

- **Workflow tools for Cage-Free Rewsty** (`workflows` in `rewst-buddy.ai.tools`, off by default) — purpose-built tools that let the assistant understand and edit Rewst workflows in single calls instead of many rounds of raw GraphQL:
    - `buddy_workflow_get` reads a workflow as a normalized **node/edge graph** (tasks with their action ref and input; transitions with their condition, label, target tasks, and published context variables) and surfaces the workflow and org **names** the edit tools need. By default it returns a concise **analysis view** that omits edit/layout plumbing — task ids, transition ids, canvas x/y positions, and the version token — and refers to tasks/edges by name, so the assistant can understand a workflow with far fewer tokens (and still edit from it, since edits resolve tasks by name); pass `detail: "full"` to include those ids and positions when repositioning a task or targeting a specific transition by id.
    - `buddy_workflow_search` resolves a workflow by name across **every org the session can access — managed orgs and sub-orgs alike** — instead of guessing an id or paging through GraphQL: on first use it builds and caches a session-lived index of all workflows (name, id, org id, **org name**) from one paginated cross-org query, then answers this and later searches from the cache. Matching is forgiving — it ignores case, punctuation, and word order and requires every word, so `jon sandbox` finds `Jon's Sandbox` and `lock workflow` finds `[RAVEN] Workflow Lock`. Name/id matches are listed (exact-name first); workflows that match only because their **org** name matched are summarized separately (with the org id to scope to) so an org-name query can't flood the results. `orgId` scopes, `refresh: true` rebuilds, and every result includes the org name.
    - `buddy_action_search` finds actions for an org (ranking `core`/common actions first and deduping) and, in describe mode, returns an action's input **parameters** and output schema.
    - `buddy_workflow_edit` applies high-level **operations** — `add_task` (incl. `subWorkflowId` to call another workflow), `update_task`, `delete_task`, `connect`, `disconnect`, `set_transition`, `reposition`, and `set_inputs` (define the workflow's run/call inputs) — by reading the current workflow, applying the operations to the whole graph, and saving it back. The tool resends the entire workflow (the API replaces rather than merges, so nothing is dropped), checks the version to avoid clobbering a concurrent change and retries once on conflict, generates valid de-dashed task ids, resolves action refs to ids, auto-places new tasks below the action they connect from, and records a reversible patch on every save. It encodes the Rewst conventions assistants usually get wrong: a sub-workflow call is a task whose action is the target workflow's id (there is no run-workflow action); workflow inputs are written to the input list plus the action parameters that drive the UI form (not `varsSchema`); and a task's result is read via `RESULT.<field>` / `CTX.<publishResultAs>.<field>`.
    - `buddy_workflow_autolayout` re-arranges a whole workflow into a clean top-down layered layout: one row per rank, children ordered left-to-right by transition order, retry loops kept compact, and a global failure-catch (a terminal node fed by many steps across the flow) moved into a lane to the right instead of being pinned to the bottom with edges crossing the whole canvas.
    - `buddy_workflow_get` surfaces the workflow's run/call inputs (from the action parameters) and org name; `buddy_workflow_edit` gained `set_inputs` (define inputs the way the UI does) and `subWorkflowId` (call another workflow); a new `buddy_render_jinja` tool renders a Jinja template against a real execution's context server-side and returns only the result, so the assistant can confirm a condition or expression evaluates correctly before editing rather than guessing; and a new `buddy_workflow_run` tool triggers a workflow run (via `testWorkflow`) and returns the execution id to inspect, approval-gated per workflow; and `buddy_workflow_executions` lists a workflow's recent runs (newest first, filterable by status such as `failed`) so the assistant can find a failed run and render its context to debug it.
    - `buddy_workflow_edit` enforces safe task defaults in code rather than relying on Rewst's runtime defaults: every saved task gets an explicit `transitionMode` (`FOLLOW_FIRST`) and `join` (`1`) wherever they are unset — Rewst otherwise treats an unset `transitionMode` as `FOLLOW_ALL` (every matching transition fires in parallel), which is rarely intended and which the assistant repeatedly misjudged. The fill is non-destructive: a deliberate `FOLLOW_ALL` fan-out or an explicit `join` (e.g. `0` for a join/merge) is preserved. Every task is also guaranteed at least one outgoing transition (a terminal `{{ SUCCEEDED }}` when nothing connects out), and each task's transitions are ordered so custom conditions come before the `{{ SUCCEEDED }}` success catch-all — under `FOLLOW_FIRST` a success transition placed first would shadow every custom condition after it, so the custom Jinja would never evaluate.
    - `buddy_execution_logs` reports one execution's per-task logs — each task's status, and for failed tasks the message, the input it received, and the result it produced — the fastest way to see **why** a run failed without hand-writing `taskLogs` GraphQL or reading the whole context.
    - `buddy_workflow_run` now **waits** for the run to finish by default and reports the outcome, automatically including the failing task's log on failure (so a test is one call, not a run-then-poll-then-inspect loop); pass `wait: false` for the old fire-and-return behavior. `buddy_render_jinja` gained a `keys: true` mode that lists the context's top-level keys, and its guidance now spells out that it renders against the stored `CTX` snapshot only (the live `WORKFLOW`/`ORG`/`USER`/`RESULT` objects don't exist there — use `CTX.execution_id`, `CTX.organization.id`, `CTX.trigger_instance.trigger.workflow_id`).
    - Reads run directly; edits, auto-layout, and runs require the same inline chat confirmation (Continue / Cancel) as a GraphQL mutation, showing what will change, with approval remembered per workflow for the session.

### Changed

- **The extension's AI tools are renamed off the `rewst_` prefix to `buddy_`** (`buddy_workflow_get`, `buddy_workflow_edit`, `buddy_action_search`, `buddy_render_jinja`, `buddy_execution_logs`, `buddy_graphql`, `buddy_graphql_schema`, …). Sharing the `rewst` brand with the assistant's built-in native platform tools (`listWorkflow`, `renderJinja`, `gitbook_retriever`, …) caused it to occasionally invoke a native tool by mistake; a distinct prefix structurally separates "the editor's tools" from "Rewst's native tools." The chat `#`-reference names move from `rewst*` to `buddy*` (e.g. `#buddyWorkflowGet`) to match.
- **The assistant prefers the purpose-built workflow tools first.** The chat steering now ranks the `buddy_workflow_*` / `buddy_execution_logs` / `buddy_render_jinja` tools above raw `buddy_graphql`, which in turn ranks above the native platform wrappers — so workflow building and debugging uses the dedicated tools instead of sporadically falling back to raw GraphQL at the start of a chat.
- **Consolidated the AI tool settings into one checklist.** The separate `rewst-buddy.ai.enableWorkspaceTools`, `enableWebTools`, `enableGraphqlTool`, and `enableWorkflowTools` booleans (and the long-dead `maxToolRounds`) are replaced by a single `rewst-buddy.ai.tools` setting — an array rendered as checkboxes for `workspace`, `web`, `graphql`, and `workflows` (only `workspace` checked by default). The old settings are removed, not migrated (pre-release).

## [0.43.6] - 2026-06-16

### Added

- **Context-usage status bar indicator** - the Rewst backend reports real context-window usage mid-turn, but VS Code's native "Context Window" gauge can't be driven by a third-party model provider (its response stream has no usage channel — see [microsoft/vscode#309207](https://github.com/microsoft/vscode/issues/309207) and [#313458](https://github.com/microsoft/vscode/issues/313458)), so it always reads `0 / 144K` for Cage-Free Rewsty. The extension now surfaces that usage as a native status bar item in the bottom-right (`$(dashboard) 42%`), with a hover tooltip showing the token breakdown and organization. It appears after the first turn that reports usage and tracks the most recent turn. (#29)

## [0.43.5] - 2026-06-16

### Changed

- **GraphQL mutations confirm in the chat, not in an OS dialog** - approving a `rewst_graphql` mutation now uses VS Code's native inline chat confirmation (Continue / Cancel) showing the full operation and variables, the same approval surface as Cage-Free Rewsty's other Rewst-side actions, instead of a separate operating-system modal popping over the editor. Declining simply skips the mutation; queries and schema reads still run without a prompt. (#25)
- **GraphQL mutations are scoped to the resource they change** - every `rewst_graphql` mutation must now declare four identifying fields: `scopeId` and `scopeName` (the id and name of the single resource it changes, e.g. a workflow's id and name) plus `orgId` and `orgName`; a mutation missing any of them is refused. Approval is remembered for the session by the ids only (org + resource) — the names are shown in the confirmation so you can recognize what is changing — so confirming one change to a resource lets further mutations to that same resource run without re-asking, while a different resource (or the same resource id in another org) is confirmed separately. (#25)

## [0.43.4] - 2026-06-16

### Fixed

- **Editor tool requests survive Markdown fences inside their arguments** - `vscode-tool` parsing now treats only a closing fence on its own line as the end of the tool block, so edit requests that insert fenced code blocks (for example README updates with triple backticks) still become VS Code tool calls instead of silently stopping the conversation. The opening fence is honored only when it begins its own line with the exact `vscode-tool` tag (not a longer word like `vscode-tooling`), and CRLF line endings are handled. (#27)
- **Editor edit tools stay on the VS Code tool protocol at chat start** - the opening steering text now uses a neutral VS Code context note instead of an XML-style directive wrapper, and the concrete tool manifest states that fenced `vscode-tool` blocks are intercepted and executed by the extension through VS Code's normal approval flow. Edit/write tools such as `insert_edit_into_file` now route to fenced blocks instead of being refused or attempted as native/Rewst function calls. (#27)
- **Tool blocks tolerate omitted `args` wrappers** - when Cage-Free Rewsty emits a `vscode-tool` block with request fields beside `tool` instead of nested under `args`, the parser now treats those fields as the request args instead of running the tool with `{}`. (#27)
- **Targeted VS Code tests actually target** - test scripts now pass `--grep` directly to `vscode-test` instead of after an extra `--`, and new `test:grep` / `test:grep:integration` scripts make one-off unit or live steering checks explicit. The integration grep script sets its env var through `cross-env` so it runs on Windows shells too. (#27)

## [0.43.3] - 2026-06-16

### Changed

- **Cage-Free Rewsty breaks complex work into todos and delegates to agents on its own** - the steering now tells the assistant to aggressively decompose any non-trivial problem into an explicit, ordered todo list before executing and to drive that list to completion. When the chat exposes a task/todo-list tool or sub-agent ("agent") tools, it is steered to record the plan through the todo tool and to hand self-contained sub-tasks to an agent whenever that is cleaner — on its own initiative, without being asked. It invokes these as editor (`vscode-tool`) tools rather than native calls, even though names like `manage_todo_list` collide with tools it knows natively. Research is held to the same bar — targeted and planned, with each web/doc search tied to a specific question on the todo list rather than open-ended browsing. Genuinely trivial requests are still answered directly. (#27)

### Fixed

- **Cage-Free Rewsty searches the web for current events instead of refusing** - a news, politics, or "latest in the last N hours" question used to get a "can't browse / no realtime access / knowledge cutoff" refusal with no tool call, unless you prefixed something like "use agents to search". The steering now treats a current, time-sensitive, or external-information question as a reason to reach for `web_search` on its own, and the highest-recency reminder no longer pushes a memory-only "answer directly" that turned into those refusals (the web carve-out only appears when `web_search` is actually enabled). (#27)

## [0.43.2] - 2026-06-16

### Changed

- **Tool activity in the chat now shows what each tool is accessing** - the running indicator includes a compact preview of the call's arguments (the search query, org, file path, GraphQL operation, …) instead of just the bare tool name. Editor tools surface this through VS Code's native tool UI; native Rewst tools render as a compact, card-like line (🔧 **Rewst tool** · `name`, with the args beneath) that sets them apart from the editor's own tools. (#22)

## [0.43.1] - 2026-06-16

### Changed

- **Editor tool-call blocks are tagged `vscode-tool` instead of `rewst-tool`** - Cage-Free Rewsty was conflating the extension's fenced tool-call protocol with its own native Rewst tool registry and trying to invoke editor tools (`list_dir`, `read_file`, …) as native calls. The fence tag is now environment-specific so the assistant recognizes those tools as editor-supplied rather than part of its platform registry. (#20)
- **Stronger curb on reflexive native tool calls at the start of a chat** - the always-on steering now names `gitbook_retriever` and forbids opening a conversation with a documentation search, and forbids firing a throwaway native platform wrapper (e.g. `listWorkflow`) as a warm-up before the tool the request actually needs. This reduces both the "Searching documentation…" loop and the stray native call that fired at the start of chats. (#20)

## [0.43.0] - 2026-06-16

### Changed

- **Cage-Free Rewsty reuses the backend conversation across turns, and falls back to the visible transcript when it can't** - an append turn continues the warm Rewst conversation and sends only the new message, which is markedly faster and stops the native documentation-search loop from re-firing every turn. When a turn can't follow that conversation — a fresh chat, an edited or rewound transcript, a window reload, or a conversation the backend has dropped — it forks a fresh, stateless conversation seeded from the visible VS Code chat history. Continuity is content-derived (the user-message spine plus a hidden per-chat breadcrumb), since VS Code's chat API exposes no session id; a rewound conversation is deleted as it's forked away from.
- **Resume now opens transcripts only** - `Rewst Buddy: Resume Rewst AI Conversation` still lists stored Rewst conversations and opens the selected transcript, but binding a future VS Code message to that Rewst conversation is deferred to a transcript-import resume flow.
- **Cage-Free Rewsty no longer reflexively searches Rewst docs or renders Jinja** - the steering directive now keeps the assistant's native internal tools (documentation search, Jinja render/test) off by default, so general engineering questions are answered directly. It still searches Rewst's documentation or validates Jinja when you explicitly ask.

## [0.42.0] - 2026-06-12

### Changed

- **The chat agent is now "Cage-Free Rewsty"** - the model picker, approval prompts, notifications, and docs drop the RoboRewsty name in favor of one that says what this is: Rewst's assistant, out of its cage, roaming your editor. Internal ids (`vendor: rewst-buddy`, `family: roborewsty`) are unchanged, so existing model picks and settings keep working

- **`fetch_url` removed in favor of VS Code's built-in fetch tool** - agent mode already provides a webpage-fetch tool to RoboRewsty, so the extension's duplicate is gone. `web_search` stays (VS Code has no built-in web search) and `rewst-buddy.ai.enableWebTools` now gates it alone; the assistant is steered to open search results with the chat's built-in fetch tool

### Fixed

- **Restore Checkpoint now actually rewinds RoboRewsty's memory** - Rewst conversations are append-only server-side, so rolling the chat back (Restore Checkpoint, or editing an earlier message and resending) used to silently re-attach to the old conversation and the assistant still remembered everything "rolled back". A rewound transcript now forks a fresh backend conversation, seeded with a compact replay of the turns that remain visible in the chat
- **Chat context survives window reloads** - when the chat carries history but its backend conversation binding was lost (the continuity map is in-memory), the new conversation is seeded with the same transcript replay instead of starting blank

## [0.41.1] - 2026-06-11

### Changed

- **Longer patience for slow answers** - the default conversation inactivity timeout is doubled from 2 to 4 minutes, so RoboRewsty turns with long backend silences (deep tool work, large answers) no longer abort early with a timeout error

## [0.41.0] - 2026-06-11

### Changed

- **RoboRewsty is now its own chat model — no Copilot account required** - Rewst's AI assistant appears directly in VS Code's chat model picker (one model per active Rewst session organization) via the Language Model Chat Provider API. Chatting with RoboRewsty needs **no GitHub sign-in and no Copilot plan** (VS Code 1.122+). The `@rewst` chat participant is retired; pick the RoboRewsty model instead
- **Tools are native chat tools** - RoboRewsty's tools (template links, web, GraphQL) are registered VS Code language-model tools, so the chat runs them with its native tool UI. The same `rewst-buddy.ai.*` settings govern them, enforced both at registration and per request — a disabled tool is never offered to the assistant, even if it appears in the chat's tool picker
- **File and terminal work uses VS Code's built-in tools** - In agent mode, the chat passes its built-in tools (read, search, edit, terminal, diagnostics) to RoboRewsty like any other model, with VS Code's own approval and review UI. The extension's custom equivalents are removed: `list_files`, `read_file`, `search_files`, `list_open_files`, `open_file`, `get_diagnostics`, `find_symbols`, `get_file_outline`, `edit_file`, `write_file`, and `run_command`, along with the settings `rewst-buddy.ai.enableEditTools`, `enableCommandTool`, and `autoApproveCommands`. `rewst-buddy.ai.enableWorkspaceTools` now gates only the Rewst-specific workspace context (the first-message workspace overview and `list_template_links`)
- **Approvals stay in the chat** - Rewst-side action approvals render as VS Code's native inline tool confirmation (Continue / Cancel) showing the tool name and arguments; approving continues the answer automatically and the one-time allow-listing is reverted after the turn. A modal dialog (Approve / Always Allow) remains as the fallback when the chat's tool surface is unavailable
- **Resume is a command** - `Rewst Buddy: Resume Rewst AI Conversation` replaces `@rewst /resume`: it opens the picked transcript and binds your next RoboRewsty chat message to continue that conversation
- **Apply suggestions is a command** - `Rewst Buddy: Apply Rewst AI Suggestion` applies a code block from the latest answer to the active file behind the same diff preview as before
- **`rewst-buddy.ai.maxToolRounds` is legacy** - VS Code's chat now owns the tool loop, so the setting has no effect; it remains declared so existing settings files don't warn
- **Minimum VS Code is 1.122** - the version where extension-contributed chat models work without a GitHub account

### Added

- **Conversation continuity & isolation** - consecutive chat turns continue the same Rewst conversation; separate chat sessions and organizations always map to distinct Rewst conversations
- **Live activity display** - while RoboRewsty works, the substantive steps it takes (documentation searches and each tool call) stream into the chat as compact lines instead of a bare spinner; thinking/summarizing churn is filtered out. Toggle with `rewst-buddy.ai.showActivity` (on by default)
- **Working-directory context** - RoboRewsty is now told your workspace root path, including in modes where the full workspace overview isn't sent
- **Step-by-step working method** - the model is steered to lay out a short plan and then take one step per reply on multi-step requests, so its (now visible) activity reads as a coherent sequence

### Fixed

- **Cross-turn memory loss** - chat continuity is keyed on the user-message spine instead of the full history, so a large or reformatted prior answer no longer drifts the key and silently starts a fresh backend conversation (which made the chat forget earlier turns)
- **GraphQL tool steering** - RoboRewsty no longer treats the editor GraphQL tools as a native group needing "activation," and no longer refuses or lectures when asked to run an authorized read; masked tool output (e.g. secret org variables) is shown as returned

## [0.40.4] - 2026-06-11

### Added

- **RoboRewsty GraphQL Tool (opt-in, mutation-approval-gated)** - `rewst_graphql` lets RoboRewsty compose and run GraphQL operations against your Rewst instance using your existing session, with `rewst_graphql_schema` for exploring the available schema. Queries run directly; mutations always show an approval dialog with the full operation before running. Disabled by default (`rewst-buddy.ai.enableGraphqlTool`) because the session can read and change anything you can in Rewst

### Fixed

- **Workspace tools are now enforced at execution time** - `rewst-buddy.ai.enableWorkspaceTools` (and `enableEditTools`) are checked when a tool request runs, not just when tools are offered to the assistant. Previously, enabling only another tool family (e.g. the GraphQL tool) while workspace tools were disabled would still execute workspace tool requests if the remote assistant sent them

## [0.40.3] - 2026-06-11

### Added

- **Approve RoboRewsty tool requests in VS Code** - When RoboRewsty needs approval to run one of its Rewst-side actions, the `@rewst` chat now shows _what_ it wants to run (tool name + arguments) with inline **Approve** / **Always allow** buttons, instead of the old dead-end "approve in the Rewst web app" message. Approving allow-lists the tool and re-sends the request so the answer continues; **Always allow** keeps it on your Rewst preferences (via `addAllowedTool`) while a one-time **Approve** removes it again afterward. The web app stays available as a fallback

## [0.40.2] - 2026-06-10

### Added

- **RoboRewsty Workspace Tools** - The `@rewst` chat participant can now inspect your workspace on its own: it requests tools (list/read/search/open files, open editors, diagnostics, symbols, file outlines, template links), the extension runs them locally and feeds results back, looping until it can answer. All tools are workspace-scoped and output-capped. New settings: `rewst-buddy.ai.enableWorkspaceTools` (default `true`) and `rewst-buddy.ai.maxToolRounds` (default `4`, `0` = unlimited)
- **RoboRewsty Edit Tools** - RoboRewsty can also act on the workspace: `edit_file` (exact find/replace), `write_file` (create or rewrite), and `open_file`. Edits to existing files are left unsaved for review — sync-on-save cannot fire until you save. Gated by `rewst-buddy.ai.enableEditTools` (default `true`)
- **RoboRewsty Command Tool (opt-in, approval-gated)** - `run_command` runs shell commands in the workspace root with a 60s timeout and output cap. Disabled by default (`rewst-buddy.ai.enableCommandTool`); when enabled, every command shows an approval modal before running and declines don't retry. `rewst-buddy.ai.autoApproveCommands` skips the prompt
- **RoboRewsty Web Tools (opt-in)** - `web_search` and `fetch_url` give RoboRewsty public web access. Disabled by default (`rewst-buddy.ai.enableWebTools`); http(s) only, private/loopback hosts and unsafe redirects are blocked, responses are size-capped
- **Resume conversations** - `@rewst /resume` lists your previous Rewst conversations (same history as the Rewst web app), loads the picked transcript into the chat, and pins follow-ups to that conversation. Add a question after `/resume` to pick and ask in one step
- **Ask Rewst AI keybinding** - `Ctrl+Alt+R` (`Cmd+Alt+R` on macOS) opens the Chat view with `@rewst` pre-filled
- **Tool activity rendering** - Each tool round renders a _Workspace activity_ list with clickable links to every file RoboRewsty accessed, accessed files are attached as references, and every edit renders an added/removed diff in the chat with a `+N −M` summary
- **Tool loop cycle guard** - `read_file` returns explicit chunks instead of silently truncating large files, duplicate tool requests are dropped, repeats across rounds are rejected with a nudge, and persistent repetition stops the loop. Fixes the assistant re-reading the same large file forever

## [0.40.1] - 2026-06-10

### Fixed

- **Prompt Injection via Attached Files** - File content attached to `@rewst` questions is now wrapped in fences longer than any backtick run it contains, so files containing ` ``` ` can no longer break out of their context block and inject instructions into the AI conversation
- **Truncated Apply Suggestions** - Code block extraction now follows CommonMark fence rules (closing fence must match the opening length), so answers containing nested fences no longer produce silently truncated content in the Apply-to-file buttons

## [0.40.0] - 2026-06-10

### Added

- **Ask Rewst AI (RoboRewsty)** - New `@rewst` chat participant in VS Code's Chat view streams answers from Rewst's AI assistant, with live progress, documentation source references, multi-turn conversation memory, attached file/selection context, apply-suggestion buttons with diff preview, and cancellation. New `Rewst Buddy: Ask Rewst AI` command opens the Chat view pre-filled with `@rewst`. New `rewst-buddy.ai.conversationType` setting selects the assistant mode (`HELP_DOCS` default) and `rewst-buddy.ai.customInstructions` prepends standing instructions to every question. Region config gains an optional `subscriptionsUrl` for the WebSocket endpoint (derived from `graphqlUrl` when omitted)

## [0.39.4] - 2026-06-10

### Changed

- **Instant Activation** - Commands, hover/definition providers, and the status bar now register immediately at startup; session loading and the local HTTP server start in the background. Activation no longer blocks on the Rewst API (previously a slow connection stalled the whole extension)
- **Scalability for Large MSPs** - Org-to-session lookups now use an O(1) index instead of scanning all managed orgs on every save/sync; link lookups by org use a dedicated index; folder fetch diffing is Set-based. Startup stale-link checks and template reference scans now run in bounded chunks instead of unbounded parallel I/O
- **Batched Persistence** - Link changes are persisted with a short debounce instead of rewriting stored state on every individual change; bulk operations write once

### Fixed

- **Persistence Race** - Batch link operations (folder fetch, renames, pruning) now resolve only after state is actually persisted, preventing rare stale reads after bulk changes
- **Stale Session Index on Re-auth** - Re-authenticating the same user no longer leaves orgs dropped from the new profile pointing at the old session
- **Browser Extension Race at Startup** - "Open template" requests from the browser extension during the first seconds after VS Code starts now wait for sessions to load instead of failing
- **HTTP Server Hardening** - Local server now rejects request bodies over 1 MB (413) instead of buffering unbounded data

## [0.39.3] - 2026-04-03

### Added

- **Stale Link Pruning** - Automatically removes template/folder links when their backing files no longer exist
    - Real-time cleanup via `onDidDeleteFiles` watcher when files or folders are deleted in VS Code
    - Startup pruning catches files deleted while VS Code was closed, using parallelized filesystem checks
    - Conservative behavior: links are kept if the file check fails for ambiguous reasons (permissions, network timeouts)

## [0.39.2] - 2026-04-03

### Changed

- **Lazy Template Metadata Loading** - Template metadata now loads only for orgs with existing template links first, deferring all other orgs (30s at startup, 5s on session events). For a user with links in 3 of 60 orgs, this reduces immediate API calls from 60 to 3.

### Fixed

- **Silent Reload Drop** - Template metadata reload requests were silently ignored when triggered during an active load; now queues and retries after the current load completes
- **Stale Write Protection** - In-flight API responses could write data into a cleared metadata store (e.g., if sessions were cleared mid-load); a generation counter now prevents this

## [0.39.1] - 2026-04-03

### Fixed

- **Template Index Deduplication** - Fixed `templateIdIndex` accumulating duplicate entries on every sync operation (save, auto-fetch, metadata update), causing duplicate items in template QuickPick and wasted memory in providers
- **Org Template Links Loading** - Added missing `loadIfNotAlready()` guard to `getOrgTemplateLinks()`, preventing potential empty results when called before links are loaded

## [0.39.0] - 2026-03-26

### Added

- **Template Bundles** - Automatic dependency-based grouping of related templates
    - Scans linked template files for `{{ template('UUID') }}` references (all Jinja brace variants supported)
    - Groups templates into bundles based on their dependency chain — a "root" template and all its descendants
    - Shared templates appear in every bundle that references them
    - Circular references handled as a single bundle
    - Standalone templates (no references in or out) listed separately
    - New **Template Bundles** panel in the Explorer sidebar
    - Click any template in a bundle to open the real linked file
    - Auto-rebuilds when templates are fetched or links change (debounced)
    - New `Rewst Buddy: Bundle Templates` command for manual rebuild
    - Refresh button in the panel header
    - Context menu on bundle items (Open to Side, Copy Path, Reveal in File Manager, Sync, Unlink, etc.)
    - Empty-state welcome view with link to rebuild command
    - Error indicator in tree view when bundle build fails
- Template reference IDs cached on links for zero-I/O bundle builds after initial scan
- Automatic migration backfill for existing links without cached refs

### Changed

- `SyncTemplate` and `UnlinkTemplate` commands refactored to use shared `getDocumentFromArgs`
- "Reveal in Finder" renamed to "Reveal in File Manager" for cross-platform consistency

### Fixed

- Auto-fetch crashing on startup when a linked folder was open (type mismatch in `checkAutoFetch`)

## [0.38.0] - 2026-03-16

### Added

- **Open in Rewst** - New command to open a linked template directly in the Rewst web app
    - Available in the explorer context menu, editor context menu, and command palette
    - Works without an active session — falls back to previously known session profiles, then the configured region

## [0.37.0] - 2026-01-18

### Added

- **Testing Infrastructure** - Comprehensive unit testing framework for contributors
    - Mock session factory with configurable SDK responses
    - Type-safe fixture builders for GraphQL types
    - Auto-discovered tests via webpack glob patterns
    - New npm scripts: `test:unit`, `test:integration`

- **Auto-Fetch Configuration** - New `rewst-buddy.autoFetchOnOpen` setting
    - Controls whether linked files fetch remote updates when opened
    - Defaults to enabled (preserving previous behavior)

### Changed

- **Auto-Fetch Behavior** - Now independent of sync-on-save setting
    - Previously only worked when sync-on-save was enabled for the file
    - Now controlled by dedicated `autoFetchOnOpen` setting

## [0.36.0] - 2026-01-16

### Added

- **Template Metadata Caching** - New `TemplateMetadataStore` caches template names and org info across all active sessions
    - Hover over `template('UUID')` calls now shows template name and org even for unlinked templates
    - Templates are loaded in parallel chunks (5 concurrent requests) for better performance
    - Automatically syncs when sessions are added/removed

### Changed

- **Improved Hover Experience** - Hover info now distinguishes between "Not linked locally" (known templates) and "Unknown template" (not found in any session)

## [0.35.0] - 2026-01-16

### Added

- **Template Navigation** - Ctrl+click on `template('UUID')` calls to jump to linked template files
- **Template Hover Info** - Hover over `template('UUID')` calls to see template name and organization (or "Not linked locally" for unlinked templates)

### Changed

- **Performance** - Template ID lookups now use O(1) index instead of O(n) filtering

## [0.34.0] - 2026-01-16

### Changed

- **Memory Optimization** - Reduced RAM usage by storing template body hashes instead of full content
    - Template links now store SHA-256 hash of body content instead of the full body text
    - GraphQL queries optimized to fetch body content only when needed
    - Existing links automatically migrated on load (no user action required)
    - No changes to user-facing functionality - all sync and conflict detection works identically

## [0.33.0] - 2026-01-14

### Added

- **Browser Extension Integration: Open Template** - New server endpoint allows browser extension to open templates directly in VS Code
    - When triggered from browser, opens existing linked file and syncs to latest version
    - If no link exists, creates new document and prompts user to save
    - Seamless workflow between browser and VS Code editor

### Changed

- **Refactored Template Document Creation** - Extracted `createAndLinkNewTemplate` utility
    - Consolidates duplicate code from `OpenTemplateFromURL` and `OpenTemplateInteractive` commands
    - Improves maintainability and consistency

## [0.32.3] - 2026-01-13

### Changed

- **Copy Template ID** - Command now available in file explorer context menu for linked template files

## [0.32.2] - 2026-01-13

### Fixed

- **Session Loading Timeout** - Added 10-second timeout to prevent extension hang if concurrent session loading fails
- **Status Bar Session Validation** - Status bar now correctly checks for organization-specific sessions, not just any active session

## [0.32.1] - 2026-01-10

### Changed

- **Non-blocking Persistence** - LinkManager and SyncOnSaveManager now use fire-and-forget saves
    - State changes persist without blocking the UI
    - Simplified internal API with auto-save on mutations

### Fixed

- **Template URL Error Message** - Corrected path pattern in error message from `/(:orgId)/templates/` to `/organizations/(:orgId)/templates/`

## [0.32.0] - 2026-01-06

### Changed

- **Batch Mode for Folder Fetch** - Significantly improved performance when fetching folders with many templates
    - Templates are now written in parallel chunks of 20 instead of sequentially
    - Link saves are batched and deferred until all templates are processed
    - Added `reservedUris` tracking to prevent filename collisions during parallel writes
    - Single save + event emission at the end instead of per-template

- **O(1) Sync-On-Save Lookups** - Optimized sync state checking from O(n) to O(1)
    - Inclusions and exclusions now cached as in-memory Sets
    - `enableSync()` and `disableSync()` now save in parallel instead of sequentially

## [0.30.2] - 2026-01-06

### Fixed

- **Autofetch** - Templates created from folder sync now properly track file stats for autofetch

## [0.30.1] - 2026-01-06

### Fixed

- **Package Size** - Fixed `.vscodeignore` including 4,400+ `.d.ts` files from node_modules
- **Filename Sanitization** - Template filenames now sanitize characters invalid on Windows/Linux (`<>:"/\|?*`)

## [0.30.0] - 2026-01-06

### Changed

- **Flexible Sync-On-Save Control** - Refactored sync-on-save to support both opt-in and opt-out modes
    - New `syncOnSaveByDefault` setting (replaces `enableSyncOnSave`) controls default behavior
    - When enabled: all linked files sync unless explicitly disabled (exclusion mode)
    - When disabled (default): files only sync when explicitly enabled (inclusion mode)
    - Use `Enable Sync-On-Save` and `Disable Sync-On-Save` commands to control individual files
    - Status bar click toggles sync state for current file

## [0.29.0] - 2026-01-05

### Added

- **Smart Template Opening** - Opening templates now checks for existing linked files first
    - `Open Template` and `Open Template from URL` commands automatically detect if the template is already linked to a local file
    - Opens existing linked file instead of creating a new untitled document
    - Prevents duplicate downloads and improves workflow efficiency
    - When a template is linked to multiple files, displays a picker to select which file to open

## [0.28.0] - 2026-01-05

### Added

- **Automatic Folder Syncing** - Linked folders now automatically check for new templates every 15 minutes
    - Runs in background to keep local template files in sync with Rewst
    - Only fetches templates that don't already exist locally
    - Handles errors gracefully without interrupting workflow

- **Immediate Template Fetch on Link** - Linking a folder now automatically downloads all templates
    - No need to manually run "Fetch Folder" after linking
    - Templates are ready to edit immediately after folder link completes
    - Shows success notification with count of fetched templates

### Changed

- **Refactored Folder Operations** - Moved folder fetching logic from command into SyncManager
    - Better code organization and separation of concerns
    - Enables reuse of fetch logic for both manual and automatic syncing
    - Improved error handling and user notifications

### Fixed

- **Resource Leak** - Fixed setInterval starting before extension activation
    - Interval now properly initialized in constructor after extension is ready
    - Prevents premature fetching before sessions are loaded
- **API Flooding** - Fixed parallel folder fetching overwhelming Rewst API
    - Folders now process sequentially instead of all at once
    - Prevents rate limiting and improves reliability
- **Inconsistent State** - Fixed folder linking leaving inconsistent state on fetch failure
    - Folder link succeeds even if initial template fetch fails
    - User receives appropriate error notification but folder remains linked
    - Automatic syncing will retry on next interval

## [0.27.0] - 2026-01-05

### Added

- **Auto-fetch on Open** - Templates automatically download latest changes from Rewst when opening files
    - Only works when sync-on-save is enabled for the file
    - Safely detects local modifications using file stat tracking
    - Skips auto-fetch when local edits are detected to prevent data loss
    - Gracefully handles legacy links without stat information

- **StatusBar Integration** - New status bar item shows template link status
    - Displays template name and organization in status bar
    - Shows sync-on-save state with visual indicators (ON/OFF)
    - Warns when no active session exists for the linked template's organization
    - Click to toggle sync-on-save exclusion
    - Tooltip shows full template details (name, description, organization)

- **File Stat Tracking** - Links now track file modification time and size
    - Enables intelligent auto-fetch behavior
    - Prevents unnecessary downloads when files haven't changed
    - Updated whenever templates are synced to Rewst

### Changed

- **Immediate Sync After Linking** - Link commands now sync template content immediately
    - `LinkTemplateFromURL` auto-syncs after creating link
    - `LinkTemplateInteractive` auto-syncs after creating link
    - Ensures local file matches Rewst template right after linking

- **Renamed SyncManager** - `TemplateSyncManager` renamed to `SyncManager` for clarity
    - Updated all imports and references across codebase
    - No functional changes to sync behavior

### Fixed

- **StatusBar Property Access** - Fixed incorrect property path causing runtime errors
    - Changed `link.template.orgId` to `link.org.id` to match Link interface
- **StatusBar Code Cleanup** - Removed unused `isLinked` variable that was computed but never used
- **Legacy Link Handling** - Auto-fetch now gracefully skips links created before stat tracking was added

## [0.26.1]

### Fixed

- **parseArgsUri Safety** - Added bounds checking to prevent infinite loops on malformed command arguments
- **Rename Handler** - Silently ignores unlinked files instead of logging errors on every file rename
- **Legacy Migration** - Link migrations (sessionProfile → org) now persist immediately instead of waiting for user action
- **Code Cleanup** - Removed unused variable in StatusBarIcon tooltip builder

## [0.26.0]

### Added

- **Folder Linking** - Link entire folders to Rewst organizations
    - Right-click folder → "Link Folder to Organization" to associate a local folder with an org
    - Right-click linked folder → "Unlink Folder from Organization" to remove association
    - Context menu commands only appear on appropriate folders (linked vs unlinked)

- **Fetch Folder** - Bulk download all templates from an organization
    - Right-click linked folder → "Fetch Folder" to download all templates
    - Automatically creates files for each template in the organization
    - Skips templates that already exist locally (by ID)
    - Handles filename collisions by appending `(1)`, `(2)`, etc.
    - Each downloaded template is automatically linked for future syncing

- **New Utilities** - Reusable file operation utilities
    - `uriExists()` - Check if file/folder exists at a URI
    - `writeTextFile()` - Write text content to a file
    - `makeUniqueUri()` - Generate unique filename with collision handling
    - `isDescendant()` - Check if URI is descendant of another
    - `parseArgsUri()` - Parse URI from command arguments

### Changed

- **LinkManager Refactor** - Unified link management for templates and folders
    - Renamed `TemplateLinkManager` → `LinkManager`
    - Now supports multiple link types: `Template` and `Folder`
    - Added `getTemplateLink()`, `getFolderLink()`, `getOrgLinks()`, `getOrgTemplateLinks()`
    - Links now store `org` directly instead of `sessionProfile`
    - Backward compatible: migrates legacy `sessionProfile` field automatically

- **Simplified Link Structure** - Links now reference org directly
    - `TemplateLink` now contains `org: { id, name }` instead of `sessionProfile`
    - Reduces coupling between links and session management
    - All template commands updated to use new structure

- **Initialization Order** - Improved extension startup
    - Removed automatic session refresh on activation (prevents blocking)
    - `LinkManager` now uses `init()` method instead of constructor for event subscriptions
    - Prevents circular dependency issues during initialization

- **Rename Handling** - Improved file/folder rename tracking
    - Sync exclusions now properly follow renamed files
    - Uses new `isDescendant()` utility for accurate parent-child detection

### Fixed

- **Filename Collision Bug** - Fixed unique filename generation
    - Previously generated `file(1.txt)` instead of `file(1).txt`
    - Now correctly places counter before file extension

## [0.25.0]

### Added

- **Copy Template ID** - Copy linked template ID to clipboard
    - Right-click on linked file → "Copy Template ID"
    - Available via Command Palette: `Rewst Buddy: Copy Template ID`
    - Useful for referencing template IDs in workflows or documentation

## [0.24.3]

### Changed

- **Command Organization** - Renamed `commands/client/` directory to `commands/sessions/`
    - Better reflects the purpose of session-related commands
    - Aligns with the sessions naming convention established in v0.23.0

## [0.24.2]

### Changed

- **Session Naming Refactor** - Simplified session-related class and file names
    - Renamed `RewstSession` → `Session` (src/sessions/Session.ts)
    - Renamed `RewstSessionProfile` → `SessionProfile` (src/sessions/SessionProfile.ts)
    - Renamed `RewstSessionManager` → `SessionManager` (src/sessions/SessionManager.ts)
    - Updated storage key from `'RewstSessionProfiles'` → `'SessionProfiles'`
    - Consolidated session exports using `export *` pattern in sessions/index.ts
    - Updated all import paths across codebase to use new naming (23+ files)
    - Fixed GraphQL SDK imports to use `@sessions` alias consistently

## [0.24.1]

### Fixed

- **Session Validation** - Fixed status bar not showing warning when no active session exists for linked template
    - Status bar now properly returns early when no session is found
    - Warning state correctly displays error background with session prompt
- **SyncOnSaveManager Initialization** - Fixed activation order issue
    - Manager now properly initialized asynchronously before use
    - Prevents potential race conditions during extension startup
- **Status Bar Item Visibility** - Fixed status bar item not showing in certain states
    - Item now explicitly shown after updating state (sync enabled/disabled/no session)

## [0.24.0]

### Added

- **Sync on Save** - Automatically sync linked templates when files are saved
    - Enable/disable globally via `rewst-buddy.enableSyncOnSave` setting (default: true)
    - New `SyncOnSaveManager` handles sync state and exclusions

- **Sync Exclusions** - Exclude specific files from automatic sync
    - "Add Sync-On-Save Exclusion" command to exclude a linked file
    - "Remove Sync-On-Save Exclusion" command to re-enable sync
    - Exclusions are stored persistently and cleaned up when files are unlinked
    - Context menu shows appropriate command based on exclusion state

### Changed

- **Refactored SyncTemplate command** - Moved to `commands/template/sync/` directory
- **StatusBarIcon** - Updated to reflect sync exclusion state
- **Event types** - Added `SyncOnSaveChangeEvent` type

## [0.23.0]

### Added

- **Automatic Session Refresh** - Sessions now automatically refresh every 15 minutes
    - Keeps authentication cookies fresh without manual intervention
    - Prevents unexpected session expiration during active work
    - Runs in background with automatic cleanup on extension deactivation

- **Expired Session Tracking** - Session tree view now displays both active and expired sessions
    - Active sessions show green checkmark icon
    - Expired sessions show red error icon with "EXPIRED" status in tooltip
    - Helps identify which sessions need to be refreshed or recreated

### Changed

- **Refactored Path Aliases** - Consolidated `@client` and `@sdk` aliases into single `@sessions` alias
    - Renamed `src/client/` directory to `src/sessions/` to better reflect its purpose
    - Updated all imports throughout the codebase (23+ files)
    - Simplified tsconfig.json and webpack.config.cjs path alias configuration

- **Session Management Architecture** - Enhanced session lifecycle and state management
    - Sessions now load asynchronously on extension activation with proper loading guards
    - Added `getActiveSessions()` for synchronous access to current sessions
    - Added `getAllKnownProfiles()` to track all sessions (active and expired)
    - `loadSessions()` now idempotent - returns cached sessions if already loaded
    - `getSessionForOrg()` changed from async to sync method

- **Session Tree View** - Improved visibility and renamed for clarity
    - Tree view name changed from "Active Sessions" to "Sessions"
    - Now displays all known sessions with visual status indicators
    - Enhanced tooltips show active/expired state

- **Session Events** - Enhanced event data structure
    - Added `'saved'` event type to `ChangeType`
    - Event payload now includes `allProfiles` (all known) and `activeProfiles` (currently active)
    - Removed `allSessions` field in favor of profile-based tracking

- **Error Messages** - Improved clarity in TemplateSyncManager
    - Sync errors now provide specific failure context
    - Missing template ID errors include detailed API response information

### Fixed

- **Session Loading** - Prevented race conditions during parallel session loads with loading state guards
- **Cookie Storage** - Fixed token refresh to properly update stored cookies using CookieString value

### Technical

- Extension activation order adjusted to load sessions after UI initialization
- Path alias count reduced from 8 to 7 (merged `@client` + `@sdk` → `@sessions`)
- Added periodic refresh interval (15 minutes) with proper disposal cleanup
- SessionManager refactored to singleton pattern with inline class syntax

## [0.22.2]

### Added

- **Session Validation in Status Bar** - StatusBar now checks if an active session exists for linked templates
    - Shows warning state with red background if no session is found with access to the template's organization
    - Provides quick access to focus sidebar when session is missing
    - Subscribes to session changes for real-time status updates

- **FocusSidebar Command** - New command to focus the sidebar panel
    - Accessible from status bar warning state when no session is available
    - Helps users quickly navigate to the session management interface

### Changed

- **Extracted parseCookieString Utility** - Moved cookie parsing logic from RewstSession to dedicated utility function for better code reusability

- **StatusBar.update() Method** - Now async to support session lookup operations

### Added (Technical)

- **SessionManager Enhancement** - Added `getSessionForOrg()` method to SessionManager
    - Enables lookups for sessions with access to a specific organization
    - Throws error if no session found for the requested organization

## [0.22.1]

### Added

- **Pre-commit Tooling** - Automated quality checks before commits
    - Husky integration for git hooks
    - Auto-generates GraphQL SDK when `.graphql` files change
    - Runs lint-staged on all staged files (ESLint + Prettier)
    - Type-checks entire project before allowing commits
    - New npm scripts: `codegen:check`, `lint:staged`, `pre-commit`

### Changed

- Standardized code formatting across all file types
    - Configured Prettier as default formatter for TypeScript, JavaScript, JSON, and Markdown
    - Added `.prettierignore` to exclude auto-generated SDK from formatting
- Updated ESLint configuration to ignore generated SDK file
- Reformatted existing code to match new formatting standards
- Import ordering fixes in session manager

### Dependencies

- Added `husky` (v9.1.7) for git hook management
- Added `lint-staged` (v15.5.2) for selective linting

## [0.22.0]

### Added

- **Create Template** - Create new Rewst templates directly from local files
    - Right-click in editor → "Create Template"
    - Prompts for organization and template name (suggests filename)
    - Automatically links the file to the newly created template
    - Available via Command Palette: `Rewst Buddy: Create Template`

- **Delete Template** - Delete templates from Rewst with confirmation
    - Right-click on linked file → "Delete Template"
    - Shows confirmation modal before deletion
    - Automatically unlinks the file after deletion
    - Available via Command Palette: `Rewst Buddy: Delete Template`

### Changed

- Refactored link commands folder structure (`link-commands/` → `link/`)
- Added utility functions for cleaner code:
    - `ensureSavedDocument()` - ensures documents are saved before operations
    - `requireUnlinked()` - validates files aren't already linked
    - `getTemplate()` method added to RewstSession class
- Simplified OpenTemplate and LinkTemplate command implementations
- Updated createTemplate GraphQL mutation to accept body parameter
- Removed explorer context menu, kept only editor context menu for better UX

### Fixed

- Args parsing for context menu commands (SyncTemplate, UnlinkTemplate, DeleteTemplate)
- Error handling in TemplateSyncManager

## [0.21.0]

### Changed

- Refactored event handling to self-registration pattern
- Managers now subscribe to VS Code events internally (TemplateLinkManager, TemplateSyncManager, Server)
- UI components self-register for domain events (SessionTreeDataProvider, StatusBar)
- Simplified extension.ts by removing external event wiring

### Removed

- Deleted `src/events/vscode/` folder (handlers moved into managers)
- Removed `onRename.ts`, `onSave.ts`, `onEditorChange.ts`, `onLinksSaved.ts`

## [0.20.0]

### Added

- Activity bar sidebar with custom Rewst logo icon
- Session input panel for adding sessions directly from the sidebar
- Active Sessions tree view showing all connected sessions
- Custom Rewst SVG icon for activity bar

### Changed

- Moved extension icon to media/ folder for consistency

## [0.19.1]

- Add AI icon

## [0.19.0]

- Cleaner context menu command titles

## [0.18.0]

- Restructure project layout and decouple event handlers

## [0.17.0]

- Context menu support for template operations
