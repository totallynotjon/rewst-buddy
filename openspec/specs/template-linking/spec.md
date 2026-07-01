# Template Linking Specification

## Purpose

The extension lets users edit Rewst templates as ordinary local files. This
capability covers the association between a local file (or folder) and a Rewst
template (or organization): creating, removing, moving, and pruning those links,
and persisting them efficiently without ever storing template bodies.

Source: `src/models/LinkManager.ts`, `src/models/types.ts`,
`src/utils/getHash.ts`, `src/commands/template/link/`, `src/commands/folders/`.

## Requirements

### Requirement: Link a local file to a template

The system SHALL associate a local file URI with a Rewst template, recording the
template metadata, the owning organization, a content hash of the current local
body, and the ids of any templates the body references.

#### Scenario: User links an open file

- **GIVEN** an authenticated session and an open local file
- **WHEN** the user runs `Link File to Template` and selects a template
- **THEN** a link is created keyed by the file URI string
- **AND** the link records the template metadata, the org, a `bodyHash` of the
  file's current text, and the referenced template ids

#### Scenario: Re-linking a file already linked

- **GIVEN** a file already linked to template A
- **WHEN** a lower-level linking path explicitly replaces the link with template B
- **THEN** the old association and its reverse-lookup entries are removed before
  the new link is recorded, leaving no orphaned index entries

#### Scenario: User command refuses an already linked file

- **GIVEN** a file already linked to a template
- **WHEN** the user runs an interactive link command for that file
- **THEN** the command refuses before template selection instead of silently
  replacing the link

### Requirement: Link files from path-like tool inputs

The system SHALL let MCP callers link and unlink local files by path or `file://`
URI, resolving relative paths against the workspace when possible. The tool path
SHALL report clear status values for invalid paths, missing files, already linked
files, missing templates, and org mismatches.

#### Scenario: Relative path link

- **GIVEN** a workspace folder and an existing unlinked file
- **WHEN** `buddy_template_link` receives a relative path and template id
- **THEN** the path resolves inside the workspace
- **AND** the file is linked to the remote template

#### Scenario: Overwrite requested

- **GIVEN** a file already linked to template A
- **WHEN** `buddy_template_link` is called for template B with overwrite enabled
- **THEN** the link moves to template B
- **AND** reverse lookups for template A no longer include the file

### Requirement: Never persist template bodies

The system SHALL persist links in `globalState` under `RewstTemplateLinks` and
SHALL retain only a `bodyHash` for change detection — the template body itself is
never written to persistent storage.

#### Scenario: Inspecting persisted state

- **GIVEN** a linked file with body content
- **WHEN** the links are persisted
- **THEN** the stored record contains the template metadata and `bodyHash`
- **AND** does not contain the template body text

### Requirement: Fast reverse lookups

The system SHALL maintain secondary indexes so that "which files are linked to
this template id" and "which links belong to this org id" are answered without
scanning all links.

#### Scenario: Lookup by template id

- **GIVEN** several files linked across multiple templates
- **WHEN** the extension needs the files linked to a given template id
- **THEN** it resolves them via the template-id index rather than filtering the
  full link collection

### Requirement: Track file renames and moves

The system SHALL follow links when their underlying files are renamed or moved,
updating the stored URI and re-indexing any descendant links under a moved
folder.

#### Scenario: Linked file renamed

- **GIVEN** a linked file `a.txt`
- **WHEN** it is renamed to `b.txt`
- **THEN** the link's URI is updated to `b.txt` and reverse indexes are updated,
  preserving the association

### Requirement: Track file deletions

The system SHALL remove a link when its underlying file (or an ancestor folder)
is deleted, cleaning up the secondary indexes.

#### Scenario: Linked file deleted

- **GIVEN** a linked file
- **WHEN** the file is deleted on disk
- **THEN** its link and all index entries are removed

### Requirement: Prune stale links on load

The system SHALL remove links whose files no longer exist when links are loaded,
so a deleted-while-closed file does not leave a dangling association.

#### Scenario: File removed while extension was not running

- **GIVEN** a persisted link whose file was deleted outside VS Code
- **WHEN** links are loaded on activation
- **THEN** the stale link is pruned during load

### Requirement: Resolve the owning organization correctly

The system SHALL prefer the template's own (sub-)organization over the
organization stored on a legacy link, so links created before sub-org tracking
still resolve to the correct org. For MCP- and URL-driven calls, template-sync's
organization-normalization guard (see template-sync's
`Normalize organizations during sync updates` requirement) layers additional
verification before this resolution is allowed to change a link's stored org.

#### Scenario: Legacy link stored under a parent org

- **GIVEN** a link whose stored org is the parent but whose template belongs to a
  sub-org
- **WHEN** the owning org is resolved
- **THEN** the template's sub-org is used

### Requirement: Unlink files

The system SHALL let users remove a single file's link or clear all template
links at once.

#### Scenario: Unlink one file

- **GIVEN** a linked file
- **WHEN** the user runs `Unlink from Template`
- **THEN** that file's link is removed while other links remain

#### Scenario: Unlink everything

- **GIVEN** multiple linked files
- **WHEN** the user runs `Unlink All Templates`
- **THEN** all template links are removed

### Requirement: Link a folder to an organization

The system SHALL let users link a local folder to an organization so the folder
mirrors that org's templates, and SHALL support fetching and unlinking that
folder.

#### Scenario: Link and fetch a folder

- **GIVEN** an authenticated session
- **WHEN** the user runs `Link Folder to Organization` and then `Fetch Folder`
- **THEN** the folder is associated with the chosen org and the org's templates
  are materialized as local files linked to their templates

#### Scenario: Folder fetch skips existing templates

- **GIVEN** a folder linked to an org
- **AND** one remote template is already linked locally
- **WHEN** the folder is fetched
- **THEN** only missing templates are materialized as new local files

#### Scenario: Folder fetch handles partial failures

- **GIVEN** a folder fetch over several remote templates
- **WHEN** one template cannot be fetched or written
- **THEN** the fetch continues for the remaining templates
- **AND** the user-facing result reports the successful and failed counts

#### Scenario: Local filenames are safe and unique

- **GIVEN** remote template names that contain path-unsafe characters or collide
  with existing files
- **WHEN** the folder fetch creates local files
- **THEN** filenames are sanitized and made unique before links are recorded

### Requirement: Emit change events with batching

The system SHALL emit a change event after link mutations so UI components can
react, and SHALL support a batch mode that defers events and persistence until
the batch completes.

#### Scenario: Bulk link during folder fetch

- **GIVEN** a folder fetch that creates many links
- **WHEN** the links are added inside a batch
- **THEN** a single change event and a single persistence write occur when the
  batch ends, rather than one per link

### Requirement: Non-blocking persistence

The system SHALL persist link changes on a short debounce without blocking the
user action that triggered them.

#### Scenario: Rapid successive link changes

- **GIVEN** several link mutations in quick succession
- **WHEN** they occur
- **THEN** persistence is coalesced into a debounced write and the user is not
  blocked waiting on storage
