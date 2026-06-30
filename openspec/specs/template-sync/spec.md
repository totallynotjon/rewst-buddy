# Template Sync Specification

## Purpose

Once a local file is linked to a Rewst template, the extension keeps the two in
step: pushing local edits up on save, pulling remote updates down on open, and
detecting when local and remote have diverged. This capability covers the sync
decision logic, sync-on-save, auto-fetch-on-open, conflict handling, and
background folder fetching.

Source: `src/models/SyncManager.ts`, `src/models/syncDecision.ts`,
`src/models/SyncOnSaveManager.ts`, `src/utils/getHash.ts`.

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

#### Scenario: Sync-on-save enabled for a file

- **GIVEN** a linked file with sync-on-save active
- **WHEN** the user saves it
- **THEN** a sync runs for that file

#### Scenario: Sync-on-save not active

- **GIVEN** a linked file with sync-on-save off and the default disabled
- **WHEN** the user saves it
- **THEN** no automatic sync occurs

### Requirement: Auto-fetch on open without clobbering local edits

When `rewst-buddy.autoFetchOnOpen` is enabled, the system SHALL silently download
a newer remote version on open **only** when the local file has no unsaved
divergence, i.e. the local body still hashes to the link's stored `bodyHash`.

#### Scenario: Remote is newer and local is untouched

- **GIVEN** a linked file whose local body still matches its stored hash
- **AND** the remote template is newer than the link's last-known timestamp
- **WHEN** the file is opened
- **THEN** the remote body is downloaded silently

#### Scenario: Local has diverged

- **GIVEN** a linked file whose local body no longer matches its stored hash
- **WHEN** the file is opened with a newer remote available
- **THEN** auto-fetch does not overwrite the local file

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
