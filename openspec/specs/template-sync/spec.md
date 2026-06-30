# Template Sync Specification

## Purpose

Once a local file is linked to a Rewst template, the extension keeps the two in
step: pushing local edits up on save, pulling remote updates down on open, and
detecting when local and remote have diverged. This capability covers the sync
decision logic, sync-on-save, auto-fetch-on-open, conflict handling, and
background folder fetching.

Source: `src/models/SyncManager.ts`, `src/models/syncDecision.ts`,
`src/models/SyncOnSaveManager.ts`, `src/models/types.ts`,
`src/capabilities/templateSyncCapabilities.ts`, `src/utils/getHash.ts`.

## Requirements

### Requirement: Decide the sync action deterministically

On each sync the system SHALL compare the local file against the remote template
and choose exactly one action: **update-metadata**, **download-remote**,
**upload-local**, or **conflict**. The decision SHALL be evaluated in this order:

1. If the local body equals the remote body → **update-metadata**.
2. Otherwise, if the local body is empty → **download-remote**.
3. Otherwise, if the local last-known timestamp equals the remote timestamp →
   **upload-local**.
4. Otherwise → **conflict**.

#### Scenario: Local matches remote

- **GIVEN** a linked file whose text equals the remote template body
- **WHEN** a sync runs
- **THEN** the action is **update-metadata**: the link's `bodyHash` and
  referenced template ids are refreshed and no body change is sent or applied

#### Scenario: Local file is empty

- **GIVEN** a linked file with empty content and a non-empty remote template
- **WHEN** a sync runs
- **THEN** the action is **download-remote**: the document is replaced with the
  remote body and the file is saved

#### Scenario: Local edited, remote unchanged since last sync

- **GIVEN** a linked file edited locally
- **AND** the remote template's timestamp still equals the link's last-known
  timestamp
- **WHEN** a sync runs
- **THEN** the action is **upload-local**: the local body is pushed to Rewst and
  the link is updated with the response metadata

#### Scenario: Both sides changed

- **GIVEN** a linked file edited locally
- **AND** the remote template's timestamp differs from the link's last-known
  timestamp
- **WHEN** a sync runs
- **THEN** the action is **conflict**

### Requirement: Sync on save when enabled

The system SHALL push a linked file on save when sync-on-save is in effect for
that file, governed by the `rewst-buddy.syncOnSaveByDefault` setting and per-file
toggles. Files for which sync-on-save is not in effect SHALL NOT sync on save.
Per-file sync-on-save state SHALL be persisted in inclusion and exclusion lists
so toggles survive reloads and can invert cleanly when the default setting
changes.

#### Scenario: Sync-on-save enabled for a file

- **GIVEN** a linked file with sync-on-save active
- **WHEN** the user saves it
- **THEN** a sync runs for that file

#### Scenario: Sync-on-save not active

- **GIVEN** a linked file with sync-on-save off and the default disabled
- **WHEN** the user saves it
- **THEN** no automatic sync occurs

#### Scenario: Per-file toggle persists

- **GIVEN** `syncOnSaveByDefault` is disabled
- **WHEN** a linked file is explicitly enabled for sync-on-save
- **THEN** the file URI is stored in the sync inclusion list
- **AND** future saves of that linked file sync until the toggle is disabled

#### Scenario: Default enabled with one exclusion

- **GIVEN** `syncOnSaveByDefault` is enabled
- **WHEN** a linked file is explicitly disabled for sync-on-save
- **THEN** the file URI is stored in the sync exclusion list
- **AND** future saves of that linked file do not sync while other linked files do

### Requirement: Auto-fetch on open without clobbering local edits

When `rewst-buddy.autoFetchOnOpen` is enabled, the system SHALL silently download
a newer remote version on open **only** when the local file has no unsaved
divergence, i.e. the local body still hashes to the link's stored `bodyHash`.
Auto-fetch SHALL be independent of sync-on-save state, SHALL skip equal or older
remote timestamps, and SHALL fail closed without overwriting local content when
the remote fetch fails. "Newer" SHALL mean the remote `updatedAt` parses to an
instant later than the link's last-known `updatedAt`; if either timestamp is
missing, unparsable, or cannot prove the remote is newer, auto-fetch SHALL leave
the local file unchanged.

