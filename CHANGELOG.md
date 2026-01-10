# Changelog

## [0.32.1] - 2026-01-10

### Changed

- **Non-blocking Persistence** - LinkManager and SyncOnSaveManager now use fire-and-forget saves
    - State changes persist without blocking the UI
    - Simplified internal API with auto-save on mutations

### Fixed

- **Template URL Error Message** - Corrected path pattern in error message from `/(:orgId)/templates/` to `/organizations/(:orgId)/templates/`

## [0.32.0] - 2026-01-06

### Changed

- **Batch Mode for Folder Fetch** - Significantly improved performance when fetching folders with many templates
    - Templates are now written in parallel chunks of 20 instead of sequentially
    - Link saves are batched and deferred until all templates are processed
    - Added `reservedUris` tracking to prevent filename collisions during parallel writes
    - Single save + event emission at the end instead of per-template

- **O(1) Sync-On-Save Lookups** - Optimized sync state checking from O(n) to O(1)
    - Inclusions and exclusions now cached as in-memory Sets
    - `enableSync()` and `disableSync()` now save in parallel instead of sequentially

## [0.30.2] - 2026-01-06

### Fixed

- **Autofetch** - Templates created from folder sync now properly track file stats for autofetch

## [0.30.1] - 2026-01-06

### Fixed

- **Package Size** - Fixed `.vscodeignore` including 4,400+ `.d.ts` files from node_modules
- **Filename Sanitization** - Template filenames now sanitize characters invalid on Windows/Linux (`<>:"/\|?*`)

## [0.30.0] - 2026-01-06

### Changed

- **Flexible Sync-On-Save Control** - Refactored sync-on-save to support both opt-in and opt-out modes
    - New `syncOnSaveByDefault` setting (replaces `enableSyncOnSave`) controls default behavior
    - When enabled: all linked files sync unless explicitly disabled (exclusion mode)
    - When disabled (default): files only sync when explicitly enabled (inclusion mode)
    - Use `Enable Sync-On-Save` and `Disable Sync-On-Save` commands to control individual files
    - Status bar click toggles sync state for current file

## [0.29.0] - 2026-01-05

### Added

- **Smart Template Opening** - Opening templates now checks for existing linked files first
    - `Open Template` and `Open Template from URL` commands automatically detect if the template is already linked to a local file
    - Opens existing linked file instead of creating a new untitled document
    - Prevents duplicate downloads and improves workflow efficiency
    - When a template is linked to multiple files, displays a picker to select which file to open

## [0.28.0] - 2026-01-05

### Added

- **Automatic Folder Syncing** - Linked folders now automatically check for new templates every 15 minutes
    - Runs in background to keep local template files in sync with Rewst
    - Only fetches templates that don't already exist locally
    - Handles errors gracefully without interrupting workflow

- **Immediate Template Fetch on Link** - Linking a folder now automatically downloads all templates
    - No need to manually run "Fetch Folder" after linking
    - Templates are ready to edit immediately after folder link completes
    - Shows success notification with count of fetched templates

### Changed

- **Refactored Folder Operations** - Moved folder fetching logic from command into SyncManager
    - Better code organization and separation of concerns
    - Enables reuse of fetch logic for both manual and automatic syncing
    - Improved error handling and user notifications

### Fixed

- **Resource Leak** - Fixed setInterval starting before extension activation
    - Interval now properly initialized in constructor after extension is ready
    - Prevents premature fetching before sessions are loaded
- **API Flooding** - Fixed parallel folder fetching overwhelming Rewst API
    - Folders now process sequentially instead of all at once
    - Prevents rate limiting and improves reliability
- **Inconsistent State** - Fixed folder linking leaving inconsistent state on fetch failure
    - Folder link succeeds even if initial template fetch fails
    - User receives appropriate error notification but folder remains linked
    - Automatic syncing will retry on next interval

## [0.27.0] - 2026-01-05

### Added

- **Auto-fetch on Open** - Templates automatically download latest changes from Rewst when opening files
    - Only works when sync-on-save is enabled for the file
    - Safely detects local modifications using file stat tracking
    - Skips auto-fetch when local edits are detected to prevent data loss
    - Gracefully handles legacy links without stat information

