# Jinja IntelliSense Specification

## Purpose

Rewst templates are Jinja. Beyond template() reference navigation (see
language-navigation), linked files get completion and hover for Rewst's
built-in Jinja filters, and keyword highlighting for Rewst's Jinja dialect
(`{% try %}`/`{% catch %}`, comprehension keywords), so writing a filter or
control structure no longer requires leaving the editor or guessing.

Source: `src/providers/jinjaPatternUtils.ts`, `src/providers/JinjaFilterProvider.ts`,
`src/providers/JinjaSemanticTokensProvider.ts`, `src/capabilities/jinjaDocsCapabilities.ts`.

## Requirements

### Requirement: Return immediately for unrelated documents

To stay fast during editing, the Jinja filter, completion, and semantic-token
providers SHALL return immediately when the document is not a linked
template file, before any lookup.

#### Scenario: Hover/completion in an unlinked file

- **GIVEN** a document that is not a linked template
- **WHEN** the user hovers or triggers completion anywhere
- **THEN** the provider returns with no work done

### Requirement: Complete Jinja filters after a pipe

Inside a `{{ }}` or `{% %}` span, immediately after a `|`, the system SHALL
offer completion items for Rewst's built-in Jinja filters, sourced from the
cached filter catalog already used by `buddy_get_jinja_filter_docs`.

#### Scenario: Trigger right after a pipe

- **GIVEN** a linked file with the cursor right after `|` inside a Jinja span
- **WHEN** completion is triggered
- **THEN** the cached filter catalog is offered as completion items, each
  labeled by name with its signature and documentation

#### Scenario: Catalog not yet cached

- **GIVEN** the filter catalog has not yet been fetched for the current org's
  engine host
- **WHEN** completion is triggered at a valid pipe position
- **THEN** no completions are returned this call, and a background fetch is
  started without blocking the caller

#### Scenario: Not after a pipe

- **GIVEN** a linked file with the cursor outside any pipe-filter position
- **WHEN** completion is triggered
- **THEN** no filter completions are offered

### Requirement: Show filter documentation on hover

Hovering a recognized filter name (immediately following a `|` inside a Jinja
span) SHALL show its signature and documentation when the catalog is cached.

#### Scenario: Hover a known filter with a warm cache

- **GIVEN** a linked file, cursor on a filter name, catalog already cached
- **WHEN** the user hovers it
- **THEN** the hover shows the filter's signature and documentation

#### Scenario: Hover with a cold cache

- **GIVEN** the filter catalog has not yet been fetched
- **WHEN** the user hovers a filter-name position
- **THEN** no hover is shown, and a background fetch is started

### Requirement: Highlight Rewst's Jinja dialect keywords

Implementation status: this is a hand-rolled `DocumentSemanticTokensProvider`
gated by link state, not a static TextMate grammar. Linked files carry no
distinct language id or file extension (any extension the user chooses at
link time), so a declarative `contributes.grammars` injection — which can
only target static language/scope selectors — cannot be gated by runtime link
status. This trades full grammar-level highlighting for exact link-state
gating, per explicit product decision.

Inside a linked file, the system SHALL highlight Jinja block-tag keywords
(`try`, `catch`, `endtry`, `for`, `endfor`, `in`, `if`, `elif`, `else`,
`endif`) when they appear inside a `{{ }}`/`{% %}` span, and SHALL NOT
highlight them when they appear as plain text outside any span.

#### Scenario: Keyword inside a Jinja span

- **GIVEN** a linked file containing `{% try %}...{% catch %}...{% endtry %}`
- **WHEN** semantic tokens are requested
- **THEN** `try`, `catch`, and `endtry` are tokenized as keywords

#### Scenario: Same word outside any span

- **GIVEN** a linked file containing the word "for" in plain prose text
  outside any `{{ }}`/`{% %}` span
- **WHEN** semantic tokens are requested
- **THEN** that occurrence is not tokenized
