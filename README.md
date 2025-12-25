# rewst-buddy - VS Code Extension

Lightweight VS Code extension for quick template editing and syncing with Rewst. Link local files to Rewst templates via URL and sync changes with conflict detection, just simple status bar buttons for fast template operations.

> **Note**: This is a community tool focusing on direct template editing workflows for users who already know which templates they need to work with.

## Features

### Core Capabilities
- **Session-Based Authentication**:
  Securely connect to Rewst instances using session tokens stored in VS Code secrets
- **Multi-Region Support**:
  Configure regional endpoints for different Rewst instances (NA, EU, etc.)
- **Template Linking**:
  Link any local file to a Rewst template via URL with automatic metadata fetching
- **Smart Syncing**:
  Sync local changes to Rewst with timestamp-based conflict detection
- **Status Bar Integration**:
  Quick-access buttons appear in status bar for linking and syncing operations

### Template Operations
- **Open from URL**: Open Rewst templates directly from their URL—auto-downloads content and links file
- **Link Template**: Connect existing files to Rewst templates for ongoing editing
- **Sync Template**: Push local changes with conflict detection (force override or download latest options)
- **Create Template**: Placeholder for future template creation functionality

### Workflow
1. Add a Rewst session via command palette (stores token securely)
2. Open a template from URL or link an existing file to a template
3. Edit in VS Code with your preferred editor settings
4. Click "Sync Template" button to push changes (handles conflicts gracefully)
5. Continue editing—links persist between VS Code sessions

> **Session Note**: Tokens are stored securely in VS Code's secret storage and sessions can be cleared via commands.

### Planned Features

**Template Creation**
- Create new templates directly from VS Code
- Save local files as new Rewst templates with one button

**Auto-Sync on Save**
- Optional automatic sync when saving files
- Configurable per workspace or globally

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

## Requirements

### Critical Prerequisites
- **Rewst Account**: Active account on any Rewst instance
- **Session Token Access**: Ability to retrieve your session token from browser storage or network requests
- **Template URLs**: Knowledge of specific template URLs you need to edit

> :warning: **Security Notice**
> This extension uses session tokens for GraphQL API access:
> - **Unofficial community tool** - not affiliated with Rewst LLC
> - **Tokens stored in VS Code secret storage** - secure but persists as long as your Rewst session would
> - **Inherits your Rewst permissions** - can modify any templates you can access
> - **Recommended for advanced users** familiar with API authentication

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

### Logging Configuration
- `rewst-buddy.maxLogSize` - Max log file size in KB before rotation (default: 1000)
- `rewst-buddy.maxLogFiles` - Max number of log files to keep (default: 7)

## Current Limitations

- **No template browsing**: Requires knowing template URLs (no discovery interface yet)
- **Manual sync only**: Auto-sync on save is planned but not yet implemented
- **No bulk import**: Pull all templates feature is planned
- **Manual token refresh**: Must re-add sessions after token expiration

## Roadmap

### v1.0 Goals
- [x] Session token management
- [x] Template linking via URL
- [x] Conflict-aware syncing
- [x] Open from URL
- [x] Status bar UI
- [ ] Create new templates
- [ ] Auto-sync on save option

### Future Enhancements
- Browser extension integration
- Smart re-linking after renames
- Bulk template download
- Folder synchronization
- Template discovery interface

## Support & Feedback
- Report issues: [GitHub Issues](https://github.com/Brostash/rewst-buddy/issues)
- Feature requests welcome

---

## Release Notes

### v0.10.0 (Current)
**Streamlined template linking and syncing**

- Session-based authentication with secure token storage
- Template linking system with URL validation and metadata fetching
- Smart conflict detection on sync with user choice (override/download)
- Status bar integration with dynamic buttons
- Open from URL functionality for instant template access
- Multi-region support for global Rewst instances
- Simplified command set focused on core workflows (7 commands)
- Persistent links across VS Code sessions

---

> **Disclaimer**: This is an unofficial community tool not affiliated with Rewst LLC. Use at your own risk. Sessions inherit your current Rewst permissions.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)