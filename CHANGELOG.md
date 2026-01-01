# Changelog

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
