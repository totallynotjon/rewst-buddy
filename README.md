# rewst-buddy - VS Code Extension

## About

I work with Rewst templates a lot. I made this extension to make it easier to make small tweaks and changes to templates when developing scripts/html in Rewst. Instead of having tabs open in a browser, you can make edits directly to files in your filesystem. This means you can have all the power of vscode while managing your Rewst templates: folders, extensions, git, ai agents editing files, etc.

This works by a 'Link & Sync' methodology. You first 'link' a template to a local file. After a file is linked you can then 'sync' it to Rewst.

Our sync should be even safer than using tabs in your browser. As part of a sync operation, we pull the template and make sure it hasn't been edited since the lastest version we got from Rewst. (In your browser it would just override it).

The extension works by using your Rewst cookies and making the calls to Rewst as if from the browser. Your session is linked from the 'appSession' cookie (or a similar cookie if you are in another region, see [Multi-Region Setup](#multi-region-setup)). (I am planning to make a browser extension to automate this process to make it easier and allow less technical users to not get their cookie over and over).

Since Rewst does not expose API keys for working with GraphQL directly, we do rely on using your cookie locally. This is not stored beyond VSCodes secret storage, and no external calls are made beyond to Rewst. If you have security concerns feel free to audit the codebase and raise any issues.

## Quick Start

**1. Set up a session (one-time):**

1. Copy your `appSession` cookie from your browser while logged into Rewst
2. Click the Rewst Buddy icon in the activity bar (sidebar)
3. Paste your session token in the input field and click Connect

Alternatively, use the command palette: `Rewst Buddy: New Rewst Session` (Cmd/Ctrl + Shift + P)

**2. Link a file to a template:**

1. Open or create a local file
2. Right-click in the editor or file explorer → **Link Template**
3. Select your organization and browse/search for the template

**3. Edit and sync:**

- Make your changes and **save** - templates auto-sync on save by default
- Or right-click → **Sync Template** to manually push changes

**4. Unlink when done:**

- Right-click → **Unlink Template** to remove the association

The status bar shows whether the current file is **Linked** or **Unlinked**. Hover for template details.

### Auto-Sync on Save

By default, linked templates automatically sync to Rewst when you save. To disable:

```json
{
	"rewst-buddy.enableSyncOnSave": false
}
```

> Auto-sync performs the same safety checks as manual sync, preventing overwrites if the template was modified in Rewst since your last sync.

### File Rename Support

Template links automatically update when you rename or move files - no broken links when reorganizing your workspace.

### Session Receiver Server (v0.15)

A local HTTP server that can receive session cookies from a browser extension, eliminating the need to manually copy/paste cookies.

**How it works:**

1. Server listens on `127.0.0.1:27121` (localhost only for security)
2. Browser extension sends your Rewst cookies to the server
3. Session is created automatically in VS Code

**Configuration:**

```json
{
	"rewst-buddy.server.enabled": true,
	"rewst-buddy.server.port": 27121,
	"rewst-buddy.server.host": "127.0.0.1"
}
```

The server is enabled by default. Use `Start Server` / `Stop Server` commands for manual control.

### Planned Features

**Template Creation**

- Create new templates directly from VS Code
- Save local files as new Rewst templates with one button

**Browser Extension**

- Browser extension that automatically sends Rewst cookies to the session receiver
- One-click session setup from browser

**Bulk Operations**

- Pull all templates from organization to local folder
- Automatic linking of downloaded templates
- Folder sync: auto-create/link new templates from Rewst
- Organize templates in VS Code as you prefer

## Configuration

### Available Commands

All commands are also available via Command Palette (Cmd/Ctrl + Shift + P):

**Session Management**

- `New Rewst Session` - Add a new session with token
- `Clear Sessions` - Remove all saved sessions

**Template Operations (Interactive)**

- `Open Template` - Browse and open templates via picker (v0.14)
- `Link Template` - Link current file via template picker (v0.14)

**Template Operations (URL-based)**

- `Open Template from URL` - Open a template directly from URL
- `Link Template from URL` - Link current file using a URL

**Sync & Maintenance**

- `Sync Template` - Push changes with conflict detection
- `Unlink Template` - Remove template link from current file
- `Unlink All Templates` - Remove all file-to-template associations

**Server**

- `Start Server` - Start the session receiver server
- `Stop Server` - Stop the session receiver server

### Sidebar (v0.20)

Click the Rewst Buddy icon in the activity bar to open the sidebar:

- **Session Panel**: Enter your token/cookie to connect
- **Active Sessions**: View all connected sessions with organization and region info

### Status Bar

- Shows **Linked** or **Unlinked** status with icon
- Hover for tooltip with template details (name, description, organization, session info)

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
