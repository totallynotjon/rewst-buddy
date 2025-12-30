# Change Log

All notable changes to the "rewst-buddy" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.16.0] - 2025-12-29

### Added
- **Unlink Template Command**: New command to unlink a single template from the currently active editor
  - `Rewst Buddy: Unlink Template` - Removes the template link from the active file
  - Automatically updates button visibility after unlinking
  - Validates that a template link exists before attempting to unlink

### Changed
- **Command Rename**: `Clear Template Links` renamed to `Unlink All Templates` for clarity
  - Better describes the action of removing template associations
  - Consistent naming with new single-file unlink command
- **Code Organization**: Reorganized template link commands into `link-commands` subfolder
  - `LinkTemplateFromURL`, `LinkTemplateInteractive`, `UnlinkAllTemplates`, and `UnlinkTemplate` now in dedicated folder
  - Improved code structure and maintainability

### Fixed
- **Template Link Manager**: `clearTemplateLinks()` method now properly chainable
  - Returns `this` for method chaining support
  - Synchronous operation for better performance
  - Added explicit `.save()` calls after unlink operations to ensure persistence

### Technical Details
- Renamed `ClearTemplateLinks` class to `UnlinkAllTemplates` (src/commands/template-commands/link-commands/UnlinkAllTemplates.ts)
- Added new `UnlinkTemplate` command class (src/commands/template-commands/link-commands/UnlinkTemplate.ts:1-27)
- Moved link commands to dedicated subfolder (src/commands/template-commands/link-commands/)
- Updated command exports in index files for new structure
- Updated button visibility logic to refresh after unlink operations

## [0.15.1] - 2025-12-29

### Fixed
- **Session persistence**: Cookies are now properly stored in VS Code secrets when creating a session, ensuring sessions can be refreshed without re-authentication

### Changed
- **API response enhancement**: The `addSession` endpoint now returns all organization IDs (current org + managed orgs) in the response to prevent unnecessary reprocessing when navigating between organizations

### Technical Details
- Modified `RewstSession.newSdk()` to return the `CookieString` alongside the SDK and region config (src/client/RewstSession.ts:51)
- Updated `RewstSessionManager.createSession()` to store cookies in VS Code secrets using `context.secrets.store()` (src/client/RewstSessionManager.ts:70)
- Enhanced `SuccessResponse` interface to include optional `orgIds` field (src/server/types.ts:12)
- Added logic in session handler to collect and return all org IDs (current + managed) in the response (src/server/handlers.ts:50-58)

## [0.15.0] - 2025-12-28

### Added
- **Session Receiver Server**: Local HTTP server for receiving session cookies from browser extensions
  - Listens on configurable port (default: 27121) for JSON requests
  - Accepts `addSession` requests with cookies to create new sessions automatically
  - CORS headers enabled for browser extension compatibility
  - Graceful error handling for port conflicts and permission issues

- **New Commands**:
  - `Rewst Buddy: Start Server` - Manually start the server
  - `Rewst Buddy: Stop Server` - Manually stop the server

- **New Configuration Options**:
  - `rewst-buddy.server.enabled` - Enable/disable the session receiver (default: true)
  - `rewst-buddy.server.port` - Server port (default: 27121)
  - `rewst-buddy.server.host` - Server host (default: 127.0.0.1 for localhost-only)

- **Server Lifecycle Management**:
  - Auto-starts on extension activation if enabled
  - Auto-stops on extension deactivation
  - Responds to configuration changes in real-time

### Changed
- **Cookie Storage Refactor**: Now stores full cookie string instead of just the token
  - Added `CookieString` class for cookie handling
  - Renamed `getToken()` to `getCookies()` throughout session management
  - Token refresh now preserves complete cookie data from server response

- **Session Creation**: Improved error handling during token refresh for new sessions

### Breaking Changes
- **Stored Session Format Changed**: Sessions stored with previous versions are incompatible
  - Run `Rewst Buddy: Clear Sessions` to remove old sessions
  - Re-add sessions using `Rewst Buddy: New Rewst Session` or via the session receiver server

## [0.14.0] - 2025-12-27

### Added
- **Interactive Template Selection**: New QuickPick-based UI for browsing and selecting templates
  - `SessionPicker` for selecting active sessions (auto-selects when only one available)
  - `OrganizationPicker` for choosing between primary org and managed sub-organizations
  - `TemplatePicker` for browsing and selecting templates with search support
  - Pickers chain together seamlessly: template → org → session

