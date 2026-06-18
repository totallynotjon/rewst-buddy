# Features

Detailed reference for each feature in Rewst Buddy. For onboarding walkthroughs, see [Quick Start](quickstart.md). For commands, settings, and UI panels, see the [Reference](reference.md).

## Auto-Sync on Save

By default, sync-on-save is **disabled** — you must enable it per file by clicking the status bar item in the bottom-left corner.

To enable sync-on-save globally for all linked files:

```json
{
	"rewst-buddy.syncOnSaveByDefault": true
}
```

- When `false` (default): files only sync when explicitly enabled per file
- When `true`: all linked files sync unless explicitly disabled

You can also use `Enable Sync-On-Save` and `Disable Sync-On-Save` commands from the command palette.

> Auto-sync performs the same safety checks as manual sync, preventing overwrites if the template was modified in Rewst since your last sync.

Sync is safer than editing in browser tabs — before pushing, the extension pulls the template and verifies it hasn't changed since your last fetch. (The browser would just overwrite.)

## Auto-Fetch on Open

When you open a linked template file with sync-on-save enabled, the extension automatically checks if there are newer changes in Rewst and downloads them if:

- The file hasn't been modified locally since the last sync
- A newer version exists in Rewst

This keeps your local files in sync with Rewst changes made by others, while protecting your local edits from being overwritten.

## Smart Template Opening

When opening templates via `Open Template` or `Open Template from URL`:

- The extension checks if the template is already linked to a local file
- Opens the existing linked file instead of creating a new untitled document
- If linked to multiple files, displays a picker to select which file to open

## File Rename Support

Template links automatically update when you rename or move files — no broken links when reorganizing your workspace.

## Stale Link Pruning

When you delete a linked file, its template/folder link is cleaned up automatically — no manual unlink required.

- Real-time: deletions through VS Code's explorer trigger immediate link removal.
- On startup: links whose files were deleted while VS Code was closed get pruned on next load.
- Conservative: if the filesystem check fails ambiguously (permissions, network timeouts), the link is kept rather than wrongly removed.

## Template Navigation

When editing linked template files, you can navigate between templates:

- **Ctrl+Click** (or Cmd+Click on Mac) on `template('UUID')` calls to jump directly to the linked template file
- **Hover** over `template('UUID')` calls to see the template name and organization
- Works with both single and double quoted UUIDs: `template("UUID")` or `template('UUID')`

Note: Navigation only works when both the current file and the referenced template are linked locally.

## Template Bundles

Templates that reference other templates via `{{ template('UUID') }}` are automatically grouped into **bundles** — visible in the Explorer sidebar under "Template Bundles".

- **Automatic dependency detection** — Scans all linked template files for `template('UUID')` calls wherever they appear, including inside Jinja brace wrappers like `{{ ... }}` and `{{- ... -}}`
- **Bundle grouping** — A "root" template is one that references others but isn't referenced itself. The root and all its descendants (full chain) form a bundle.
- **Shared templates** — Templates referenced by multiple roots appear in every bundle that uses them
- **Circular references** — Handled gracefully as a single bundle
- **Standalone templates** — Templates with no references in or out are listed separately
- **Click to open** — Clicking any template in a bundle opens the real linked file (sync-on-save works as normal)
- **Auto-rebuild** — Bundles automatically update when templates are fetched or links change
- **Manual rebuild** — Use `Rewst Buddy: Bundle Templates` from the command palette to refresh

## Ask Rewst AI (Cage-Free Rewsty)

Talk to Rewst's AI assistant directly from VS Code's chat — as its own model, **Cage-Free Rewsty** (the same RoboRewsty that powers the in-app chat, free-range in your editor), in the model picker. **No GitHub account or Copilot plan is required**: Cage-Free Rewsty carries the chat itself (VS Code 1.122+).

**Usage:**

1. Open the Chat view (or run `Rewst Buddy: Ask Rewst AI` — `Ctrl+Alt+R` / `Cmd+Alt+R`)
2. Pick **Cage-Free Rewsty** in the model picker (with multiple Rewst sessions there is one Cage-Free Rewsty model per organization)
3. Ask your question, e.g. `how do I parse JSON in a Jinja template?` — the answer streams in

### Conversations

- **Multi-turn** — follow-up questions are grounded in the visible VS Code chat transcript, so Restore Checkpoint and edited history naturally remove rolled-back turns from the assistant's context
- **Resume** — `Rewst Buddy: Resume Rewst AI Conversation` (command palette) lists your recent Rewst conversations (the same history as the Rewst web app) and opens the picked transcript
- **Lives in Rewst** — each turn is processed through a transient Rewst conversation; the extension keeps the latest successful one and cleans up older transient conversations
- **Fast follow-ups** — a follow-up reuses the same warm Rewst conversation instead of re-sending the whole transcript, and that link is remembered across window reloads, so picking an earlier chat back up stays quick rather than starting from scratch
- **Organization** — each Cage-Free Rewsty model is tied to a session's organization; pick the org by picking the model
- **Latency** — full answers typically take 20–40 seconds. Cancel any time with the stop button