- **StatusBar Integration** - New status bar item shows template link status
    - Displays template name and organization in status bar
    - Shows sync-on-save state with visual indicators (ON/OFF)
    - Warns when no active session exists for the linked template's organization
    - Click to toggle sync-on-save exclusion
    - Tooltip shows full template details (name, description, organization)

- **File Stat Tracking** - Links now track file modification time and size
    - Enables intelligent auto-fetch behavior
    - Prevents unnecessary downloads when files haven't changed
    - Updated whenever templates are synced to Rewst

### Changed

- **Immediate Sync After Linking** - Link commands now sync template content immediately
    - `LinkTemplateFromURL` auto-syncs after creating link
    - `LinkTemplateInteractive` auto-syncs after creating link
    - Ensures local file matches Rewst template right after linking

- **Renamed SyncManager** - `TemplateSyncManager` renamed to `SyncManager` for clarity
    - Updated all imports and references across codebase
    - No functional changes to sync behavior

### Fixed

- **StatusBar Property Access** - Fixed incorrect property path causing runtime errors
    - Changed `link.template.orgId` to `link.org.id` to match Link interface
- **StatusBar Code Cleanup** - Removed unused `isLinked` variable that was computed but never used
- **Legacy Link Handling** - Auto-fetch now gracefully skips links created before stat tracking was added

## [0.26.1]

### Fixed

- **parseArgsUri Safety** - Added bounds checking to prevent infinite loops on malformed command arguments
- **Rename Handler** - Silently ignores unlinked files instead of logging errors on every file rename
- **Legacy Migration** - Link migrations (sessionProfile → org) now persist immediately instead of waiting for user action
- **Code Cleanup** - Removed unused variable in StatusBarIcon tooltip builder

## [0.26.0]

### Added

- **Folder Linking** - Link entire folders to Rewst organizations
    - Right-click folder → "Link Folder to Organization" to associate a local folder with an org
    - Right-click linked folder → "Unlink Folder from Organization" to remove association
    - Context menu commands only appear on appropriate folders (linked vs unlinked)

- **Fetch Folder** - Bulk download all templates from an organization
    - Right-click linked folder → "Fetch Folder" to download all templates
    - Automatically creates files for each template in the organization
    - Skips templates that already exist locally (by ID)
    - Handles filename collisions by appending `(1)`, `(2)`, etc.
    - Each downloaded template is automatically linked for future syncing

- **New Utilities** - Reusable file operation utilities
    - `uriExists()` - Check if file/folder exists at a URI
    - `writeTextFile()` - Write text content to a file
    - `makeUniqueUri()` - Generate unique filename with collision handling
    - `isDescendant()` - Check if URI is descendant of another
    - `parseArgsUri()` - Parse URI from command arguments

### Changed

- **LinkManager Refactor** - Unified link management for templates and folders
    - Renamed `TemplateLinkManager` → `LinkManager`
    - Now supports multiple link types: `Template` and `Folder`
    - Added `getTemplateLink()`, `getFolderLink()`, `getOrgLinks()`, `getOrgTemplateLinks()`
    - Links now store `org` directly instead of `sessionProfile`
    - Backward compatible: migrates legacy `sessionProfile` field automatically

- **Simplified Link Structure** - Links now reference org directly
    - `TemplateLink` now contains `org: { id, name }` instead of `sessionProfile`
    - Reduces coupling between links and session management
    - All template commands updated to use new structure

- **Initialization Order** - Improved extension startup
    - Removed automatic session refresh on activation (prevents blocking)
    - `LinkManager` now uses `init()` method instead of constructor for event subscriptions
    - Prevents circular dependency issues during initialization

- **Rename Handling** - Improved file/folder rename tracking
    - Sync exclusions now properly follow renamed files
    - Uses new `isDescendant()` utility for accurate parent-child detection

### Fixed

- **Filename Collision Bug** - Fixed unique filename generation
    - Previously generated `file(1.txt)` instead of `file(1).txt`
    - Now correctly places counter before file extension

## [0.25.0]

### Added

- **Copy Template ID** - Copy linked template ID to clipboard
    - Right-click on linked file → "Copy Template ID"
    - Available via Command Palette: `Rewst Buddy: Copy Template ID`
    - Useful for referencing template IDs in workflows or documentation

## [0.24.3]

### Changed

