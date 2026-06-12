# Rewst Buddy — Unofficial VS Code Extension for Rewst

> ⚠️ **Unofficial community project.** This extension is not affiliated with, endorsed by, or supported by Rewst LLC. "Rewst" is a trademark of its respective owner. Use at your own risk — for support, open an issue on [GitHub](https://github.com/totallynotjon/rewst-buddy/issues), not with Rewst.

## About

Edit Rewst templates locally in VS Code instead of juggling browser tabs. Link a local file to a Rewst template, edit it with full editor tooling (git, extensions, AI agents), and sync changes back on save — with conflict detection so you don't overwrite someone else's edits.

See the [Quick Start](docs/quickstart.md) for first-time setup.

## Install

Search "rewst-buddy" in the VS Code Extensions view, or install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=JBramley.rewst-buddy).

## Quick Start

### 1. Connect a session

- Click the Rewst Buddy icon in the activity bar
- Paste your `appSession` cookie → **Connect**
- _(Or use the companion browser extension — see [Quick Start docs](docs/quickstart.md#first-time-session-setup).)_

### 2. Link a single template

- Open or create a local file
- Right-click in the editor → **Link File to Template**
- Pick your organization and the template

### 3. Edit and sync

- Edit the file
- Click the status bar item (bottom-left) to enable sync-on-save
- **Save** → change syncs to Rewst (with conflict detection)

Want to pull in **every template** from an organization at once? See the [Bulk Folder Workflow](docs/quickstart.md#bulk-folder-workflow).

## Features at a glance

- Auto-sync on save with conflict detection
- Cage-Free Rewsty chat model — Rewst's AI assistant (RoboRewsty) right in VS Code's chat model picker, **no GitHub account or Copilot plan needed**; it can read, search, and edit your workspace files to ground its answers
- Auto-fetch on open — picks up remote changes when you open a file
- `Ctrl+Click` template navigation + hover info on `template('UUID')` calls
- Template bundles — dependency-based grouping in the Explorer sidebar
- Smart template opening — reuses existing linked files instead of creating untitled docs
- File rename support + automatic stale link cleanup
- Browser extension integration (sideload — not yet on the Chrome Web Store)
- Multi-region support

Full detail → [docs/features.md](docs/features.md).

## Security & Authentication

Rewst does not publish a public API, so this extension authenticates the same way the Rewst web app does: with your browser session cookie (`appSession`, or the equivalent cookie for your region — see [Multi-Region Setup](docs/reference.md#multi-region-setup)). A companion [browser extension](https://github.com/totallynotjon/rewst-buddy-browser) automates the cookie transfer (sideload required — not yet on the Chrome Web Store).

- Your cookie is stored only in VS Code's built-in [SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) (OS-level encrypted storage).
- No data is sent anywhere other than Rewst's own API.
- Sessions inherit your current Rewst permissions — the extension can do nothing you can't already do in the browser.

If you have security concerns, the codebase is MIT-licensed and open for audit — please [open an issue](https://github.com/totallynotjon/rewst-buddy/issues) with any findings.

## Configuration

Commands, settings, sidebar/status-bar walkthroughs, and multi-region setup: [docs/reference.md](docs/reference.md).

## Support & Contributing

- **Bugs & feature requests**: [GitHub Issues](https://github.com/totallynotjon/rewst-buddy/issues) (not Rewst support)
- **Source**: [github.com/totallynotjon/rewst-buddy](https://github.com/totallynotjon/rewst-buddy)

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