**Implementation status:** today the comparison is a strict string inequality
between `remote.updatedAt` and the link's stored timestamp, not a parsed-instant
comparison — any differing timestamp is treated as newer, and there is no
missing/unparsable fallback. Adding real timestamp parsing as described above is
tracked as follow-up work.

#### Scenario: Remote is newer and local is untouched

- **GIVEN** a linked file whose local body still matches its stored hash
- **AND** the remote template is newer than the link's last-known timestamp
- **WHEN** the file is opened
- **THEN** the remote body is downloaded silently

#### Scenario: Local has diverged

- **GIVEN** a linked file whose local body no longer matches its stored hash
- **WHEN** the file is opened with a newer remote available
- **THEN** auto-fetch does not overwrite the local file

#### Scenario: Remote fetch fails

- **GIVEN** a linked file with auto-fetch enabled
- **WHEN** the remote template cannot be fetched
- **THEN** the local file is left unchanged
- **AND** no sync upload is attempted as part of the open event

#### Scenario: Remote is not provably newer

- **GIVEN** a linked file whose local body still matches its stored hash
- **AND** the remote timestamp is equal, older, missing, or unparsable relative
  to the link's last-known timestamp
- **WHEN** the file is opened
- **THEN** auto-fetch does not replace the local file

### Requirement: Normalize organizations during sync updates

The system SHALL record the template's owning organization from trusted remote
template metadata when refreshing, downloading, or uploading a link. For every
path that can change local or remote content or link metadata, including
sync-on-save, auto-fetch-on-open, interactive sync, MCP sync, and metadata
refresh, the system SHALL verify that the fetched remote template belongs to the
expected organization before changing either side. The expected organization is
the link's trusted template-owner metadata (`template.orgId` or
`template.organization.id`) when present, otherwise the stored link organization.
A legacy link that lacks trusted template-owner metadata MAY be corrected from a
remote fetch only when the fetched template id matches the link, the resolving
session manages the remote owner, and the caller did not supply a conflicting
org id. MCP and URL-driven calls SHALL require any requested organization to
match the trusted expected organization before content changes. If the remote
organization is missing or mismatched, the sync SHALL fail closed before local
or remote mutation. The system SHALL NOT trust stale legacy link org metadata
when trusted template metadata identifies a different owning org and the remote
fetch confirms that owner.

**Implementation status:** today this guard is fully enforced only on the MCP
sync path (`runSync`); sync-on-save, auto-fetch-on-open, interactive sync, and
metadata refresh do not yet perform the verification step before changing local
or remote content. Extending the guard to those paths is tracked as follow-up
work.

#### Scenario: Stale link org is corrected

- **GIVEN** a link whose stored org is a parent or stale org
- **AND** the link lacks trusted template-owner metadata
- **AND** the remote template metadata identifies a sub-org
- **AND** the resolving session manages that sub-org
- **AND** the caller did not provide a conflicting org id
- **WHEN** a sync refreshes metadata
- **THEN** the link records the remote template's org id and name

#### Scenario: Remote template belongs elsewhere

- **GIVEN** a sync request for org A
- **AND** the remote template metadata says the template belongs to org B
- **WHEN** the sync would upload, download, auto-fetch, or refresh metadata
- **THEN** the sync is rejected before changing either side

#### Scenario: Explicit org conflicts with legacy correction

- **GIVEN** a legacy link has stored org A but no trusted template-owner metadata
- **AND** the fetched remote template belongs to org B
- **AND** the caller explicitly requested org A
- **WHEN** the sync would change local content, remote content, or link metadata
- **THEN** the sync is rejected rather than silently correcting the link to org B

#### Scenario: Remote template organization is unknown

- **GIVEN** a linked template with an expected organization
- **AND** the fetched remote template omits owning organization metadata
- **WHEN** the sync would change local content, remote content, or link metadata
- **THEN** the sync is rejected before changing either side