- **Command Organization** - Renamed `commands/client/` directory to `commands/sessions/`
    - Better reflects the purpose of session-related commands
    - Aligns with the sessions naming convention established in v0.23.0

## [0.24.2]

### Changed

- **Session Naming Refactor** - Simplified session-related class and file names
    - Renamed `RewstSession` → `Session` (src/sessions/Session.ts)
    - Renamed `RewstSessionProfile` → `SessionProfile` (src/sessions/SessionProfile.ts)
    - Renamed `RewstSessionManager` → `SessionManager` (src/sessions/SessionManager.ts)
    - Updated storage key from `'RewstSessionProfiles'` → `'SessionProfiles'`
    - Consolidated session exports using `export *` pattern in sessions/index.ts
    - Updated all import paths across codebase to use new naming (23+ files)
    - Fixed GraphQL SDK imports to use `@sessions` alias consistently

## [0.24.1]

### Fixed

- **Session Validation** - Fixed status bar not showing warning when no active session exists for linked template
    - Status bar now properly returns early when no session is found
    - Warning state correctly displays error background with session prompt
- **SyncOnSaveManager Initialization** - Fixed activation order issue
    - Manager now properly initialized asynchronously before use
    - Prevents potential race conditions during extension startup
- **Status Bar Item Visibility** - Fixed status bar item not showing in certain states
    - Item now explicitly shown after updating state (sync enabled/disabled/no session)

## [0.24.0]

### Added

- **Sync on Save** - Automatically sync linked templates when files are saved
    - Enable/disable globally via `rewst-buddy.enableSyncOnSave` setting (default: true)
    - New `SyncOnSaveManager` handles sync state and exclusions

- **Sync Exclusions** - Exclude specific files from automatic sync
    - "Add Sync-On-Save Exclusion" command to exclude a linked file
    - "Remove Sync-On-Save Exclusion" command to re-enable sync
    - Exclusions are stored persistently and cleaned up when files are unlinked
    - Context menu shows appropriate command based on exclusion state

### Changed

- **Refactored SyncTemplate command** - Moved to `commands/template/sync/` directory
- **StatusBarIcon** - Updated to reflect sync exclusion state
- **Event types** - Added `SyncOnSaveChangeEvent` type

## [0.23.0]

### Added

- **Automatic Session Refresh** - Sessions now automatically refresh every 15 minutes
    - Keeps authentication cookies fresh without manual intervention
    - Prevents unexpected session expiration during active work
    - Runs in background with automatic cleanup on extension deactivation

- **Expired Session Tracking** - Session tree view now displays both active and expired sessions
    - Active sessions show green checkmark icon
    - Expired sessions show red error icon with "EXPIRED" status in tooltip
    - Helps identify which sessions need to be refreshed or recreated

### Changed

- **Refactored Path Aliases** - Consolidated `@client` and `@sdk` aliases into single `@sessions` alias
    - Renamed `src/client/` directory to `src/sessions/` to better reflect its purpose
    - Updated all imports throughout the codebase (23+ files)
    - Simplified tsconfig.json and webpack.config.cjs path alias configuration

- **Session Management Architecture** - Enhanced session lifecycle and state management
    - Sessions now load asynchronously on extension activation with proper loading guards
    - Added `getActiveSessions()` for synchronous access to current sessions
    - Added `getAllKnownProfiles()` to track all sessions (active and expired)
    - `loadSessions()` now idempotent - returns cached sessions if already loaded
    - `getSessionForOrg()` changed from async to sync method

- **Session Tree View** - Improved visibility and renamed for clarity
    - Tree view name changed from "Active Sessions" to "Sessions"
    - Now displays all known sessions with visual status indicators
    - Enhanced tooltips show active/expired state

- **Session Events** - Enhanced event data structure
    - Added `'saved'` event type to `ChangeType`
    - Event payload now includes `allProfiles` (all known) and `activeProfiles` (currently active)
    - Removed `allSessions` field in favor of profile-based tracking

- **Error Messages** - Improved clarity in TemplateSyncManager
    - Sync errors now provide specific failure context
    - Missing template ID errors include detailed API response information

### Fixed

- **Session Loading** - Prevented race conditions during parallel session loads with loading state guards
- **Cookie Storage** - Fixed token refresh to properly update stored cookies using CookieString value