- **New Interactive Commands**:
  - `Rewst Buddy: Open Template` - Browse and open templates via quick picks
  - `Rewst Buddy: Link Template` - Link current file to a template via quick picks
  - URL-based commands renamed for clarity (`Open Template from URL`, `Link Template from URL`)

### Changed
- **Session Management Refactor**: Changed from organization-based to user-based session identification
  - Sessions now keyed by user ID instead of organization ID
  - Replaced separate `sessions`/`profiles` arrays with unified `sessionMap`
  - Profile label now shows `username (orgName)` format

- **Profile Structure**: Expanded session profile with richer data
  - Changed `orgId` string to full `Org` object with id and name
  - Added `allManagedOrgs` array for sub-organization access
  - Added `user` property containing full user data from API

- **GraphQL API Updates**:
  - Replaced `UserOrganization` query with `User` (me) query
  - Added `org` fragment for consistent organization field selection
  - Added `user` fragment for user data
  - Removed deprecated `userOrganization.graphql`

- **Button Visibility**: Now updates after opening/linking templates interactively

### Breaking Changes
- **Session Profile Structure Changed**: Existing saved profiles are incompatible
  - Run `Rewst Buddy: Clear Sessions` to remove old profiles
  - Re-add sessions using `Rewst Buddy: Add Rewst Session`

## [0.13.1] - 2025-12-26

### Fixed
- **Sync Re-entry Loop**: Fixed issue where downloading remote template during conflict resolution would trigger another sync when save-on-sync is enabled
  - Added re-entry guard using `syncingUris` Set to prevent concurrent syncs on same document
  - Prevents unnecessary API calls and potential race conditions
  - Resolves both save-on-sync and manual sync dirty-document-save paths

### Changed
- **Code Structure**: Refactored `TemplateSyncManager.syncTemplate()` for better readability and maintainability
  - Extracted `syncTemplateInternal()` for core sync orchestration
  - Extracted `fetchRemoteTemplate()` for remote API calls
  - Extracted `handleConflict()` for user conflict resolution prompts
  - Extracted `downloadAndApplyRemote()` for applying remote content
  - Each method now has single, focused responsibility

## [0.13.0] - 2025-12-26

### Added
- **File Rename Support**: Template links now automatically update when files or folders are renamed/moved
  - Automatic detection of file and folder rename operations
  - Recursive update of all child template links when folders are renamed
  - Preserves template associations across file system operations
- **In-Memory Link Caching**: Improved performance with lazy-loaded link map
  - Links loaded on-demand and cached in memory
  - Reduced redundant storage reads
  - `loadIfNotAlready()` pattern for efficient initialization

### Changed
- **Singleton Architecture**: Converted managers to singleton pattern for better resource management
  - `TemplateLinkManager` now singleton instance instead of static class
  - `TemplateSyncManager` now singleton instance instead of static class
  - Improved method chaining support
- **Batch Operations**: Optimized link operations to reduce storage writes
  - Single save operation for batch link updates
  - Deferred saves for rename operations
- **Button Visibility**: Improved status bar button update logic
  - Editor parameter support in `updateButtonVisibility()`
  - More efficient visibility checks

### Fixed
- **Race Conditions**: Eliminated multiple race conditions in rename handling
  - Fixed parallel save conflicts during batch folder renames
  - Added proper error boundaries around rename event handlers
- **Error Handling**: Improved error handling for edge cases
  - Graceful handling of missing links during rename operations
  - Individual error handling for each rename operation in batch
  - Top-level error boundary prevents extension crashes
- **Path Transformations**: Fixed edge cases in URI path manipulation
  - Explicit prefix replacement instead of string replace
  - Proper handling of nested path segments

## [0.12.1] - 2025-12-26

### Added
- **Auto-Sync on Save**: Automatically sync templates to Rewst when files are saved
  - Configurable via `rewst-buddy.enableSyncOnSave` setting (enabled by default)
  - Only syncs files that have active template links
  - Respects conflict detection rules from v0.10.0

### Changed
- **Session Management Improvements**: Enhanced session handling and token refresh logic
- **Error Handling**: Improved error messages and handling for template operations
- **Template Operations**: Better reliability for sync operations

