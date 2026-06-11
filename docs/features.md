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

## Ask Rewst AI (RoboRewsty)

Talk to Rewst's AI assistant (the same RoboRewsty that powers the in-app chat) directly from VS Code's chat — as its own model in the model picker. **No GitHub account or Copilot plan is required**: RoboRewsty carries the chat itself (VS Code 1.122+).

**Usage:**

1. Open the Chat view (or run `Rewst Buddy: Ask Rewst AI` — `Ctrl+Alt+R` / `Cmd+Alt+R`)
2. Pick **RoboRewsty** in the model picker (with multiple Rewst sessions there is one RoboRewsty model per organization)
3. Ask your question, e.g. `how do I parse JSON in a Jinja template?` — the answer streams in

### Conversations

- **Multi-turn** — follow-up questions in the same chat session continue the same Rewst conversation, with full server-side memory; separate chat sessions and organizations stay separate
- **Resume** — `Rewst Buddy: Resume Rewst AI Conversation` (command palette) lists your recent Rewst conversations (the same history as the Rewst web app), opens the picked transcript, and binds your next RoboRewsty chat message to continue it
- **Lives in Rewst** — every exchange is a real Rewst conversation, also visible in the web app's chat history
- **Organization** — each RoboRewsty model is tied to a session's organization; pick the org by picking the model
- **Latency** — full answers typically take 20–40 seconds. Cancel any time with the stop button

### Workspace tools

RoboRewsty can inspect your workspace on its own: list, read, search, and open files; see open editors; read diagnostics; look up code symbols and file outlines; and list template links. Every tool is a native VS Code chat tool — the chat runs each call locally (workspace-scoped, output-capped) and shows its activity inline, looping until RoboRewsty can answer.

- Your first message includes a small workspace overview (folder names and top-level entries)
- Tool results are sent to the Rewst AI assistant — disable with `rewst-buddy.ai.enableWorkspaceTools` if your workspace contains content you don't want shared

### Edit tools

RoboRewsty can also act on files: `edit_file` (targeted find/replace), `write_file` (create or rewrite), and `open_file`.

- Edits to existing files are left **unsaved** so you can review (and undo) before saving — sync-on-save can't fire until you save. New files are created directly
- Disable with `rewst-buddy.ai.enableEditTools`

### Opt-in tools

Off by default because they let a remote assistant direct activity on your machine:

- **Web** (`rewst-buddy.ai.enableWebTools`) — `web_search` and `fetch_url` for public pages. Only http(s) is allowed; private/loopback hosts are always blocked
- **Commands** (`rewst-buddy.ai.enableCommandTool`) — `run_command` runs shell commands in your workspace root (60s timeout, capped output). When enabled, **every command pops an approval dialog showing exactly what will run**; decline and it won't retry. `rewst-buddy.ai.autoApproveCommands` skips the prompt — leave it off unless you fully trust what the assistant may propose
- **GraphQL** (`rewst-buddy.ai.enableGraphqlTool`) — `rewst_graphql` composes and runs GraphQL operations against your Rewst instance using your session, with `rewst_graphql_schema` for exploring the schema. Queries run directly; **mutations always pop an approval dialog showing the full operation**. Off by default because the session can read and change anything you can in Rewst

A tool whose setting is off is never offered to the assistant — even if it appears in the chat's tool picker.

### Approving Rewst actions

Some of RoboRewsty's own Rewst-side actions require your approval before they run. When one comes up, a dialog shows **what** it wants to run (the tool name and its arguments). **Approve** runs it once and the answer continues; **Always Allow** approves it now and remembers your choice in your Rewst preferences so that tool stops asking. The Rewst web app stays available as a fallback.

### Context and answers

- **Attached context** — files attached via the paperclip or `#file`, and editor selections, are included by the chat itself
- **Apply suggestions** — `Rewst Buddy: Apply Rewst AI Suggestion` (command palette) applies a code block from the latest answer to your active file behind a diff preview; confirm to apply, and the edit stays unsaved for review
- **Custom instructions** — `rewst-buddy.ai.customInstructions` prepends standing instructions to every question (sent as part of your message, so it can't override Rewst's system prompt)
- **Sources** — documentation citations are rendered at the end of the answer

> The chat UI is provided by VS Code's built-in chat (the free, open-source Copilot Chat extension) — no GitHub sign-in or Copilot subscription is needed to chat with RoboRewsty. The conversation type can be changed via the `rewst-buddy.ai.conversationType` setting.

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