### Technical

- Extension activation order adjusted to load sessions after UI initialization
- Path alias count reduced from 8 to 7 (merged `@client` + `@sdk` → `@sessions`)
- Added periodic refresh interval (15 minutes) with proper disposal cleanup
- SessionManager refactored to singleton pattern with inline class syntax

## [0.22.2]

### Added

- **Session Validation in Status Bar** - StatusBar now checks if an active session exists for linked templates
    - Shows warning state with red background if no session is found with access to the template's organization
    - Provides quick access to focus sidebar when session is missing
    - Subscribes to session changes for real-time status updates

- **FocusSidebar Command** - New command to focus the sidebar panel
    - Accessible from status bar warning state when no session is available
    - Helps users quickly navigate to the session management interface

### Changed

- **Extracted parseCookieString Utility** - Moved cookie parsing logic from RewstSession to dedicated utility function for better code reusability

- **StatusBar.update() Method** - Now async to support session lookup operations

### Added (Technical)

- **SessionManager Enhancement** - Added `getSessionForOrg()` method to SessionManager
    - Enables lookups for sessions with access to a specific organization
    - Throws error if no session found for the requested organization

## [0.22.1]

### Added

- **Pre-commit Tooling** - Automated quality checks before commits
    - Husky integration for git hooks
    - Auto-generates GraphQL SDK when `.graphql` files change
    - Runs lint-staged on all staged files (ESLint + Prettier)
    - Type-checks entire project before allowing commits
    - New npm scripts: `codegen:check`, `lint:staged`, `pre-commit`

### Changed

- Standardized code formatting across all file types
    - Configured Prettier as default formatter for TypeScript, JavaScript, JSON, and Markdown
    - Added `.prettierignore` to exclude auto-generated SDK from formatting
- Updated ESLint configuration to ignore generated SDK file
- Reformatted existing code to match new formatting standards
- Import ordering fixes in session manager

### Dependencies

- Added `husky` (v9.1.7) for git hook management
- Added `lint-staged` (v15.5.2) for selective linting

## [0.22.0]

### Added

- **Create Template** - Create new Rewst templates directly from local files
    - Right-click in editor → "Create Template"
    - Prompts for organization and template name (suggests filename)
    - Automatically links the file to the newly created template
    - Available via Command Palette: `Rewst Buddy: Create Template`

- **Delete Template** - Delete templates from Rewst with confirmation
    - Right-click on linked file → "Delete Template"
    - Shows confirmation modal before deletion
    - Automatically unlinks the file after deletion
    - Available via Command Palette: `Rewst Buddy: Delete Template`

### Changed

- Refactored link commands folder structure (`link-commands/` → `link/`)
- Added utility functions for cleaner code:
    - `ensureSavedDocument()` - ensures documents are saved before operations
    - `requireUnlinked()` - validates files aren't already linked
    - `getTemplate()` method added to RewstSession class
- Simplified OpenTemplate and LinkTemplate command implementations
- Updated createTemplate GraphQL mutation to accept body parameter
- Removed explorer context menu, kept only editor context menu for better UX

### Fixed

- Args parsing for context menu commands (SyncTemplate, UnlinkTemplate, DeleteTemplate)
- Error handling in TemplateSyncManager

## [0.21.0]

### Changed

- Refactored event handling to self-registration pattern
- Managers now subscribe to VS Code events internally (TemplateLinkManager, TemplateSyncManager, Server)
- UI components self-register for domain events (SessionTreeDataProvider, StatusBar)
- Simplified extension.ts by removing external event wiring

### Removed

- Deleted `src/events/vscode/` folder (handlers moved into managers)
- Removed `onRename.ts`, `onSave.ts`, `onEditorChange.ts`, `onLinksSaved.ts`

## [0.20.0]

### Added

- Activity bar sidebar with custom Rewst logo icon
- Session input panel for adding sessions directly from the sidebar
- Active Sessions tree view showing all connected sessions
- Custom Rewst SVG icon for activity bar

### Changed

- Moved extension icon to media/ folder for consistency

## [0.19.1]

- Add AI icon

## [0.19.0]

- Cleaner context menu command titles

## [0.18.0]

- Restructure project layout and decouple event handlers

## [0.17.0]

- Context menu support for template operations
