# VS Code quick start

[← Documentation](README.md) · [MCP setup](mcp-setup.md) · [Chrome walkthrough](browser-extension.md)

Use this guide when you want to edit Rewst templates locally. For AI tool access without an editor, start with the [MCP setup guide](mcp-setup.md).

![Marketplace listing with the Rewst Buddy installation command.](images/vscode-marketplace.png)

Install the [VS Code companion](https://marketplace.visualstudio.com/items?itemName=JBramley.rewst-buddy), then choose an editing workflow.

Two paths are available depending on how much of an organization you want to pull local. Pick one — you can always switch later.

- [Link a Single Template](#link-a-single-template) — tweak one script or HTML snippet (recommended first run)
- [Bulk Folder Workflow](#bulk-folder-workflow) — mirror an entire organization's templates locally
- [Export Workflows](#export-workflows) — select and save workflows as files or signed bundles

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

The [browser companion](browser-extension.md) transfers your session to the shared local server when you reload a signed-in Rewst organization page.

1. Follow the [illustrated Chrome setup](browser-extension.md) and load the `build-chrome/` folder.
2. Start a standalone owner on port 27121, or let VS Code start its own server (`rewst-buddy.server.enabled` is on by default).
3. Reload an organization page in Rewst. A compatible attached VS Code window uses the owner's session.

Session transfer works without VS Code. When VS Code attaches to a standalone owner, storage and policy belong to that owner; its saved cookies are not automatically imported from VS Code. See [sharing a server](mcp-setup.md#sharing-a-server-between-clients).

The owner manages session refresh while it is running. Reauthenticate if Rewst expires or revokes the session. For standalone login across restarts, enable [encrypted persistence](mcp-setup.md#keep-your-login-across-restarts).

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

## Export Workflows

The workflow exporter lets you browse an organization's workflow catalog and save selected workflows locally.

1. Open the Rewst Buddy sidebar and select **Workflow Exporter**, or run `Rewst Buddy: Open Workflow Exporter` from the Command Palette.
2. Choose an organization and wait for its workflow catalog to load.
3. Search or filter the catalog by name, id, tags, or creation/update dates, then select the workflows to export.
4. Choose **Separate files** or **Signed bundle**, select the destination, and click **Start export**.

The exporter shows progress and reports any failed exports or generated output files. It keeps its catalog and selections across view reloads. Each signed bundle file can contain up to **25 workflows**; larger selections are split into multiple bundle files, and existing files are never overwritten. For the command-palette picker, run `Rewst Buddy: Export Workflows`; it follows the same batching, destination, and no-overwrite rules as the sidebar.