### Workspace tools

File and workspace work comes from VS Code itself: in agent mode, the chat passes its built-in tools (read, search, edit, terminal, diagnostics) to Cage-Free Rewsty like any other model, with VS Code's own approval and review UI. The extension adds the Rewst-specific context VS Code can't know:

- `list_template_links` — lists the local files linked to Rewst templates (path, template name, template id, org)
- Your first message includes a small workspace overview (the workspace root path, folder names, and top-level entries). Even with workspace tools off, Cage-Free Rewsty is still told your working directory
- This context is sent to the Rewst AI assistant — uncheck `workspace` in `rewst-buddy.ai.tools` if you don't want workspace structure shared

### Opt-in tools

Off by default because they let a remote assistant direct activity on your machine. Enable them by checking the corresponding box in the single **`rewst-buddy.ai.tools`** setting (`web`, `graphql`, `workflows`; `workspace` is on by default):

- **Web** (`web` in `rewst-buddy.ai.tools`) — `web_search` searches the public web and returns result titles, URLs, and snippets. Once enabled, Cage-Free Rewsty reaches for it on its own whenever an answer depends on current or external information (news, recent events, latest versions) rather than refusing with a knowledge-cutoff excuse — you don't have to tell it to search. Only http(s) is allowed; private/loopback hosts are always blocked. Opening result pages uses VS Code's built-in fetch tool in agent mode
- **GraphQL** (`graphql` in `rewst-buddy.ai.tools`) — `buddy_graphql` composes and runs GraphQL operations against your Rewst instance using your session, with `buddy_graphql_schema` for exploring the schema. Queries run directly; **mutations always require an inline chat confirmation (Continue / Cancel) showing the full operation** — the same approval surface as Cage-Free Rewsty's other Rewst-side actions, not a separate OS dialog. Every mutation must declare four fields — **scopeId** and **scopeName** (the id and name of the single resource it changes, e.g. a workflow's id and name) plus **orgId** and **orgName**; a mutation missing any is refused. Approval is remembered for the session by the ids only (the names just make the prompt readable): confirm one change to a workflow and further edits to **that** workflow run without re-asking, while a different workflow — or the same resource id in another org — is confirmed again. Off by default because the session can read and change anything you can in Rewst
- **Workflows** (`workflows` in `rewst-buddy.ai.tools`) — purpose-built tools that let Cage-Free Rewsty understand and edit Rewst workflows without the trial-and-error of raw GraphQL:
    - `buddy_workflow_search` finds a workflow by name across **every org you can access** — on first use it builds and caches an index of all workflows (name, id, org name, org id), then answers later searches from the cache, so the assistant resolves a workflow id instead of guessing or paging through GraphQL. Results always include the org name
    - `buddy_workflow_get` reads a workflow as a clean **node/edge graph** — tasks with their action ref and input, and transitions with their condition, label, target tasks, and published context variables — instead of the verbose raw shape. By default it returns a concise **analysis view** (task ids, transition ids, canvas positions, and the version token omitted; tasks referenced by name) so the assistant can understand what a workflow does with far less noise; `detail: "full"` adds those ids and positions when an edit needs to reposition a task or target a specific transition
    - `buddy_action_search` finds actions for an org (ranking core/common actions first) and, in describe mode, returns an action's input **parameters** so the assistant knows what to fill in
    - `buddy_workflow_edit` applies high-level **operations** (`add_task`, `update_task`, `delete_task`, `connect`, `disconnect`, `set_transition`, `reposition`, `set_inputs`) to a workflow. The tool reads the current workflow, applies the operations to the whole graph, and saves it back — so nothing is dropped (the API replaces the whole workflow on save), the version is checked to avoid clobbering a concurrent change, valid task ids are generated, and action refs are resolved for you. It knows the Rewst conventions assistants usually miss: calling another workflow as a sub-workflow (`add_task` with `subWorkflowId`), and defining the workflow's run/call inputs (`set_inputs`, which writes the input list **and** the action parameters that actually drive the UI form — not `varsSchema`). New tasks are auto-placed below the action they connect from; `reposition` moves a task to exact canvas coordinates. A patch is recorded on every save, so edits are reversible from Rewst's workflow history
    - `buddy_workflow_autolayout` re-arranges an entire workflow into a clean top-down layout: one row per rank, children ordered left-to-right by their transition order, retry loops kept compact, and a global failure-catch (a terminal node fed by many steps) moved into a lane to the right rather than dragging long edges down the canvas
    - `buddy_render_jinja` renders a Jinja template against a real execution's context (fetched server-side, so the large context stays out of the chat) and returns just the result — so Cage-Free Rewsty can confirm a transition condition or expression evaluates as expected _before_ editing, instead of guessing. Pass `keys: true` to list the context's top-level keys when it's not sure what a run holds
    - `buddy_workflow_run` triggers a run of a workflow (to test it end to end or kick it off). By default it **waits** for the run to finish and reports the outcome, automatically including the failing task's log if it failed — so a test is one call, not a run-then-poll-then-check loop. It executes real automation, so **every run is confirmed individually** — unlike editing, a run is never remembered, so it asks again each time
    - `buddy_workflow_executions` lists a workflow's recent runs (newest first, optionally filtered by status like `failed`) — the entry point for debugging a failure
    - `buddy_execution_logs` shows one execution's per-task logs — each task's status, and for failed tasks the message, the input it received, and the result it produced — the fastest way to see **why** a run failed without reading the whole context
    - Reads run directly; **edits and auto-layout require the same inline chat confirmation** as a GraphQL mutation, showing what will change, and that approval is remembered per workflow for the session. **Running a workflow is confirmed every time** — executing automation is never remembered. Off by default because the session can change any workflow you can in Rewst

