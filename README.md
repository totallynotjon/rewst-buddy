# rewst-buddy - VS Code Extension

## About

I work with Rewst templates a lot. I made this extension to make it easier to make small tweaks and changes to templates when developing scripts/html in Rewst. Instead of having tabs open in a browser, you can make edits directly to files in your filesystem. This means you can have all the power of vscode while managing your Rewst templates: folders, extensions, git, ai agents editing files, etc.

This works by a 'Link & Sync' methodology. You can link an entire folder to an organization and fetch all templates at once, or link individual templates to local files. After files are linked, edits can automatically sync to Rewst on save.

Our sync should be even safer than using tabs in your browser. As part of a sync operation, we pull the template and make sure it hasn't been edited since the latest version we got from Rewst. (In your browser it would just override it).

The extension works by using your Rewst cookies and making the calls to Rewst as if from the browser. Your session is linked from the 'appSession' cookie (or a similar cookie if you are in another region, see [Multi-Region Setup](#multi-region-setup)). (I am planning to make a browser extension to automate this process to make it easier and allow less technical users to not get their cookie over and over).

Since Rewst does not expose API keys for working with GraphQL directly, we do rely on using your cookie locally. This is not stored beyond VSCodes secret storage, and no external calls are made beyond to Rewst. If you have security concerns feel free to audit the codebase and raise any issues.

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

- Make your changes and **save** - templates auto-sync on save
- **Click the status bar item in the bottom-right** to toggle sync-on-save per file
- Or right-click → **Sync Template** to manually push changes

**4. Unlink when done:**

- Right-click → **Unlink Template** to remove the association

### Auto-Sync on Save

By default, sync-on-save is **disabled** - you must enable it per file by clicking the status bar item in the bottom-right corner.

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

### Auto-Fetch on Open (v0.27)

When you open a linked template file with sync-on-save enabled, the extension automatically checks if there are newer changes in Rewst and downloads them if:

- The file hasn't been modified locally since the last sync
- A newer version exists in Rewst

This keeps your local files in sync with Rewst changes made by others, while protecting your local edits from being overwritten.

### Smart Template Opening (v0.29)

When opening templates via `Open Template` or `Open Template from URL`:

- The extension checks if the template is already linked to a local file
- Opens the existing linked file instead of creating a new untitled document
- If linked to multiple files, displays a picker to select which file to open

### File Rename Support

Template links automatically update when you rename or move files - no broken links when reorganizing your workspace.

### Session Receiver Server (v0.15)

A local HTTP server that receives session cookies from the [Rewst Buddy Browser Extension](https://github.com/totallynotjon/rewst-buddy-browser), eliminating the need to manually copy/paste cookies.

**Setup:**

1. Install the browser extension from [GitHub](https://github.com/totallynotjon/rewst-buddy-browser)
2. The VS Code server starts automatically (enabled by default)
3. Navigate to any Rewst page - your session transfers automatically

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

### Available Commands

All commands are also available via Command Palette (Cmd/Ctrl + Shift + P):

**Session Management**

- `New Rewst Session` - Add a new session with token
- `Clear Sessions` - Remove all saved sessions

**Folder Operations (v0.26)**

- `Link Folder` - Link folder to organization (automatically downloads all templates)
- `Unlink Folder` - Remove folder link
- `Fetch Folder` - Manually check for and download new templates (runs automatically every 15 minutes)

**Template Operations (Interactive)**

- `Open Template` - Browse and open templates via picker (v0.14)
- `Link Template` - Link current file via template picker (v0.14)
- `Copy Template ID` - Copy linked template ID to clipboard (v0.25)

**Template Operations (URL-based)**

- `Open Template from URL` - Open a template directly from URL
- `Link Template from URL` - Link current file using a URL

**Sync & Maintenance**

- `Sync Template` - Push changes with conflict detection
- `Enable Sync-On-Save` - Enable automatic sync for current file
- `Disable Sync-On-Save` - Disable automatic sync for current file
- `Unlink Template` - Remove template link from current file
- `Unlink All Templates` - Remove all file-to-template associations

**Server**

- `Start Server` - Start the session receiver server
- `Stop Server` - Stop the session receiver server

### Sidebar (v0.20)

Click the Rewst Buddy icon in the activity bar to open the sidebar:

- **Session Panel**: Enter your token/cookie to connect
- **Sessions**: View all known sessions with organization and region info
    - Active sessions display with green checkmark icon
    - Expired sessions display with red error icon
    - Sessions automatically refresh every 15 minutes to stay active
    - With automatic refresh, sessions can stay alive for about 1 week with daily extension use

### Status Bar (v0.27)

When editing a linked template, a status indicator appears in the **bottom-right corner** of VS Code:

- Shows sync-on-save status: **ON** (with checkmark) or **OFF** (with warning icon)
- **Click the status bar item to toggle sync-on-save** for the current file
- Hover for detailed tooltip with template name, description, and organization
- Displays error indicator if no active session exists for the template's organization

The status bar item hides when viewing non-linked files.

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

> **Disclaimer**: This is an unofficial community tool not affiliated with Rewst LLC. Use at your own risk. Sessions inherit your current Rewst permissions.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