### Fixed
- Template sync reliability improvements
- Session token refresh edge cases

## [0.10.0] - 2025-12-24

### Major Architectural Redesign

This release represents a complete architectural overhaul, simplifying the extension from a complex sidebar-based file explorer to a lightweight, URL-based template linking and syncing tool. The focus is now on direct, efficient template editing workflows.

### Added

#### Core Features
- **Session Token Authentication**: New secure session management using VS Code secret storage
  - `RewstSessionManager` for centralized session lifecycle management
  - `RewstSession` class for individual session handling with automatic token refresh
  - `RewstSessionProfile` for storing session metadata and region configuration
  - Sessions persist across VS Code restarts via encrypted secret storage

- **Template Linking System**: Connect local files to Rewst templates via URL
  - `TemplateLinkManager` for persistent file-to-template associations
  - `TemplateLink` model with URL parsing and UUID validation
  - Links stored in global state and persist across sessions
  - Automatic template metadata fetching (name, ID, organization)

- **Smart Sync with Conflict Detection**: Timestamp-based conflict resolution
  - `TemplateSyncManager` for bidirectional sync operations
  - Compare local vs Rewst timestamps before pushing changes
  - User choice on conflicts: force override or download latest version
  - Prevents accidental overwrites of recent cloud changes

- **Open from URL**: Instant template access via URL
  - Paste Rewst template URL to fetch and open template
  - Automatic file creation with suggested filename
  - Auto-linking after opening
  - Supports standard Rewst URL format: `/organizations/{orgId}/templates/{templateId}`

- **Status Bar Integration**: Dynamic UI based on editor state
  - "Link Template" button when editor is active and file not linked
  - "Sync Template" button when editor has active link
  - Buttons auto-update on editor/file changes

- **New Commands**:
  - `Rewst Buddy: Add Rewst Session` - Add session via token input
  - `Rewst Buddy: Clear Sessions` - Remove all stored sessions
  - `Rewst Buddy: Open Template from URL` - Open and auto-link template
  - `Rewst Buddy: Link Template` - Link current file to template
  - `Rewst Buddy: Sync Template` - Push changes with conflict detection
  - `Rewst Buddy: Clear Template Links` - Remove all file associations

#### Models & Infrastructure
- **SimpleTemplate**: Factory function for creating complete Template objects with defaults
- **TemplateLink**: Link definition with URL parsing utilities
- **TemplateLinkManager**: Static manager for link persistence
- **TemplateSyncManager**: Sync logic with conflict resolution
- **Global context integration**: Uses VS Code global state and secret storage

#### Developer Experience
- `.editorconfig` - Consistent editor settings across team
- `.nvmrc` - Node version specification
- `plan.md` - Feature roadmap and planning document
- Enhanced webpack configuration for better bundling
- Improved TypeScript path resolution

### Changed

#### Architecture
- **Session Model**: Replaced cookie-based `RewstClient` with token-based `RewstSession`
  - Sessions now transient in memory, tokens in secret storage
  - Region configuration embedded in session profiles
  - Automatic token refresh with improved logging

- **Storage Strategy**: Migrated from org variables to VS Code storage
  - Session tokens: VS Code secret storage (encrypted)
  - Template links: Global state (persists across sessions)
  - No cloud storage dependency

- **UI Paradigm**: Shifted from sidebar explorer to status bar buttons
  - Removed virtual filesystem and tree view
  - Simplified to targeted button actions
  - Reduced UI complexity significantly

- **Command Structure**: Streamlined from 20+ commands to 7 core operations
  - Focused on essential template operations
  - Removed folder/view management commands
  - Cleaner command palette experience

#### GraphQL Operations
- Updated `templateOps.graphql` with new mutations for template updates
- Modified `userOrganization.graphql` for session verification queries
- Simplified GraphQL SDK usage (regenerated types)

#### Configuration
- `package.json`: Removed sidebar view contributions, submenus, and context menus
- Retained only essential command contributions
- Simplified activation events
- Updated to webpack-only build system (removed esbuild)

#### Code Quality
- ESLint configuration improvements for TypeScript/webpack compatibility
- Removed conflicting bundler rules
- TypeScript import resolver configuration
- Better path alias support

### Removed

