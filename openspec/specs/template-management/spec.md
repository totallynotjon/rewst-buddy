# Template Management Specification

## Purpose

Beyond linking and syncing existing templates, the extension lets users create,
delete, open, locate, and group Rewst templates from inside VS Code. This
capability covers those lifecycle and navigation operations.

Source: `src/commands/template/` (and subdirectories),
`src/utils/openTemplateById.ts`, `src/utils/createAndLinkNewTemplate.ts`,
`src/models/TemplateBundleManager.ts`, `src/utils/findAllTemplateReferences.ts`.

## Requirements

### Requirement: Create a template from a local file

The system SHALL create a new Rewst template from a saved, not-yet-linked local
file, then link that file to the new template.

#### Scenario: User creates a template

- **GIVEN** a saved local file that is not already linked
- **WHEN** the user runs `Create Template`, picks an organization, and confirms a
  name (defaulting to the file's base name)
- **THEN** the extension creates the template in Rewst with the file's current
  text as the body
- **AND** links the file to the new template, recording its content hash and any
  referenced template ids

#### Scenario: File already linked

- **GIVEN** a file that is already linked to a template
- **WHEN** the user runs `Create Template`
- **THEN** the command refuses, since the file is already associated

### Requirement: Delete a template with confirmation

The system SHALL delete a template from Rewst only after an explicit modal
confirmation, and SHALL remove the local link after a successful remote delete.

#### Scenario: User confirms deletion

- **GIVEN** a linked file
- **WHEN** the user runs `Delete Template` and confirms the "cannot be undone"
  modal
- **THEN** the template is deleted in Rewst and the local link is removed

#### Scenario: User cancels

- **GIVEN** the delete confirmation modal
- **WHEN** the user dismisses it
- **THEN** nothing is deleted and the link remains

### Requirement: Open a template, reusing an existing link

The system SHALL open a template by id, and SHALL reuse an already-linked local
file rather than creating a duplicate; only when no link exists does it fetch the
template and create a new local file.

#### Scenario: Template already linked locally

- **GIVEN** a template that is already linked to a local file
- **WHEN** the user opens that template (interactively or from a URL)
- **THEN** the existing local file is opened instead of fetching a duplicate
- **AND** if several files link the same template, the user is offered a choice

#### Scenario: Template not yet linked

- **GIVEN** a template with no local link
- **WHEN** the user opens it
- **THEN** the extension fetches the full template, prompts for a save location,
  and links the new file

### Requirement: Open or link a template from its Rewst URL

The system SHALL accept a Rewst template URL, parse the organization, template,
and base URL from it, and either open the template (reusing a link when present)
or link an existing local file to it.

#### Scenario: Open from URL

- **GIVEN** a Rewst template URL
- **WHEN** the user runs `Open Template from URL`
- **THEN** the org/template/base are parsed and the template is opened with the
  same reuse behavior as interactive open

#### Scenario: Link a local file from URL

- **GIVEN** a saved, unlinked local file and a Rewst template URL
- **WHEN** the user runs `Link File to Template from URL`
- **THEN** the file is linked to the parsed template and an immediate sync
  reconciles local and remote

### Requirement: Copy a linked template's id

The system SHALL copy the linked template's id to the clipboard.

#### Scenario: Copy id

- **GIVEN** a linked file
- **WHEN** the user runs `Copy Template ID`
- **THEN** the template id is placed on the clipboard

### Requirement: Open a template in the Rewst web app

The system SHALL open the linked template in the Rewst web UI, constructing the
URL from the organization's region base URL plus the org and template ids.

#### Scenario: Open in Rewst

- **GIVEN** a linked file whose org has a known region
- **WHEN** the user runs `Open in Rewst`
- **THEN** the browser opens the template's page in the correct regional Rewst
  instance

### Requirement: Bundle related templates

The system SHALL group linked templates into bundles based on their reference
graph — templates that reference other linked templates form dependency trees —
and SHALL present those bundles in a tree view, refreshing as links change.

#### Scenario: Templates that reference each other

- **GIVEN** several linked templates where some reference others by id
- **WHEN** bundles are built
- **THEN** root templates (referencing others but unreferenced themselves) anchor
  trees containing all reachable referenced templates
- **AND** templates with no references in either direction appear as standalone

#### Scenario: Duplicate bundle names

- **GIVEN** two bundles whose root templates share a display name
- **WHEN** the tree is rendered
- **THEN** the names are disambiguated by appending part of the template id
