# Quick Start

Two paths are available depending on how much of an organization you want to pull local. Pick one — you can always switch later.

- [Link a Single Template](#link-a-single-template) — tweak one script or HTML snippet (recommended first run)
- [Bulk Folder Workflow](#bulk-folder-workflow) — mirror an entire organization's templates locally

Before either path, do the [First-time session setup](#first-time-session-setup).

## First-time session setup

You need an active Rewst session. There are two ways to create one.

### Option A: Paste your cookie (works everywhere)

1. Log in to Rewst in your browser
2. Copy your `appSession` cookie (or the region-equivalent cookie — see [Multi-Region Setup](reference.md#multi-region-setup))
3. Click the Rewst Buddy icon in the activity bar (sidebar)
4. Paste the token in the input field and click **Connect**

Alternatively, run `Rewst Buddy: New Rewst Session` from the Command Palette (Cmd/Ctrl + Shift + P).

### Option B: Companion browser extension (auto-transfer)

The [Rewst Buddy Browser Extension](https://github.com/totallynotjon/rewst-buddy-browser) transfers your session to VS Code automatically when you visit any Rewst page.

> Not yet on the Chrome Web Store — you must sideload it (load unpacked in developer mode). See the [rewst-buddy-browser README](https://github.com/totallynotjon/rewst-buddy-browser) for instructions.

1. Clone or download the browser extension and load it unpacked in your browser's extensions page
2. The VS Code-side server is enabled by default and starts automatically
3. Navigate to any Rewst page — your session transfers without any copy/paste

Sessions auto-refresh every 15 minutes while VS Code is open, so a single setup typically lasts about a week with daily use.

## Link a Single Template

Best when tweaking one script or HTML snippet, or sampling the tool before committing to a full org pull.

**1. Link a file to a template**

1. Open or create a local file
2. Right-click in the editor → **Link File to Template**
3. Select your organization and browse/search for the template

**2. Edit and sync**

- Make your changes and **save** — templates auto-sync on save when enabled
- **Click the status bar item in the bottom-left** to toggle sync-on-save per file
- Or right-click → **Sync Template** to manually push changes

**3. Unlink when done**

- Right-click → **Unlink from Template** to remove the association

## Bulk Folder Workflow

Folder linking downloads **every template** from a chosen organization into a local folder, keeps them auto-synced on save, and fetches newly-created templates every 15 minutes. Use this to maintain a local mirror of an org's entire template library.

**1. Link a folder to download all templates**

1. Create or choose a local folder for your templates
2. Right-click the folder in the explorer → **Link Folder to Organization**
3. Select your organization
4. All templates are automatically downloaded and linked (no manual fetch needed)
5. New templates are automatically discovered and fetched every 15 minutes

**2. Edit and sync**

- Open any downloaded template file and edit
- **Click the status bar item in the bottom-left** to enable sync-on-save for each file
- Once enabled, **save** to auto-sync changes back to Rewst

## Sync-on-save control

Sync-on-save is **off by default** — enable it per file by clicking the status bar item in the bottom-left corner when editing a linked file.

To flip the default globally, set `rewst-buddy.syncOnSaveByDefault: true` in your settings — all linked files sync unless explicitly disabled. See [Auto-Sync on Save](features.md#auto-sync-on-save) for detail.
