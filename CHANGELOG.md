# Change Log

All notable changes to the "rewst-buddy" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
