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

### Workspace and editor tools

In agent mode, file and workspace work in Cage-Free Rewsty chat uses VS Code's own built-in tools — read, search, edit, terminal, diagnostics, and the rest — with VS Code's normal approval and review UI. Rewst-specific actions come from the Rewst Buddy MCP server instead (next section).

Cage-Free Rewsty is still told your VS Code working directory when one is open, so file-oriented built-in tools have useful local context.

### Rewst MCP tools

Rewst-specific actions are exposed through the Rewst Buddy MCP server instead of the chat LM tool surface. MCP exposure uses three switches:

- `rewst-buddy.mcp.enable` exposes all read capabilities: `list_orgs`, `list_templates`, `get_template`, `list_workflows`, `get_workflow`, `rewst_graphql_query`, `buddy_graphql_schema`, `search_template_links`, `buddy_template_link_status`, `buddy_workflow_get`, `buddy_workflow_search`, `buddy_workflow_executions`, `buddy_execution_logs`, `buddy_render_jinja`, `buddy_action_search`, `list_jinja_filters`, `get_jinja_filter_docs`, and `result_read`.
- `rewst-buddy.mcp.enableWriteTools` adds the workflow write helpers `buddy_workflow_edit`, `buddy_workflow_autolayout`, and `buddy_workflow_run`.
- `rewst-buddy.mcp.enableDangerousGraphqlMutation` unlocks only `rewst_graphql_mutate`, the raw GraphQL mutation tool.

The old combined chat tool `buddy_graphql` is not exposed; its MCP replacement is the query/mutate pair. Workflow edits, auto-layout, runs, and raw GraphQL mutations still require approval inside VS Code before anything is sent to Rewst. `rewst_graphql_mutate` is intentionally separate from `enableWriteTools` because it can run arbitrary mutations against the live org.

When the server is registered with VS Code's own MCP client (the `Add MCP Server to VS Code` command), flipping any of these exposure switches re-advertises the server with a new version, so VS Code reconnects and refreshes the tool set in chat — no window reload needed.

**Cage-Free Rewsty uses these Rewst tools directly.** When the MCP server is on, Cage-Free Rewsty advertises the same exposed Rewst tools in its `vscode-tool` protocol and runs them in-process. That keeps them available even when VS Code's limit of 128 tools per chat request would otherwise drop them — the cap is easy to hit once many built-in or other MCP tools are enabled, and dropped Rewst tools are why the assistant used to mis-call them. They honor the same read/write switches, [working scope](#working-scope), and approval as any other MCP call. With the MCP server off, no Rewst tools are advertised in chat.

**Enabling vs. registering — when you need each.** The master switch (`rewst-buddy.mcp.enable`) and registering the server with VS Code (`Add MCP Server to VS Code`) are independent:

- **Cage-Free Rewsty only needs the switch.** It sources and runs the tools in-process, so `rewst-buddy.mcp.enable` alone is enough — you do not have to register the server with VS Code to use Rewst tools in Cage-Free Rewsty chat.
- **Register the server to reach other consumers.** Add it to VS Code's MCP client to use Rewst tools with **other** chat models (Copilot or any model in agent mode), or copy its config (`Copy MCP Config to Clipboard`) for **external** MCP clients. Those paths flow through VS Code's tool surface and are subject to the 128-tool cap.
- **Doing both is fine.** If VS Code also passes a Rewst tool to Cage-Free Rewsty (under the cap), the chat keeps it on VS Code's native path that turn and never double-advertises it.

The per-call write approval modal names the requester — **Cage-Free Rewsty** for an in-process chat call, or **an external MCP client** for the HTTP/MCP surface — so you can see who is asking before you approve.

Oversized MCP results are cached in memory and returned with a preview plus a short id; page or search the cached result with the MCP-only `result_read` tool. The retired chat-only `buddy_result_read` cache is no longer part of the chat tool protocol.

The local MCP endpoint is guarded by a persistent localhost token. If it is ever exposed, run `Rewst Buddy: Rotate MCP Token` to replace it after a modal confirmation — existing MCP clients holding the old token lose access until you re-copy the config with `Copy MCP Config to Clipboard`.

**Multiple VS Code windows:** the MCP server binds a single localhost port, so only one window can host it — the first window to bind owns the `/mcp` endpoint, and the server exposes **that window's** active Rewst sessions. Other windows still try to start the server but lose the port bind; their sessions are not reachable over MCP while another window owns it. Tools that take an `orgId` resolve it among the owning window's sessions, so to expose a particular org through MCP, make sure that org's session is signed in in the window that owns the server (close the owning window to let another take over the port).

### Working scope

The **working scope** narrows which orgs (and, optionally, which workflows) Rewst tools may operate on — the same gate for Cage-Free Rewsty's in-process tools and for external MCP clients. It is the reliable, model-immutable blast-radius cap: a tool call targeting an org outside the scope is rejected, so a confused or poisoned model can't escape to another org by naming one. (When a call omits the org and exactly one is pinned, that org is used.)

Set it with the **Rewst Scope** status bar item (bottom-left) or the `Set Working Scope` command, which lists every org your sessions manage for a multi-select. The scope holds multiple orgs and workflows, so you can deliberately work across several at once. `Clear Working Scope` empties it.

How the scope is enforced:

- **Writes** must target an org in the effective allowed set — the working orgs plus `rewst-buddy.mcp.alwaysAllowedOrgs`. With nothing pinned and none always-allowed, writes are blocked. When a working **workflow** is pinned, a write that edits a workflow must target one in scope.
- **Reads** are limited to the effective set only under strict scope (`rewst-buddy.mcp.workingOrgScope` = `strict`, the default) and only once a working org is pinned. With nothing pinned, reads span all orgs so you can browse and choose; set the mode to `writes` to keep reads cross-org even when a working org is pinned.
- **Org discovery** (`list_orgs`, `get_working_scope`) is never scoped, so you can always find an org and pin it.
- **`alwaysAllowedOrgs`** is a persistent standing allowance — orgs that are always in scope without re-pinning (e.g. a sandbox). It replaces the former `writeOrgAllowlist`; old values are still read.

An AI assistant can read the scope with `get_working_scope` and _request_ a change with `set_working_scope`, but the change only applies after you confirm a VS Code modal — to work on a different org or workflow, the model asks, and you approve, rather than the model widening its own reach.

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
