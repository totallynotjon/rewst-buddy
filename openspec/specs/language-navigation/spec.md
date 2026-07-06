# Language Navigation Specification

## Purpose

Rewst templates reference other templates by id with `template('<uuid>')` calls.
The extension makes those references navigable inside linked files: hovering shows
what a referenced template is, and Ctrl+Click jumps to it. This capability covers
the hover and definition providers and their matching rules.

Source: `src/providers/` (`templatePatternUtils.ts`, `TemplateHoverProvider.ts`,
`TemplateDefinitionProvider.ts`, `TemplateNameCompletionProvider.ts`),
`src/models/TemplateMetadataStore.ts`.

## Requirements

### Requirement: Recognize template references

The system SHALL recognize `template('<uuid>')` calls (single or double quotes,
with optional surrounding whitespace) and identify the referenced template id at
a given cursor position.

#### Scenario: Cursor inside a reference

- **GIVEN** a line containing `template('<uuid>')`
- **WHEN** the cursor is within that call
- **THEN** the provider extracts the referenced template id

### Requirement: Return immediately for unrelated documents

To stay fast during editing, the hover and definition providers SHALL return
immediately when the document is not a linked template file, before any lookup.

#### Scenario: Hover in an unlinked file

- **GIVEN** a document that is not a linked template
- **WHEN** the user hovers anywhere
- **THEN** the provider returns with no work done

### Requirement: Show reference details on hover

On hovering a recognized reference, the system SHALL show the referenced
template's name and organization when known — preferring a local link, then a
cached metadata entry — and SHALL indicate when the template is unknown.

#### Scenario: Referenced template is linked locally

- **GIVEN** a reference whose template is linked to a local file
- **WHEN** the user hovers it
- **THEN** the hover shows the template name and org

#### Scenario: Referenced template only in cache

- **GIVEN** a reference whose template is not linked but was seen before
- **WHEN** the user hovers it
- **THEN** the hover shows the name and org from cached metadata

#### Scenario: Referenced template unknown

- **GIVEN** a reference whose template is neither linked nor cached
- **WHEN** the user hovers it
- **THEN** the hover shows the id and marks the template as unknown

#### Scenario: Session removal drops orphaned cached metadata

- **GIVEN** cached metadata loaded from a session that is then removed
- **WHEN** no remaining session manages the removed session's orgs
- **THEN** those orgs' cached entries are dropped, so hovers and navigation do
  not offer templates whose session is gone
- **AND** metadata for orgs a remaining session manages stays available
- **AND** a metadata load already in flight at removal cannot re-insert the
  dropped entries

### Requirement: Navigate to the referenced template

On Ctrl+Click of a recognized reference, the system SHALL navigate to the linked
local file when one exists, and otherwise — when the template is known from cache
— fetch and open it in the background, linking the new file.

#### Scenario: Jump to a linked file

- **GIVEN** a reference whose template is linked locally
- **WHEN** the user Ctrl+Clicks it
- **THEN** VS Code navigates to that local file

#### Scenario: Open a cached-but-unlinked template

- **GIVEN** a reference whose template is known from cache but not linked
- **WHEN** the user Ctrl+Clicks it
- **THEN** the template is fetched, saved, and linked in the background, and the
  new file opens

### Requirement: Complete template names inside template() calls

Inside an in-progress `template("...")` call, the system SHALL offer
completion items for the current org's templates, showing each template's
name and inserting its id.

#### Scenario: Completion triggered inside an open template() call

- **GIVEN** a linked file with the cursor inside `template("` with the quote
  not yet closed
- **WHEN** completion is triggered
- **THEN** each of the org's templates is offered, labeled by name, inserting
  the template id on accept

#### Scenario: Not inside a template() call

- **GIVEN** a linked file with the cursor outside any template() call
- **WHEN** completion is triggered
- **THEN** no template-name completions are offered

#### Scenario: Org has no indexed templates yet

- **GIVEN** a linked file whose org has no templates loaded in
  `TemplateMetadataStore` yet
- **WHEN** completion is triggered inside an open `template("` call
- **THEN** the provider returns an empty completion list, not no list at all
  — it recognizes the trigger position even with nothing to offer
