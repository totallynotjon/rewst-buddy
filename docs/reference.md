# Reference

Commands, settings, and UI panels. For feature details, see [Features](features.md).

## Sidebar

Click the Rewst Buddy icon in the activity bar to open the sidebar:

- **Session Panel**: Enter your token/cookie to connect
- **Sessions**: View all known sessions with organization and region info
    - Active sessions display with green checkmark icon
    - Expired sessions display with red error icon
    - Sessions automatically refresh every 15 minutes to stay active
    - With automatic refresh, sessions can stay alive for about 1 week with daily extension use

## Template Bundles Panel

Located in the Explorer sidebar, the **Template Bundles** panel groups related templates by dependency:

- Organized by organization, then by bundle
- Each bundle shows the root template and all templates it references (directly or transitively)
- Shared templates appear in every bundle that references them
- Standalone templates (no references) listed in a separate section
- Click any entry to open the real file — all existing sync behavior works unchanged
- Refresh button in the panel header to manually rebuild bundles

## Status Bar

When editing a linked template, a status indicator appears in the **bottom-left corner** of VS Code:

- Shows sync-on-save status: **ON** (with checkmark) or **OFF** (with warning icon)
- **Click the status bar item to toggle sync-on-save** for the current file
- Hover for detailed tooltip with template name, description, and organization
- Displays error indicator if no active session exists for the template's organization

The status bar item hides when viewing non-linked files.

## Commands

All commands are available via Command Palette (Cmd/Ctrl + Shift + P) under the `Rewst Buddy:` prefix.

**Session Management**

- `New Rewst Session` — Add a new session with token
- `Clear Sessions` — Remove all saved sessions

**Folder Operations**

- `Link Folder to Organization` — Link folder to organization (automatically downloads all templates)
- `Unlink Folder from Organization` — Remove folder link
- `Fetch Folder` — Manually check for and download new templates (runs automatically every 15 minutes)

**Template Operations (Interactive)**

- `Open Template` — Browse and open templates via picker
- `Link File to Template` — Link current file via template picker
- `Create Template` — Create a new template on Rewst from the current file and link it
- `Copy Template ID` — Copy linked template ID to clipboard
- `Open in Rewst` — Open linked template in the Rewst web app

**Template Operations (URL-based)**

- `Open Template from URL` — Open a template directly from URL
- `Link File to Template from URL` — Link current file using a URL

**Template Bundles**

- `Bundle Templates` — Rebuild template bundle groupings

**Sync & Maintenance**

- `Sync Template` — Push changes with conflict detection
- `Enable Sync-On-Save` — Enable automatic sync for current file
- `Disable Sync-On-Save` — Disable automatic sync for current file
- `Unlink from Template` — Remove template link from current file
- `Unlink All Templates` — Remove all file-to-template associations
- `Delete Template` — Delete the linked template on Rewst (with confirmation) and unlink

**AI Assistant**

- `Ask Rewst AI` — Open the Chat view; pick **Cage-Free Rewsty** in the model picker to talk to Rewst's AI assistant (`Ctrl+Alt+R` / `Cmd+Alt+R`)
- `Resume Rewst AI Conversation` — Pick a previous Rewst conversation and open its transcript
- `Apply Rewst AI Suggestion` — Apply a code block from the latest Cage-Free Rewsty answer to the active file behind a diff preview

**Server**

- `Start Server` — Start the session receiver server

## Settings

All settings live under the `rewst-buddy.*` namespace. Edit via VS Code Settings (Cmd/Ctrl + ,) → search "rewst-buddy", or `settings.json` directly.

