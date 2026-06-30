# Credential Server Specification

## Purpose

Copying a Rewst session cookie by hand is awkward, so the extension runs a small
localhost HTTP server that a companion browser extension can post the cookie to,
turning it into a session automatically. The same endpoint can also ask the
extension to open a specific template. This capability covers that server.

Source: `src/server/` (`Server.ts`, `config.ts`, request handlers),
`src/commands/server/StartServer.ts`.

## Requirements

### Requirement: Run a localhost-only server when enabled

The system SHALL run an HTTP server bound to `rewst-buddy.server.host` (default
`127.0.0.1`, localhost-only) and `rewst-buddy.server.port` (default `27121`,
range 1024–65535). The server SHALL run when either `rewst-buddy.server.enabled`
or `rewst-buddy.mcp.enable` is on, and SHALL guard against concurrent starts.

#### Scenario: Server enabled

- **GIVEN** `rewst-buddy.server.enabled` is on
- **WHEN** the extension activates
- **THEN** the server listens on the configured host and port

#### Scenario: Kept alive by the MCP bridge

- **GIVEN** `rewst-buddy.server.enabled` is off but `rewst-buddy.mcp.enable` is on
- **WHEN** the extension runs
- **THEN** the server stays up to serve the bridge

#### Scenario: Manual start

- **WHEN** the user runs `Rewst Buddy: Start Server`
- **THEN** the server starts if it is not already running

### Requirement: Create a session from a posted cookie

The system SHALL accept a request to add a session carrying a non-empty cookie
string, create and validate a session from it, and report the outcome.

#### Scenario: Valid cookie posted

- **GIVEN** the browser extension posts an add-session request with a valid cookie
- **WHEN** the server handles it
- **THEN** a session is created and validated and the response reports success
  with the session label

#### Scenario: Cookie creates but fails validation

- **GIVEN** a posted cookie that builds a session but fails validation
- **WHEN** the server handles it
- **THEN** the response reports a validation failure

#### Scenario: Malformed request

- **GIVEN** a request missing the required cookie string
- **WHEN** the server handles it
- **THEN** the request is rejected as invalid

### Requirement: Open a template on request

The system SHALL accept a request to open a template by org id and template id,
reusing an existing link when present and otherwise fetching and linking a new
local file.

#### Scenario: Open a linked template

- **GIVEN** an open-template request whose template is already linked
- **WHEN** the server handles it
- **THEN** the linked file is refreshed from remote and shown

#### Scenario: Open an unlinked template

- **GIVEN** an open-template request whose template has no local link
- **WHEN** the server handles it
- **THEN** the template is fetched and the user is prompted to save and link it
