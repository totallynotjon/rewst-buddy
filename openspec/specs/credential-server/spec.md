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

The system SHALL run an HTTP server bound only to a loopback host from
`rewst-buddy.server.host` (default `127.0.0.1`; allowed forms are
`127.0.0.1`, `localhost`, `::1`, or `[::1]`) and
`rewst-buddy.server.port` (default `27121`, range 1024–65535). The server SHALL
refuse to start rather than bind to a wildcard, LAN, public, or otherwise
non-loopback interface. The server SHALL run when either
`rewst-buddy.server.enabled` or `rewst-buddy.mcp.enable` is on, and SHALL guard
against concurrent starts.

**Implementation status:** today the configured host is passed to `listen()`
unchecked — a non-loopback `server.host` value is not validated or rejected
before binding. Validating the host and refusing non-loopback values, as
described above, is tracked as a security-relevant follow-up.

#### Scenario: Server enabled

- **GIVEN** `rewst-buddy.server.enabled` is on
- **WHEN** the extension activates
- **THEN** the server listens on the validated loopback host and port

#### Scenario: Non-loopback host is rejected

- **GIVEN** `rewst-buddy.server.host` is `0.0.0.0`, `::`, a LAN address, a
  public address, or a hostname that does not resolve to loopback
- **WHEN** the extension attempts to start the credential server
- **THEN** the server does not bind the port
- **AND** the user is notified that only localhost bindings are allowed

#### Scenario: Kept alive by the MCP bridge

- **GIVEN** `rewst-buddy.server.enabled` is off but `rewst-buddy.mcp.enable` is on
- **WHEN** the extension runs
- **THEN** the server stays up to serve the bridge

#### Scenario: Manual start

- **WHEN** the user runs `Rewst Buddy: Start Server`
- **THEN** the server starts if it is not already running

### Requirement: Reject non-local HTTP requests

The system SHALL treat the credential server as a localhost-only control plane.
For every route, including session ingestion, template-open requests, static
responses, and the external MCP endpoint, the server SHALL require a loopback
remote address and a loopback `Host` header. Requests with a non-loopback host,
forwarded host, or HTTP(S) browser origin that would allow remote websites or
network peers to drive the server SHALL be rejected before reading credentials
or executing actions. Companion browser-extension origins MAY be allowed only
when the request still targets a loopback host and remote address. The server
SHALL NOT use wildcard CORS for routes that can ingest credentials or trigger
actions; preflight responses SHALL be emitted only after the same local request
validation passes.

**Implementation status:** today only the external `/mcp` route enforces a Host
allowlist (via the MCP SDK's `allowedHosts`); the session-ingestion and
template-open routes perform no Host or remote-address check and respond with a
wildcard `Access-Control-Allow-Origin: *`. Implementing the loopback enforcement
and non-wildcard CORS described above for those routes is tracked as a
security-relevant follow-up.

#### Scenario: Non-local Host header

- **GIVEN** the server is listening on `127.0.0.1`
- **WHEN** a request arrives with `Host: attacker.example`
- **THEN** the request is rejected before any credential, MCP, or template action
  runs

#### Scenario: Missing or invalid Host header

- **GIVEN** the server receives a request for a credential or action route
- **WHEN** the `Host` header is missing, malformed, or names a non-loopback host
- **THEN** the request is rejected before reading the request body

#### Scenario: Browser request from remote origin

- **GIVEN** a browser sends an add-session or open-template request
- **AND** the request origin or forwarded-host metadata indicates a non-loopback
  HTTP(S) web origin
- **WHEN** the server handles the request
- **THEN** the request is rejected rather than relying on permissive CORS

#### Scenario: Local preflight

- **GIVEN** a browser sends an `OPTIONS` preflight to a credential or action
  route
- **AND** the remote address, `Host`, and `Origin` are loopback or an allowed
  browser-extension origin targeting loopback
- **WHEN** the server answers the preflight
- **THEN** the CORS response names the allowed origin instead of `*`

### Requirement: Create a session from a posted cookie

The system SHALL accept a request to add a session carrying a non-empty cookie
string, create and validate a session from it, and report the outcome. Session
creation from a posted cookie SHALL reuse the same region-detection and
session-establishment path as a manually entered cookie (see session-auth's
`Detect the correct region automatically` requirement).

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