A tool whose setting is off is never offered to the assistant — even if it appears in the chat's tool picker.

### Approving Rewst actions

Some of Cage-Free Rewsty's own Rewst-side actions require your approval before they run. When one comes up, the chat shows an inline confirmation with **what** it wants to run (the tool name and its arguments) — **Continue** approves it once and the answer picks up where it left off; **Cancel** declines. The one-time approval is reverted after the turn, so the tool asks again next time. (If the chat's tool surface is unavailable, a dialog with **Approve** / **Always Allow** is used instead; the Rewst web app stays available as a fallback.)

### Context and answers

- **Attached context** — files attached via the paperclip or `#file`, and editor selections, are included by the chat itself
- **Apply suggestions** — `Rewst Buddy: Apply Rewst AI Suggestion` (command palette) applies a code block from the latest answer to your active file behind a diff preview; confirm to apply, and the edit stays unsaved for review
- **Custom instructions** — `rewst-buddy.ai.customInstructions` prepends standing instructions to every question (sent as part of your message, so it can't override Rewst's system prompt)
- **Plans and todos** — for anything with real complexity, Cage-Free Rewsty breaks the work into an ordered todo list before executing and works it to completion. In agent mode, where VS Code exposes a todo-list tool and sub-agents, it records the plan through the todo tool and hands off self-contained sub-tasks to an agent on its own — you don't have to ask it to
- **Live activity** — while Cage-Free Rewsty works, the substantive steps it takes (documentation searches and each tool call) stream into the chat as compact lines so you can see what it's doing rather than waiting on a bare spinner. Turn it off with `rewst-buddy.ai.showActivity`
- **Context usage** — Rewst reports how much of the conversation's context window it's using, shown as a status bar item in the bottom-right (`$(dashboard) 42%`); hover for the token breakdown and organization. VS Code's own "Context Window" gauge stays at `0` for Cage-Free Rewsty because a third-party model provider can't feed it usage ([microsoft/vscode#309207](https://github.com/microsoft/vscode/issues/309207), [#313458](https://github.com/microsoft/vscode/issues/313458)), so this status bar item is the live read instead. It appears after the first turn that reports usage and tracks the most recent turn
- **Sources** — documentation citations are rendered at the end of the answer

> The chat UI is provided by VS Code's built-in chat (the free, open-source Copilot Chat extension) — no GitHub sign-in or Copilot subscription is needed to chat with Cage-Free Rewsty. The conversation type can be changed via the `rewst-buddy.ai.conversationType` setting.

## Session Receiver Server

A local HTTP server that receives session cookies from the [Rewst Buddy Browser Extension](https://github.com/totallynotjon/rewst-buddy-browser), eliminating the need to manually copy/paste cookies.

> The browser extension is not yet published to the Chrome Web Store — it must be sideloaded (loaded as an unpacked extension in developer mode). See the [rewst-buddy-browser README](https://github.com/totallynotjon/rewst-buddy-browser) for load-unpacked instructions.

**Setup:**

1. Clone or download [rewst-buddy-browser](https://github.com/totallynotjon/rewst-buddy-browser) and load it unpacked in your browser's extensions page (developer mode enabled)
2. The VS Code server starts automatically (enabled by default)
3. Navigate to any Rewst page — your session transfers automatically

**Configuration:**

```json
{
	"rewst-buddy.server.enabled": true,
	"rewst-buddy.server.port": 27121,
	"rewst-buddy.server.host": "127.0.0.1"
}
```

The server is enabled by default. Use `Start Server` / `Stop Server` commands for manual control.