| Setting                               | Type      | Default                                                     | Description                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rewst-buddy.regions`                 | `array`   | `[{North America, appSession, api.rewst.io, app.rewst.io}]` | Regional configuration for different Rewst instances. See [Multi-Region Setup](#multi-region-setup).                                                                                                                                                                                                                                                          |
| `rewst-buddy.syncOnSaveByDefault`     | `boolean` | `false`                                                     | When enabled, all linked files sync on save by default (use Disable Sync-On-Save to exclude specific files). When disabled, files only sync when explicitly enabled.                                                                                                                                                                                          |
| `rewst-buddy.autoFetchOnOpen`         | `boolean` | `true`                                                      | When enabled, automatically fetch remote template updates when opening linked files. Only applies changes if the local file hasn't been modified since the last sync.                                                                                                                                                                                         |
| `rewst-buddy.server.enabled`          | `boolean` | `true`                                                      | Enable the local HTTP server to receive session tokens from browser extensions.                                                                                                                                                                                                                                                                               |
| `rewst-buddy.server.port`             | `number`  | `27121`                                                     | Port number for the local HTTP server (range 1024–65535).                                                                                                                                                                                                                                                                                                     |
| `rewst-buddy.server.host`             | `string`  | `127.0.0.1`                                                 | Host address to bind the server (default `127.0.0.1` for localhost-only access).                                                                                                                                                                                                                                                                              |
| `rewst-buddy.ai.conversationType`     | `string`  | `HELP_DOCS`                                                 | Conversation type sent to the Rewst AI assistant (`HELP_DOCS` or `WORKFLOW_DIAGNOSIS`).                                                                                                                                                                                                                                                                       |
| `rewst-buddy.ai.customInstructions`   | `string`  | `""`                                                        | Standing instructions prepended to every message sent to the Rewst AI assistant. Sent as part of your message — cannot override Rewst's own system prompt.                                                                                                                                                                                                    |
| `rewst-buddy.ai.showActivity`         | `boolean` | `true`                                                      | Show Cage-Free Rewsty's live activity (documentation searches, tool calls, and the context-window usage indicator) as it works, instead of only a spinner until the answer arrives.                                                                                                                                                                                                                |
| `rewst-buddy.ai.enableWorkspaceTools` | `boolean` | `true`                                                      | Let Cage-Free Rewsty see a compact workspace overview (folder names and top-level entries) and the list of files linked to Rewst templates. Sent to the Rewst AI assistant — disable if you don't want workspace structure shared. File reading, editing, search, and terminal access come from VS Code's built-in agent-mode tools, not from this extension. |
| `rewst-buddy.ai.enableWebTools`       | `boolean` | `false`                                                     | Let Cage-Free Rewsty search the public web. The assistant directs the requests, so this is opt-in; private/loopback hosts are always blocked. Opening result pages uses VS Code's built-in fetch tool.                                                                                                                                                        |
| `rewst-buddy.ai.maxToolRounds`        | `number`  | `4`                                                         | Legacy — no effect since Cage-Free Rewsty became a chat model: VS Code's chat now runs the tool loop and owns its limits. Kept so existing settings files don't warn.                                                                                                                                                                                         |
| `rewst-buddy.ai.enableGraphqlTool`    | `boolean` | `false`                                                     | Let Cage-Free Rewsty compose and run GraphQL operations against your Rewst instance using your session. Queries run directly; mutations always require your approval in a dialog showing the full operation.                                                                                                                                                  |

## Multi-Region Setup

For non-NA Rewst instances, configure custom regions in VS Code settings:

1. Open VS Code Settings (Cmd/Ctrl + ,)
2. Search for "rewst-buddy"
3. Edit "Regions" array to add your instance:

```json
{
	"rewst-buddy.regions": [
		{
			"name": "North America",
			"cookieName": "appSession",
			"graphqlUrl": "https://api.rewst.io/graphql",
			"loginUrl": "https://app.rewst.io"
		},
		{
			"name": "Europe",
			"cookieName": "appSession",
			"graphqlUrl": "https://api.eu.rewst.io/graphql",
			"loginUrl": "https://app.eu.rewst.io"
		}
	]
}
```

Each region entry requires `name`, `cookieName`, `graphqlUrl`, and `loginUrl`. An optional `subscriptionsUrl` sets the WebSocket endpoint used by the AI assistant; when omitted it is derived from `graphqlUrl` (e.g. `https://api.rewst.io/graphql` → `wss://api.rewst.io/subscriptions`).
