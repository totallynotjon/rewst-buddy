# Changelog

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
