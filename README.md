# Rewst Buddy — Unofficial VS Code Extension for Rewst

> ⚠️ **Unofficial community project.** This extension is not affiliated with, endorsed by, or supported by Rewst LLC. "Rewst" is a trademark of its respective owner. Use at your own risk — for support, open an issue on [GitHub](https://github.com/totallynotjon/rewst-buddy/issues), not with Rewst.

## About

I work with Rewst templates a lot. I built this extension — on my own time, as a community contributor — to make small tweaks and changes to templates easier when developing scripts/HTML in Rewst. Instead of keeping tabs open in a browser, you can edit files directly on your filesystem and get everything VS Code offers: folders, extensions, git, AI agents editing files, and so on.

The extension uses a "Link & Sync" model: link an entire folder to an organization and fetch all templates at once, or link individual templates to local files. Once linked, edits can sync back to Rewst automatically on save.

This extension's sync is safer than editing in browser tabs — before pushing, it pulls the template and verifies it hasn't changed since your last fetch. (The browser just overwrites.)

## Install

Search "rewst-buddy" in the VS Code Extensions view, or install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=JBramley.rewst-buddy).

## Quick Start

### Recommended: Bulk Download Workflow

**1. Set up a session (once a week):**

1. Copy your `appSession` cookie from your browser while logged into Rewst
2. Click the Rewst Buddy icon in the activity bar (sidebar)
3. Paste your session token in the input field and click Connect

Alternatively, use the command palette: `Rewst Buddy: New Rewst Session` (Cmd/Ctrl + Shift + P)

**2. Link a folder to download all templates:**

1. Create or choose a local folder for your templates
2. Right-click the folder in the explorer → **Link Folder to Organization**
3. Select your organization
4. All templates are automatically downloaded and linked (no manual fetch needed)
5. New templates are automatically discovered and fetched every 15 minutes

**3. Edit and sync:**

- Open any downloaded template file and edit
- **Click the status bar item in the bottom-right** to enable sync-on-save for each file
- Once enabled, **save** to auto-sync changes back to Rewst

### Alternative: Individual Template Workflow

If you prefer to work with specific templates rather than downloading everything:

**1. Set up a session** (same as above)

**2. Link a file to a template:**

1. Open or create a local file
2. Right-click in the editor or file explorer → **Link Template**
3. Select your organization and browse/search for the template

**3. Edit and sync:**

- Make your changes and **save** — templates auto-sync on save
- **Click the status bar item in the bottom-right** to toggle sync-on-save per file
- Or right-click → **Sync Template** to manually push changes

**4. Unlink when done:**

- Right-click → **Unlink Template** to remove the association

## Features

### Auto-Sync on Save

By default, sync-on-save is **disabled** — you must enable it per file by clicking the status bar item in the bottom-right corner.

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

### Auto-Fetch on Open

When you open a linked template file with sync-on-save enabled, the extension automatically checks if there are newer changes in Rewst and downloads them if:

- The file hasn't been modified locally since the last sync
- A newer version exists in Rewst

This keeps your local files in sync with Rewst changes made by others, while protecting your local edits from being overwritten.

### Smart Template Opening

When opening templates via `Open Template` or `Open Template from URL`:

- The extension checks if the template is already linked to a local file
- Opens the existing linked file instead of creating a new untitled document
- If linked to multiple files, displays a picker to select which file to open

### File Rename Support

Template links automatically update when you rename or move files — no broken links when reorganizing your workspace.

### Template Navigation

When editing linked template files, you can navigate between templates:

- **Ctrl+Click** (or Cmd+Click on Mac) on `template('UUID')` calls to jump directly to the linked template file
- **Hover** over `template('UUID')` calls to see the template name and organization
- Works with both single and double quoted UUIDs: `template("UUID")` or `template('UUID')`

Note: Navigation only works when both the current file and the referenced template are linked locally.

### Template Bundles

Templates that reference other templates via `{{ template('UUID') }}` are automatically grouped into **bundles** — visible in the Explorer sidebar under "Template Bundles".

