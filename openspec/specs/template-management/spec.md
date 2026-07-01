# Template Management Specification

## Purpose

Beyond linking and syncing existing templates, the extension lets users create,
delete, open, locate, and group Rewst templates from inside VS Code. This
capability covers those lifecycle and navigation operations.

Source: `src/commands/template/`, `src/utils/openTemplateById.ts`,
`src/utils/createAndLinkNewTemplate.ts`,
`src/providers/templatePatternUtils.ts`, `src/models/TemplateBundleManager.ts`,
`src/capabilities/templateCloneCapabilities.ts`.

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
and base URL from it, resolve a session whose region matches that base URL and
whose primary or managed organizations include the parsed organization, and
either open the template (reusing a link when present) or link an existing local
file to it.

#### Scenario: Open from URL

- **GIVEN** a Rewst template URL
- **WHEN** the user runs `Rewst Buddy: Open Template from URL`
- **THEN** the org/template/base are parsed and the template is opened with the
  same reuse behavior as interactive open
- **AND** if the parsed org is a managed sub-organization, the session is
  resolved by both matching region/base URL and managed-org membership

#### Scenario: Link a local file from URL

- **GIVEN** a saved, unlinked local file and a Rewst template URL
- **WHEN** the user runs `Rewst Buddy: Link File to Template from URL`
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

#### Scenario: Region from active session

- **GIVEN** the linked template belongs to an org managed by an active session
- **WHEN** the user opens it in Rewst
- **THEN** the URL uses that active session's region base URL

#### Scenario: Region from known profile

- **GIVEN** no active session manages the linked template's org
- **AND** a known profile contains the org as a primary or managed org
- **WHEN** the user opens it in Rewst
- **THEN** the URL uses the known profile's region base URL

#### Scenario: Fallback region

- **GIVEN** no active session or known profile identifies the org's region
- **WHEN** the user opens the linked template in Rewst
- **THEN** the URL falls back to the default configured region

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

#### Scenario: Shared referenced template

- **GIVEN** two root templates both reference the same linked child template
- **WHEN** bundles are built
- **THEN** the shared child appears under each root bundle that reaches it

#### Scenario: Cyclic references

- **GIVEN** linked templates that reference each other in a cycle
- **WHEN** bundles are built
- **THEN** traversal terminates without duplicating nodes indefinitely
- **AND** the cycle is represented once along the reachable path

#### Scenario: Unknown references

- **GIVEN** a linked template references an id that is not linked locally and not
  present in cached metadata
- **WHEN** bundles are built
- **THEN** the unknown reference is ignored for bundle-tree structure

#### Scenario: Legacy links missing reference metadata

- **GIVEN** an older link whose referenced-template ids were not persisted
- **WHEN** bundles are built
- **THEN** references are re-derived from the local template body when possible

### Requirement: Clone a template bundle through MCP

The system SHALL provide an MCP-only write tool that clones a root template and
its same-org referenced template graph into a target organization. The clone
operation SHALL prompt once per target org/root template scope, rewrite
references to newly created clone ids, deduplicate repeated dependencies, bound
the traversal by depth and template count, and roll back created clones if a
create or update step fails. The target organization is the write destination and
SHALL pass external MCP write-tool enablement, working-scope or allowlist gates,
and per-call approval before any clone template is created. The source root
SHALL be read from an active session that can reach it, and an optional
`sourceOrgId` SHALL be verified against the root template's owning organization.
The operation creates remote Rewst templates only; it SHALL NOT create local
files or local template links.

The dependency graph SHALL be derived from detected template body references
only, using supported `template('<id>')`-style references. The clone SHALL copy
body, content type, language, context, clone overrides, and description when
available, but SHALL NOT copy tags unless that behavior is specified by a future
capability. References embedded only in context or clone overrides SHALL NOT be
followed or rewritten. Detected foreign-org, missing, depth-limited, or
count-limited body references SHALL be left unchanged and reported as skipped;
unsupported or dynamic references that the parser cannot detect are outside the
clone graph and are not guaranteed to be reported.

#### Scenario: Clone a dependency chain

- **GIVEN** a root template references another template in the same source org
- **WHEN** the bundle clone tool is approved
- **THEN** both templates are created in the target org
- **AND** the root clone's body references the cloned dependency id

#### Scenario: Shared dependency cloned once

- **GIVEN** two templates in the bundle reference the same dependency
- **WHEN** the bundle is cloned
- **THEN** that dependency is created once
- **AND** all cloned references point to the single new dependency id

#### Scenario: Foreign-org reference

- **GIVEN** the source template references a template owned by another org
- **WHEN** the bundle is cloned
- **THEN** the foreign template is not cloned
- **AND** the result reports that the reference was skipped

#### Scenario: Clone metadata caveats

- **GIVEN** a root template has tags and clone overrides
- **AND** a dependency id appears only inside clone overrides
- **WHEN** the bundle is cloned
- **THEN** body, content type, language, context, clone overrides, and
  description are copied when available
- **AND** tags are not copied
- **AND** the dependency id inside clone overrides is not followed or rewritten
- **AND** only detected body references are included in skipped-reference
  reporting

#### Scenario: Clone verifies source org

- **GIVEN** the caller passes a `sourceOrgId`
- **WHEN** the root template is fetched from a different owning org
- **THEN** the clone is rejected before creating any target templates

#### Scenario: Clone creates no local link

- **GIVEN** a bundle clone completes successfully
- **WHEN** the new templates are created in the target org
- **THEN** no local file or link is created automatically

#### Scenario: Clone rollback

- **GIVEN** some clone templates have already been created
- **WHEN** a later create or update step fails
- **THEN** the tool deletes the templates it created before returning the failure
