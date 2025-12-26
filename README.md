# rewst-buddy - VS Code Extension

## Quick Start

**Everything requires a session first:**

1. Copy your `appSession` cookie from your browser while logged into Rewst
2. Run command: `Rewst Buddy: New Rewst Session`
3. Paste your session token when prompted
4. Choose a workflow:
   - `Open Template from URL` - Open and link a template directly (extension command)
   - `Link Template` - Link your current file to an existing template (extension command or **Link Template** in bottom left)
5. Edit the file, then click the **Sync Template** button to push changes

## About

I work with Rewst templates a lot. I made this extension to make it easier to make small tweaks and changes to templates when developing scripts/html in Rewst. Instead of having tabs open in a browser, you can make edits directly to files in your filesystem. This means you can have all the power of vscode while managing your Rewst templates folders, extensions, git, ai agents editing files, etc.

This works by a 'Link & Sync' methodology. You first 'link' a template to a local file. After a file is linked you can then 'sync' it to Rewst.

Our sync should be even safer than using tabs in your browser. As part of a sync operation, we pull the template and make sure it hasn't been edited since the lastest version we got from Rewst. (In your browser it would just override it). We let you know and give you some options.

The extension works by using your Rewst cookies and making the calls to Rewst as if you are in the browser. This is retrieved from the 'appSession' cookie from your browser. (I am planning to make a browser extension to automate this process to make it easier and allow less technical users to not get their cookie over and over).

Since Rewst does not expose API keys for working with GraphQL directly, we do rely on using your cookie locally. This is not stored beyond VSCodes secret storage, and no external calls are made beyond to Rewst. If you have security concerns feel free to audit the codebase and raise any issues.


### Planned Features

**Template Creation**
- Create new templates directly from VS Code
- Save local files as new Rewst templates with one button

**Smart Re-Linking**
- Automatic re-linking after file renames/moves
- Hash-based matching to reconnect templates
- Content-based matching for reliability
- Watch VS Code file operations to maintain links

**Browser Extension Integration**
- Accept session tokens via URI protocol
- Background server for constant connectivity
- Browser extension that automatically shares Rewst cookies
- One-click setup from browser

**Bulk Operations**
- Pull all templates from organization to local folder
- Automatic linking of downloaded templates
- Folder sync: auto-create/link new templates from Rewst
- Organize templates in VS Code as you prefer

## Configuration

### Available Commands
Access via Command Palette (Cmd/Ctrl + Shift + P):
- `Rewst Buddy: New Rewst Session` - New a new session with token
- `Rewst Buddy: Clear Sessions` - Remove all saved sessions
- `Rewst Buddy: Open Template from URL` - Open and link a template directly from URL
- `Rewst Buddy: Link Template` - Link current editor file to a template
- `Rewst Buddy: Sync Template` - Sync current file with linked template
- `Rewst Buddy: Clear Template Links` - Remove all file-to-template associations

### Status Bar Buttons
- **Link Template** - Appears when editor is open and file is not linked
- **Sync Template** - Appears when editor has an active template link

### Auto-Sync on Save
By default, linked templates automatically sync to Rewst when you save the file. This provides a seamless workflow similar to autosave in the browser interface.

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