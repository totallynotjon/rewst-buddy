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

1. Open the Chat view (or run `Rewst Buddy: Ask Rewst AI` from the command palette)
2. Type `@rewst` followed by your question, e.g. `@rewst how do I parse JSON in a Jinja template?`
3. Watch progress updates (thinking, searching documentation, running tools) while the answer streams in

**Behavior:**

- **Multi-turn** — follow-up questions in the same chat session continue the same Rewst conversation, with full server-side memory
- **Resume previous conversations** — type `@rewst /resume` to pick from your recent Rewst conversations (the same history you see in the Rewst web app). The transcript loads into the chat and follow-ups continue that conversation with its full server-side memory. Add a question after `/resume` to pick and ask in one step
- **Workspace tools** — RoboRewsty can inspect your workspace on its own: list files, read files, search text, see open editors, open files for you, read VS Code diagnostics, search code symbols and file outlines, and list which files are linked to Rewst templates. When it needs information it requests a tool, the extension runs it locally (workspace-scoped, output-capped) and sends the result back, looping until it can answer — each round renders a _Workspace activity_ list with clickable links to every file it touched, and accessed files are attached as references on the response. Your first message also includes a small workspace overview (folder names and top-level entries). Tool results are sent to the Rewst AI assistant; disable with `rewst-buddy.ai.enableWorkspaceTools` if your workspace contains content you don't want shared, and cap the loop with `rewst-buddy.ai.maxToolRounds` (default 4; `0` = unlimited — each round is a full assistant turn, so cancel with the stop button if it wanders)
- **Edit tools** — RoboRewsty can also act: `edit_file` (targeted find/replace), `write_file` (create or rewrite a file), and `open_file`. Edits to existing files are applied to the buffer but left **unsaved**, so you review them in the editor (and can undo) before saving — sync-on-save can't fire until you save. New files are created directly. Every edit renders an added/removed diff right in the chat (with a `+N −M` summary in the activity list), so you see exactly what changed without leaving the conversation. Disable with `rewst-buddy.ai.enableEditTools`
- **Web tools (opt-in)** — set `rewst-buddy.ai.enableWebTools` to `true` to let RoboRewsty search the public web (`web_search`) and read pages (`fetch_url`). Off by default because the assistant chooses what to fetch — enabling it lets a remote model direct network requests from your machine. Only http(s) is allowed and private/loopback hosts are always blocked
- **Command tool (opt-in, approval required)** — set `rewst-buddy.ai.enableCommandTool` to `true` to let RoboRewsty run shell commands in your workspace root (`run_command`) and read their output — e.g. "what ports are listening?", running a script, or checking `git status`. Off by default and, when enabled, **every command pops an approval dialog showing exactly what will run** before it executes; decline and it won't retry. Set `rewst-buddy.ai.autoApproveCommands` to skip the prompt only if you fully trust what the remote assistant may propose. Commands run in the first workspace folder with a 60s timeout and capped output
- **Attached context** — files attached via the paperclip or `#file`, and editor selections, are included in the question (size-capped; oversized attachments are truncated)
- **Apply suggestions** — when an answer contains code blocks, an **Apply to <file>** button appears (targeting the attached or active file). It opens a diff of the current file vs the suggestion; confirm to apply. The edit is left unsaved so you can review — sync-on-save only fires when you save
- **Custom instructions** — set `rewst-buddy.ai.customInstructions` to prepend standing instructions (answer style, environment details) to every question. Sent as part of your message, so it can't override Rewst's own system prompt
- **Sources** — documentation citations are attached as references on the response
- **Organization selection** — with one active session, your primary organization is used automatically; with multiple sessions you pick once per chat session
- **Conversations live in Rewst** — every exchange is a real Rewst conversation, also visible in the Rewst web app's chat history
- **Latency** — full answers typically take 20–40 seconds; the assistant runs documentation-search tools mid-stream, so progress updates are normal
- Cancel any time with the stop button

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
