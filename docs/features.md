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

Talk to Rewst's AI assistant (the same RoboRewsty that powers the in-app chat) directly from VS Code's Chat view.

**Usage:**

1. Open the Chat view (or run `Rewst Buddy: Ask Rewst AI` — `Ctrl+Alt+R` / `Cmd+Alt+R`)
2. Type `@rewst` followed by your question, e.g. `@rewst how do I parse JSON in a Jinja template?`
3. Watch progress updates (thinking, searching documentation, running tools) while the answer streams in

### Conversations

- **Multi-turn** — follow-up questions in the same chat session continue the same Rewst conversation, with full server-side memory
- **Resume** — `@rewst /resume` lists your recent Rewst conversations (the same history as the Rewst web app), loads the picked transcript into the chat, and pins follow-ups to it. Add a question after `/resume` to pick and ask in one step
- **Lives in Rewst** — every exchange is a real Rewst conversation, also visible in the web app's chat history
- **Organization** — with one active session, your primary organization is used automatically; with multiple sessions you pick once per chat session
- **Latency** — full answers typically take 20–40 seconds; progress updates stream while the assistant works. Cancel any time with the stop button

### Workspace tools

RoboRewsty can inspect your workspace on its own: list, read, search, and open files; see open editors; read diagnostics; look up code symbols and file outlines; and list template links. The extension runs each requested tool locally (workspace-scoped, output-capped) and sends the result back, looping until it can answer.

- Each round renders a _Workspace activity_ list with clickable links to every file touched; accessed files are attached as references on the response
- Your first message includes a small workspace overview (folder names and top-level entries)
- Tool results are sent to the Rewst AI assistant — disable with `rewst-buddy.ai.enableWorkspaceTools` if your workspace contains content you don't want shared
- `rewst-buddy.ai.maxToolRounds` caps the loop (default 4; `0` = unlimited — cancel with the stop button if it wanders)

### Edit tools

RoboRewsty can also act on files: `edit_file` (targeted find/replace), `write_file` (create or rewrite), and `open_file`.

- Edits to existing files are left **unsaved** so you can review (and undo) before saving — sync-on-save can't fire until you save. New files are created directly
- Every edit renders an added/removed diff in the chat with a `+N −M` summary
- Disable with `rewst-buddy.ai.enableEditTools`

### Opt-in tools

Off by default because they let a remote assistant direct activity on your machine:

- **Web** (`rewst-buddy.ai.enableWebTools`) — `web_search` and `fetch_url` for public pages. Only http(s) is allowed; private/loopback hosts are always blocked
- **Commands** (`rewst-buddy.ai.enableCommandTool`) — `run_command` runs shell commands in your workspace root (60s timeout, capped output). When enabled, **every command pops an approval dialog showing exactly what will run**; decline and it won't retry. `rewst-buddy.ai.autoApproveCommands` skips the prompt — leave it off unless you fully trust what the assistant may propose

### Approving Rewst actions

Some of RoboRewsty's own Rewst-side actions require your approval before they run. When one comes up, the chat shows **what** it wants to run (the tool name and its arguments) with inline **Approve** and **Always allow** buttons — no more leaving VS Code to approve in the Rewst web app. **Approve** runs it once and the answer continues; **Always allow "<tool>"** approves it now and remembers your choice in your Rewst preferences so that tool stops asking. The Rewst web app stays available as a fallback.

### Context and answers

- **Attached context** — files attached via the paperclip or `#file`, and editor selections, are included in the question (size-capped)
- **Apply suggestions** — code blocks in answers get an **Apply to <file>** button that opens a diff; confirm to apply, and the edit stays unsaved for review
- **Custom instructions** — `rewst-buddy.ai.customInstructions` prepends standing instructions to every question (sent as part of your message, so it can't override Rewst's system prompt)
- **Sources** — documentation citations are attached as references on the response

> Requires VS Code's Chat view (available when a chat provider such as GitHub Copilot is set up). The conversation type can be changed via the `rewst-buddy.ai.conversationType` setting.

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
