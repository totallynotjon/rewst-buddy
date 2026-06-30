# Session & Authentication Specification

## Purpose

Rewst Buddy talks to the Rewst GraphQL API on the user's behalf using a session
cookie copied from a logged-in browser. This capability covers turning that
credential into a working session, discovering the correct region, persisting
the credential securely, restoring it across restarts, keeping it fresh, and
managing the multiple organizations a single login can reach.

Source: `src/sessions/Session.ts`, `src/sessions/SessionManager.ts`,
`src/sessions/SessionProfile.ts`, `src/sessions/RegionConfig.ts`,
`src/sessions/CookieString.ts`.

## Requirements

### Requirement: Establish a session from a cookie/token

The system SHALL accept a Rewst session cookie (entered by the user or relayed
by the browser extension) and produce an authenticated session, or fail clearly
if the cookie is not usable.

#### Scenario: User provides a valid cookie

- **GIVEN** the user runs `Rewst Buddy: New Rewst Session`
- **WHEN** they enter a valid session cookie into the masked input
- **THEN** the extension builds a GraphQL client, validates it with a `User`
  query, and creates a session whose label is `"{username} ({orgName})"`

#### Scenario: Empty input

- **GIVEN** the New Session prompt is open
- **WHEN** the user submits an empty value
- **THEN** the extension rejects the input and does not create a session

### Requirement: Detect the correct region automatically

The system SHALL try the cookie against each configured region in
`rewst-buddy.regions` and use the first region whose `User` query returns a user
id, so the user never has to pick a region manually.

#### Scenario: Cookie belongs to a non-default region

- **GIVEN** regions are configured for North America and Europe
- **AND** the cookie is only valid in Europe
- **WHEN** a session is established
- **THEN** the extension probes North America, observes failure, probes Europe,
  succeeds, and binds the session to the European region's GraphQL endpoint

#### Scenario: Cookie is invalid everywhere

- **GIVEN** a cookie that no configured region accepts
- **WHEN** a session is attempted
- **THEN** no session is created and the user is shown an authentication error

### Requirement: Store credentials securely

The system SHALL store the raw session cookie only in VS Code `secrets`, keyed by
organization id, and SHALL store non-secret session metadata (region, org,
managed orgs, label, user) in `globalState` under `SessionProfiles`. The system
SHALL also maintain a non-secret `RewstAllKnownProfiles` cache for profiles that
have been seen before, including profiles that are not currently active. The
cookie SHALL NOT be written to `globalState`.

#### Scenario: Credential placement after login

- **GIVEN** a session is successfully established for org `org-123`
- **WHEN** persistence runs
- **THEN** the cookie value is stored via `secrets` under key `org-123`
- **AND** the session profile (without the cookie) is stored under
  `SessionProfiles`
- **AND** the profile is included in `RewstAllKnownProfiles`

#### Scenario: Known profile lookup

- **GIVEN** a previously saved profile for org `org-123`
- **WHEN** a feature needs non-secret org metadata without an active session
- **THEN** the profile can be resolved from the known-profile cache by any
  managed org id it contains

### Requirement: Restore sessions on activation

The system SHALL recreate previously authenticated sessions on extension startup
from the saved profiles plus the cookies held in `secrets`, without prompting the
user again.

#### Scenario: Restart with a saved session

- **GIVEN** a session profile and its cookie were persisted in a prior run
- **WHEN** the extension activates
- **THEN** the session is rebuilt from storage and appears in the Sessions tree
  without re-entering a cookie

### Requirement: Refresh credentials on a schedule

The system SHALL refresh active sessions periodically (every 15 minutes) by
re-requesting the region login URL with the current cookie and replacing the
stored cookie with the refreshed one.

#### Scenario: Background refresh succeeds

- **GIVEN** an active session whose cookie is approaching expiry
- **WHEN** the refresh interval fires
- **THEN** the extension obtains a new cookie from the login response, validates
  it, and updates both the in-memory session and the stored secret

### Requirement: Manage multiple organizations per session

The system SHALL treat one login as managing a primary organization plus all of
its managed sub-organizations, and SHALL resolve the correct session for any
given organization id.

#### Scenario: Operation targets a managed sub-org

- **GIVEN** a session whose login manages a parent org and several sub-orgs
- **WHEN** an operation references a sub-org id
- **THEN** the extension selects the session that manages that sub-org

#### Scenario: Re-auth drops an old managed org

- **GIVEN** a saved session for user `u1` that managed orgs A and B
- **WHEN** the same user authenticates again and the new profile only manages A
- **THEN** org A resolves to the new session
- **AND** org B no longer resolves through the active-session index

### Requirement: Run authenticated raw GraphQL requests

The system SHALL support raw GraphQL requests through an active session by
reading the session cookie from `secrets`, sending it to the session's regional
GraphQL endpoint, and returning the raw GraphQL `{ data, errors }` shape to the
caller.

#### Scenario: Raw GraphQL query

- **GIVEN** an active session with a cookie stored in `secrets`
- **WHEN** a raw GraphQL request is made through that session
- **THEN** the request carries the stored cookie to the session's regional
  GraphQL endpoint
- **AND** the response returns the backend `data` and `errors` values without
  transforming them into SDK-specific types

### Requirement: Cache validation

The system SHALL cache a successful session validation for 24 hours to avoid
re-querying the API on every use, while still re-validating after the cache
expires.

#### Scenario: Repeated use within the cache window

- **GIVEN** a session validated less than 24 hours ago
- **WHEN** it is used again
- **THEN** the extension treats it as valid without issuing another validation
  query

### Requirement: Clear sessions

The system SHALL provide a way to remove all active sessions, clearing the active
profile list from `globalState`, clearing the in-memory session and org indexes,
and updating extension context so no session is considered active.

#### Scenario: User clears sessions

- **GIVEN** one or more active sessions
- **WHEN** the user runs `Rewst Buddy: Clear Sessions`
- **THEN** active profiles are removed from `SessionProfiles`
- **AND** no org id resolves to an active session
- **AND** the Sessions tree is emptied