#### Complete Subsystems Deleted
- **Virtual Filesystem** (`src/fs/`):
  - `RewstFS.ts` - Virtual file system provider
  - `RewstView.ts` - Sidebar tree view
  - `RewstDragAndDropController.ts` - Drag-and-drop functionality

- **Folder Management** (`src/models/TemplateFolder/`):
  - `TemplateFolder.ts` - Folder data structures
  - `FolderStructureManager.ts` - Folder hierarchy management
  - `TemplateManager.ts` - Template organization
  - `DataLoader.ts` - Lazy loading infrastructure

- **Cloud Synchronization**:
  - `BackgroundSyncService.ts` - Auto-sync background worker
  - Cloud conflict detection/resolution
  - Org variable-based persistence

- **Storage Layer** (`src/storage/`):
  - `Storage.ts` - Custom storage abstraction (now uses VS Code APIs directly)

- **View Commands** (`src/commands/view-commands/`):
  - All 9 view management commands removed
  - RefreshView, OpenOrgInFolder, DeleteFolder, Rename, etc.

- **Template Commands**:
  - `CreateTemplateFolder.ts`
  - `DeleteTemplate.ts`
  - `ChangeTemplateFileype.ts`

- **Client Commands**:
  - `LoadClients.ts` - Old client loading system
  - `ClearProfiles.ts` - Old profile management
  - `NewClient.ts` - Old client creation

- **Storage Commands** (entire directory):
  - `ClearFolderStructure.ts`
  - `OpenLogs.ts`
  - `ReadTest.ts`
  - `SaveTest.ts`

- **Models**:
  - `Entry.ts` - Virtual filesystem entry
  - `Org.ts` - Organization model
  - `Template.ts` - Old template model
  - `Tree.ts` - Tree structure model

- **Utilities**:
  - `cloud-operations.util.ts`
  - `command-operations.util.ts`

- **Other**:
  - `RewstClient.ts` - Old session/API client
  - `RewstProfiles.ts` - Old profile management
  - `mockWrapper.ts` - Mock API wrapper
  - Test files (temporarily removed)

#### UI Elements
- Sidebar explorer view and all contributions
- Context menus (drag-drop, right-click operations)
- Submenus
- Tree view data providers

### Breaking Changes

**This release is NOT backward compatible with v0.9.0**

- **No migration path**: Folder structures from v0.9.0 cannot be imported
- **Session re-authentication required**: Must re-add sessions using tokens instead of cookies
- **Link-based workflow**: Templates must be accessed via URL, not browsed in sidebar
- **No automatic discovery**: Extension doesn't fetch/display all templates
- **Storage format changed**: Uses VS Code storage APIs instead of custom storage layer

### Migration Guide

**From v0.9.0 to v0.10.0:**

1. **Session Setup**:
   - Old cookie-based sessions will not work
   - Run `Rewst Buddy: Add Rewst Session` for each organization
   - Provide session token (not cookie)

2. **Template Access**:
   - Folder structures are not available
   - Use template URLs from Rewst web UI
   - Bookmark frequently used template URLs

3. **Workflow Changes**:
   - No sidebar browsing - use `Open Template from URL` command
   - Sync is manual - click "Sync Template" button when ready
   - Links persist, but tied to file paths (moving files breaks links)

### Fixed

- **Token Refresh Logging**: Improved log messages using session label instead of ID
- **Command Arguments**: Now properly logs command arguments for debugging
- **Template Save Flow**: Ensures templates are saved before creating mapping
- **Session Profile Bugs**: Fixed issues with session profile persistence
- **ESLint/Bundler Conflicts**: Resolved rule conflicts between TypeScript and webpack

### Technical Improvements

- **Codebase Reduction**: ~3,000 lines removed (11,839 deletions, 8,766 additions)
- **Dependency Updates**: Updated to latest versions of core dependencies
- **Build Process**: Simplified to webpack-only (removed dual build system)
- **Type Safety**: Regenerated GraphQL SDK with updated schema
- **Module Resolution**: Better path aliases and import resolution
- **Performance**: Reduced extension activation overhead (no filesystem watchers)
- **Memory**: Lower memory footprint (no tree view, no background services)

### Known Limitations

- **No template browsing**: Requires knowing template URLs
- **Manual sync only**: Auto-sync on save not yet implemented
- **No bulk operations**: Cannot pull all templates at once
- **No re-linking**: File renames/moves break template links
- **Manual token refresh**: Must re-add sessions after token expiration
- **Create template**: Command exists but is placeholder (not implemented)

