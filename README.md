# rewst-buddy - VS Code Extension

## About

I work with Rewst templates a lot. I made this extension to make it easier to make small tweaks and changes to templates when developing scripts/html in Rewst. Instead of having tabs open in a browser, you can make edits directly to files in your filesystem. This means you can have all the power of vscode while managing your Rewst templates: folders, extensions, git, ai agents editing files, etc.

This works by a 'Link & Sync' methodology. You first 'link' a template to a local file. After a file is linked you can then 'sync' it to Rewst.

Our sync should be even safer than using tabs in your browser. As part of a sync operation, we pull the template and make sure it hasn't been edited since the lastest version we got from Rewst. (In your browser it would just override it).

The extension works by using your Rewst cookies and making the calls to Rewst as if from the browser. Your session is linked from the 'appSession' cookie (or a similar cookie if you are in another region, see [Multi-Region Setup](#multi-region-setup)). (I am planning to make a browser extension to automate this process to make it easier and allow less technical users to not get their cookie over and over).

Since Rewst does not expose API keys for working with GraphQL directly, we do rely on using your cookie locally. This is not stored beyond VSCodes secret storage, and no external calls are made beyond to Rewst. If you have security concerns feel free to audit the codebase and raise any issues.

## Quick Start

**Everything requires a session first:**

1. Copy your `appSession` cookie from your browser while logged into Rewst
2. Run command in VS Code: `Rewst Buddy: New Rewst Session`
3. Paste your session token
4. Choose a workflow:
   - `Open Template` - **Browse and select templates** via interactive picker (NEW in v0.14)
   - `Link Template` - Link your current file by browsing templates interactively
   - `Open Template from URL` - Open a template directly from a URL
   - `Link Template from URL` - Link current file using a template URL
5. Edit the file, then click the **Sync Template** button to push changes

### Auto-Sync on Save
By default, linked templates automatically sync to Rewst when you save the file.

To disable automatic syncing:
1. Open VS Code Settings (Cmd/Ctrl + ,)
2. Search for "rewst-buddy"
3. Uncheck "Enable Sync On Save" (or set to false in settings.json)

```json
{
  "rewst-buddy.enableSyncOnSave": false
}
```

When disabled, use the **Sync Template** button or command to manually sync changes.

> Note: Auto-sync performs the same safety checks as manual sync, preventing overwrites if the template was modified in Rewst since your last sync.

### Interactive Template Browsing (v0.14)
Browse and select templates without needing to copy URLs:

1. Run `Open Template` or `Link Template` from the command palette
2. Select your session (auto-selects if you only have one)
3. Choose your organization
4. Search and select from your templates list

### File Rename Support (v0.13)
Template links now automatically update when you rename or move files:
- Rename a linked file → link stays connected
- Move a file to a different folder → link follows
- Rename a folder → all child links update recursively

No more broken links when reorganizing your workspace.


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
Access via Command Palette (Cmd/Ctrl + Shift + P):

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

### Status Bar Buttons
- **Link Template** - Appears when editor is open and file is not linked
- **Sync Template** - Appears when editor has an active template link


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