### Requirement: Resolve conflicts with explicit user choice

When the action is **conflict**, the system SHALL prompt the user with a modal
offering to force-upload the local version or download the latest remote version,
and SHALL abort the sync if the user dismisses the prompt.

#### Scenario: User forces the local version

- **GIVEN** a conflict prompt
- **WHEN** the user chooses to force-override
- **THEN** the local body is uploaded to Rewst

#### Scenario: User takes the remote version

- **GIVEN** a conflict prompt
- **WHEN** the user chooses to download the latest
- **THEN** the remote body replaces the local file

#### Scenario: User dismisses

- **GIVEN** a conflict prompt
- **WHEN** the user cancels
- **THEN** no change is made and the sync is aborted

### Requirement: Expose explicit sync tools

The system SHALL expose MCP sync helpers that report link state and run syncs by
explicit local path. `buddy_template_sync_status` SHALL be a read operation that
maps the sync decision into user-facing states. `buddy_template_sync` SHALL allow
automatic direction selection or explicit `upload` / `download` directions, with
approval required before uploads to Rewst. The `buddy_template_sync` tool SHALL
be classified as write-tier for external MCP exposure in every direction
because automatic sync can upload to Rewst and explicit download can overwrite a
workspace file; every call SHALL require write tools to be enabled and the
target org to pass the effective write allowlist. Download-only and
metadata-only calls do not require Rewst mutation approval, but they remain
subject to workspace target validation and sync organization guards.

#### Scenario: Sync status

- **GIVEN** a linked file
- **WHEN** `buddy_template_sync_status` is called for that file
- **THEN** the result includes whether the file is linked, the template/org ids,
  sync-on-save state, whether bodies match, and a recommended direction

#### Scenario: Approved upload

- **GIVEN** a linked file with local changes and unchanged remote metadata
- **WHEN** `buddy_template_sync` selects or is given the `upload` direction
- **THEN** the local file is saved if dirty
- **AND** the upload occurs only after approval

#### Scenario: Explicit empty upload

- **GIVEN** a linked file whose local body is empty
- **WHEN** `buddy_template_sync` is explicitly called with direction `upload`
- **THEN** the approval prompt and result state that the remote template body will
  be cleared

#### Scenario: Download direction

- **GIVEN** a linked file with remote content to take
- **WHEN** `buddy_template_sync` is explicitly called with direction `download`
- **THEN** the remote body replaces the local file without requiring a Rewst
  mutation approval

#### Scenario: MCP conflict returns data instead of a modal

- **GIVEN** a linked file where local and remote both changed
- **WHEN** `buddy_template_sync` is called with direction `auto`
- **THEN** no modal is shown to the external MCP caller
- **AND** no local or remote change is made
- **AND** the result reports the conflict and asks the caller to choose
  `upload` or `download`

### Requirement: Avoid false conflicts after upload

After a successful upload, the system SHALL update the link's last-known
timestamp to the value returned by Rewst, so the next sync does not misread its
own write as a remote change.

#### Scenario: Two saves in a row

- **GIVEN** a linked file just uploaded successfully
- **WHEN** the user edits and saves again
- **THEN** the second sync sees matching timestamps and uploads cleanly rather
  than reporting a conflict

### Requirement: Guard against concurrent syncs

The system SHALL prevent overlapping syncs of the same file.

#### Scenario: Rapid repeated saves

- **GIVEN** a file already mid-sync
- **WHEN** another sync is triggered for the same file before the first completes
- **THEN** the second is suppressed until the first finishes

### Requirement: Background folder fetch

For folders linked to an organization, the system SHALL periodically fetch new
templates from that org in the background and materialize them as linked local
files, writing in batches to avoid UI stalls and reporting how many were
fetched.

#### Scenario: New templates appear in a linked org

- **GIVEN** a folder linked to an org
- **WHEN** the background fetch interval runs and the org has templates not yet
  present locally
- **THEN** the missing templates are written as local files, linked, and the user
  is notified of the count fetched
