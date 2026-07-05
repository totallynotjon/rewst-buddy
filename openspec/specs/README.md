# Rewst Buddy — Distilled Specifications

This directory captures the **current** behavior of the Rewst Buddy VS Code
extension as OpenSpec-style capability specifications. It was distilled from the
existing codebase (not authored before it) — a brownfield snapshot of what the
extension does today, so future changes can be proposed as deltas against a
known baseline.

Each spec describes observable behavior using normative requirements
(`The system SHALL ...`) and `GIVEN / WHEN / THEN` scenarios. Specs intentionally
avoid naming private functions or line numbers — they describe _what_ the system
guarantees, not _how_ the code is structured. The "Source" line under each
capability points at the implementation for traceability.

## Capability map

| Capability                                         | What it covers                                                                              | Status  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------- |
| [session-auth](session-auth/spec.md)               | Establishing, persisting, restoring, refreshing Rewst sessions; multi-region; multi-org     | Drafted |
| [template-linking](template-linking/spec.md)       | Associating local files/folders with Rewst templates; rename/delete tracking; stale pruning | Drafted |
| [template-sync](template-sync/spec.md)             | Sync-on-save, auto-fetch-on-open, conflict detection, folder background fetch               | Drafted |
| [template-management](template-management/spec.md) | Create / delete / open / copy-id / open-in-Rewst / bundle templates                         | Drafted |
| [mcp-bridge](mcp-bridge/spec.md)                   | MCP server exposure, token, read/write tool gating, working scope                           | Drafted |
| [ai-chat](ai-chat/spec.md)                         | Cage-Free Rewsty chat provider, Ask Rewst AI, Buddy tool protocol, apply edits              | Drafted |
| [credential-server](credential-server/spec.md)     | Local HTTP server that receives session cookies from the browser extension                  | Drafted |
| [language-navigation](language-navigation/spec.md) | Hover info and Ctrl+Click navigation for `template()` references                            | Drafted |
| [jinja-intellisense](jinja-intellisense/spec.md)   | Jinja filter completion, hover, and dialect keyword highlighting for linked files           | Drafted |

Each capability above is written out in full. Together they form a behavioral
baseline of the extension as it exists today.

## Conventions

- **Requirement:** a single normative guarantee, stated with `SHALL`.
- **Scenario:** a concrete behavior under that requirement, in `GIVEN/WHEN/THEN`.
- Settings, command titles, and storage keys quoted here mirror
  `package.json` `contributes.*` and the extension's persistence keys.
- **Implementation status:** when a requirement states the intended/correct
  contract but the current code does not yet fully implement it, a short
  _Implementation status_ note follows the requirement saying so. The
  requirement stays the target contract; the note tracks the gap rather than
  letting the requirement quietly describe a bug as if it were the design.