### Development Notes

- Node version: Specified in `.nvmrc`
- Build: `npm run watch` for development, `npm run package` for production
- GraphQL codegen: `npm run codegen` to regenerate SDK
- ESLint: Fixed configuration for better TypeScript/webpack compatibility

---

## [0.9.0] - 2025-06-29

### Added
- **Enhanced Template Operations**: Improved template creation with proper UI refresh targeting
- **Advanced Drag & Drop Validation**: Comprehensive validation to prevent invalid drop operations
- **Global Context Management**: Centralized context, filesystem, and view management for better performance
- **Success Tracking**: Drag & drop operations now only show success messages for actually completed moves
- **Template Delete Functionality**: Full template deletion support with GraphQL operations and UI integration
- **Utility Functions**: New command operations utilities, validators, and tab management helpers
- **Code Quality Tools**: Standardized ESLint and Prettier configuration for consistent code formatting

### Changed
- **Context Menu Improvements**: VS Code context menu regex patterns now use word boundaries for precise matching
- **Cloud Sync Defaults**: Cloud synchronization is now enabled by default for new organizations
- **Architecture Enhancements**: Refactored global context management for better code organization
- **UI Responsiveness**: Enhanced template creation and deletion UI refresh behavior
- **Model Organization**: Moved models from `/fs` to `/models` directory for better project structure
- **Command Structure**: Improved command organization and initialization patterns

### Fixed
- **Drag & Drop Edge Cases**: Fixed issue where items could be dragged onto themselves causing UI inconsistencies
- **Context Menu Conflicts**: Resolved regex pattern conflicts in VS Code menus (e.g., "is-template" no longer matches "is-templatefolder")
- **Success Message Accuracy**: Fixed drag & drop completion messages showing success when all operations failed
- **Template Creation Refresh**: Template creation now properly refreshes the correct parent UI element

### Technical Improvements
- **Code Organization**: Better separation of concerns with global context management
- **Error Handling**: Enhanced error handling for drag & drop operations
- **Performance**: Optimized UI refresh logic for template operations
- **Validation**: Improved input validation across all template and folder operations
- **Development Workflow**: Enhanced ESLint/Prettier integration with proper TypeScript support
- **Path Aliases**: Improved TypeScript path resolution with better alias configuration

## [0.8.0] - 2025-06-28

### Added
- **Multi-Region Support**: Configurable regional endpoints for global Rewst instances via VS Code settings
- **Cloud Folder Synchronization**: Share folder structures across team members using Rewst org variables
- **Background Sync Service**: Automatic cloud update detection with 1-minute interval checks
- **Drag & Drop Interface**: Intuitive template and folder organization with conflict validation
- **Advanced Template Operations**: Full CRUD operations with file type management
- **File Type Support**: PowerShell (.ps1), HTML (.html), YAML (.yml), and custom extensions
- **Team Collaboration**: Shared folder structures with version-based conflict detection
- **Enhanced Logging**: Configurable logging system with file rotation
- **Multi-Instance Management**: Support for multiple Rewst instances simultaneously
- **Template Renaming**: Rename templates and folders with validation
- **Copy Operations**: Copy template and folder IDs to clipboard
- **Context Menus**: Rich right-click context menus for all operations
- **Workspace Integration**: Add organizations as VS Code workspace folders

### Changed
- **Improved UI**: Better organization of commands and context menus
- **Enhanced Error Handling**: More robust error handling and user feedback
- **Session Management**: Better cookie-based authentication handling

### Fixed
- **Conflict Resolution**: Proper handling of folder structure conflicts
- **Validation**: Input validation for folder names, extensions, and operations
- **Performance**: Optimized GraphQL operations and caching

## [0.7.0] - 2024-12-XX

### Added
- **Core Template Management**: Basic template CRUD operations
- **Folder Organization**: User-created folder structures
- **Initial Cloud Sync**: Basic folder structure synchronization
- **GraphQL Integration**: Type-safe API communication with Rewst

## [0.1.0] - 2024-XX-XX

### Added
- **Initial Release**: Basic Rewst integration via session cookies
- **Template Editing**: Browse, create, and edit templates/scripts
- **Organization View**: Sidebar explorer for template navigation
- **Direct Synchronization**: Real-time saving to Rewst via GraphQL