- **Automatic dependency detection** — Scans all linked template files for `template('UUID')` references (supports all Jinja brace variants: `{{`, `{{-`, `-}}`, etc.)
- **Bundle grouping** — A "root" template is one that references others but isn't referenced itself. The root and all its descendants (full chain) form a bundle.
- **Shared templates** — Templates referenced by multiple roots appear in every bundle that uses them
- **Circular references** — Handled gracefully as a single bundle
- **Standalone templates** — Templates with no references in or out are listed separately
- **Click to open** — Clicking any template in a bundle opens the real linked file (sync-on-save works as normal)
- **Auto-rebuild** — Bundles automatically update when templates are fetched or links change
- **Manual rebuild** — Use `Rewst Buddy: Bundle Templates` from the command palette to refresh

### Session Receiver Server

A local HTTP server that receives session cookies from the [Rewst Buddy Browser Extension](https://github.com/totallynotjon/rewst-buddy-browser), eliminating the need to manually copy/paste cookies.

**Setup:**

1. Install the browser extension from [GitHub](https://github.com/totallynotjon/rewst-buddy-browser)
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

## Configuration

### Sidebar

Click the Rewst Buddy icon in the activity bar to open the sidebar:

- **Session Panel**: Enter your token/cookie to connect
- **Sessions**: View all known sessions with organization and region info
    - Active sessions display with green checkmark icon
    - Expired sessions display with red error icon
    - Sessions automatically refresh every 15 minutes to stay active
    - With automatic refresh, sessions can stay alive for about 1 week with daily extension use

### Template Bundles Panel

Located in the Explorer sidebar, the **Template Bundles** panel groups related templates by dependency:

- Organized by organization, then by bundle
- Each bundle shows the root template and all templates it references (directly or transitively)
- Shared templates appear in every bundle that references them
- Standalone templates (no references) listed in a separate section
- Click any entry to open the real file — all existing sync behavior works unchanged
- Refresh button in the panel header to manually rebuild bundles

### Status Bar

When editing a linked template, a status indicator appears in the **bottom-right corner** of VS Code:

- Shows sync-on-save status: **ON** (with checkmark) or **OFF** (with warning icon)
- **Click the status bar item to toggle sync-on-save** for the current file
- Hover for detailed tooltip with template name, description, and organization
- Displays error indicator if no active session exists for the template's organization

The status bar item hides when viewing non-linked files.

### Commands

All commands are available via Command Palette (Cmd/Ctrl + Shift + P) under the `Rewst Buddy:` prefix.

**Session Management**

- `New Rewst Session` — Add a new session with token
- `Clear Sessions` — Remove all saved sessions

**Folder Operations**

- `Link Folder` — Link folder to organization (automatically downloads all templates)
- `Unlink Folder` — Remove folder link
- `Fetch Folder` — Manually check for and download new templates (runs automatically every 15 minutes)

**Template Operations (Interactive)**

- `Open Template` — Browse and open templates via picker
- `Link Template` — Link current file via template picker
- `Copy Template ID` — Copy linked template ID to clipboard
- `Open in Rewst` — Open linked template in the Rewst web app

**Template Operations (URL-based)**

- `Open Template from URL` — Open a template directly from URL
- `Link Template from URL` — Link current file using a URL

**Template Bundles**

- `Bundle Templates` — Rebuild template bundle groupings

**Sync & Maintenance**

- `Sync Template` — Push changes with conflict detection
- `Enable Sync-On-Save` — Enable automatic sync for current file
- `Disable Sync-On-Save` — Disable automatic sync for current file
- `Unlink Template` — Remove template link from current file
- `Unlink All Templates` — Remove all file-to-template associations

**Server**

- `Start Server` — Start the session receiver server
- `Stop Server` — Stop the session receiver server

### Multi-Region Setup

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

## Security & Authentication

Rewst does not publish a public API, so this extension authenticates the same way the Rewst web app does: with your browser session cookie (`appSession`, or the equivalent cookie for your region — see [Multi-Region Setup](#multi-region-setup)). A planned companion browser extension will automate the cookie transfer for less technical users.

- Your cookie is stored only in VS Code's built-in [SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) (OS-level encrypted storage).
- No data is sent anywhere other than Rewst's own API.
- Sessions inherit your current Rewst permissions — the extension can do nothing you can't already do in the browser.

If you have security concerns, the codebase is MIT-licensed and open for audit — please [open an issue](https://github.com/totallynotjon/rewst-buddy/issues) with any findings.

## Support & Contributing

- **Bugs & feature requests**: [GitHub Issues](https://github.com/totallynotjon/rewst-buddy/issues) (not Rewst support)
- **Source**: [github.com/totallynotjon/rewst-buddy](https://github.com/totallynotjon/rewst-buddy)

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
