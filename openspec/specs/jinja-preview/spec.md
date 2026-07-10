# Jinja Preview Specification

## Purpose

Rewst templates are Jinja rendered server-side against a workflow execution's context. Verifying
an expression today means round-tripping through the AI chat's `buddy_render_jinja` tool. This
capability puts the same render engine in a side panel: pick an execution once, then see the
active linked file (or selection) re-rendered against that context as you type.

Source: `src/commands/template/PreviewJinjaRender.ts`, `src/commands/template/PickJinjaPreviewContext.ts`,
`src/ui/jinja/JinjaPreviewSession.ts`, `src/models/JinjaPreviewContextStore.ts`, `src/workflow/executions.ts`.

## Requirements

### Requirement: Preview available only for linked files

The `Preview Jinja Render` command SHALL be available only for documents that are linked to a
Rewst template.

#### Scenario: Command run on an unlinked file

- **GIVEN** the active document is not a linked template
- **WHEN** the user runs `Preview Jinja Render`
- **THEN** no panel opens and an error notification explains the file must be linked first

### Requirement: One panel per linked document

The system SHALL show at most one Jinja Preview panel per document URI; running the command again
for the same document reveals the existing panel instead of opening a duplicate.

#### Scenario: Command run twice for the same file

- **GIVEN** a Jinja Preview panel is already open for a linked file
- **WHEN** the user runs `Preview Jinja Render` again for that same file
- **THEN** the existing panel is revealed, not duplicated

### Requirement: Context picker resolves an execution's merged snapshot once per pick

Picking a context SHALL: list workflows reachable from the file's org, list that workflow's recent
executions, then fetch and merge that execution's context snapshots into one object held for the
life of the picked context (re-fetched only on a new pick, never per keystroke). Rendering SHALL
NOT be gated on a context having been picked: with no context picked, an unset merged context is
treated as an empty object and the panel renders using only whatever overrides are present in the
vars file, since Jinja resolves undefined variables per its own normal semantics server-side.

#### Scenario: Pick context, then edit repeatedly

- **GIVEN** a context has been picked for the panel
- **WHEN** the user edits the document five times in a row
- **THEN** the context snapshots are fetched and merged exactly once (at pick time), and each edit
  only re-runs the render mutation against the already-merged context

#### Scenario: No context picked yet

- **GIVEN** a Jinja Preview panel with no context picked
- **WHEN** the panel is shown
- **THEN** it renders immediately using an empty base context merged with whatever overrides are in
  the vars file, rather than blocking on a "Pick Jinja Preview Context" prompt

### Requirement: Last-picked context is remembered per template

The system SHALL persist the last-picked context (workflow id/name, org id, execution id) per
linked template id in `globalState` key `RewstJinjaPreviewContext`, and pre-select it the next time
a preview panel opens for that template.

#### Scenario: Reopen after picking a context

- **GIVEN** a context was picked for template T in a previous panel session
- **WHEN** a new Jinja Preview panel is opened for a file linked to template T
- **THEN** the remembered context is loaded and used to render immediately, with no re-pick required

#### Scenario: Remembered execution no longer exists

- **GIVEN** a remembered execution id that the render mutation's context-fetch rejects (deleted or
  inaccessible)
- **WHEN** the panel loads and attempts to render with it
- **THEN** the panel shows an error state and offers "Pick Context" again; the stale entry is left
  in place until the user picks a replacement (picking overwrites it)

### Requirement: Render debounces on edit and selection change

The system SHALL debounce re-render by at least 300ms after the last document-content or selection
change in the previewed document, rendering the current non-empty selection if one exists, else the
whole document body.

#### Scenario: Rapid typing

- **GIVEN** a picked context and an open preview panel
- **WHEN** the user types five keystrokes within 300ms of each other
- **THEN** exactly one render request is sent, after the debounce window following the last
  keystroke

#### Scenario: Selection present

- **GIVEN** a picked context and a non-empty text selection in the previewed document
- **WHEN** the debounce fires
- **THEN** only the selected text is rendered, not the full document

### Requirement: Render errors and warnings surface in the panel, not as thrown exceptions

A Jinja error from the render mutation, or a GraphQL/network error, SHALL be shown as an in-panel
error state; a control-character warning in the rendered value SHALL be shown alongside the
rendered value. Neither SHALL crash the extension host.

#### Scenario: Jinja syntax error

- **GIVEN** the previewed text is invalid Jinja
- **WHEN** the debounced render runs
- **THEN** the panel shows the Jinja error text, and no stale rendered value is left displayed as if
  it were current

#### Scenario: Rendered value contains a control character

- **GIVEN** the rendered value contains a non-whitespace control character
- **WHEN** the render completes successfully
- **THEN** the panel shows the rendered value AND the existing regex-backreference warning copy
