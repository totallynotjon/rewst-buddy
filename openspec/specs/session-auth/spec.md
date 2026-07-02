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
the session profile's primary organization id. Non-secret session metadata
(region, org, managed orgs, label, user) SHALL be stored in `globalState` under
`SessionProfiles`. The system SHALL also maintain a non-secret
`RewstAllKnownProfiles` cache for profiles that have been seen before, including
profiles that are not currently active. Managed organization ids MAY resolve to
the profile through non-secret indexes, but their ids SHALL NOT be relied on as
the primary secret key for restoration. The cookie SHALL NOT be written to
`globalState`.

**Implementation status:** today known-profile lookup resolves by org id without
distinguishing region; the region-aware selection described in the scenario
below is the target lookup contract and is tracked as follow-up work.

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

#### Scenario: Known profile lookup is region-aware

- **GIVEN** two known profiles contain the same managed org id in different
  regions
- **WHEN** a feature resolves known metadata with both an org id and Rewst base
  URL
- **THEN** the profile whose region matches the base URL is selected
- **AND** if no region is supplied, the lookup returns the first capable
  profile — a shared org id is not an error

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
given organization id by checking both the primary org and all managed orgs. When
a base URL or region is available, session resolution SHALL first narrow to
active sessions in that region and then match the requested org against primary
and managed org ids. More than one active session being able to manage the same
org id is not an error: resolution SHALL return the first capable session.
Resolution SHALL only return a session that is still valid (per the
`Cache validation` requirement), skipping a session whose validation fails in
favor of the next capable session.

#### Scenario: Operation targets a managed sub-org

- **GIVEN** a session whose login manages a parent org and several sub-orgs
- **WHEN** an operation references a sub-org id
- **THEN** the extension selects the session that manages that sub-org

#### Scenario: Duplicate org id resolves to the first capable session

- **GIVEN** two active sessions both report access to the same org id
- **WHEN** an operation references that org id without a base URL or region
- **THEN** resolution returns a capable session rather than failing as ambiguous

#### Scenario: Resolution skips a session that is no longer valid

- **GIVEN** an active session that can manage the requested org id
- **AND** that session's validation fails
- **WHEN** a session is resolved for that org
- **THEN** the invalid session is not returned
- **AND** resolution falls through to the next still-valid capable session, or
  fails when none remains

#### Scenario: A stale-but-refreshable session recovers instead of being skipped

- **GIVEN** an active session that can manage the requested org id
- **AND** that session's cached validation has failed, but its cookie still
  logs in
- **WHEN** a session is resolved for that org without a base URL or region
- **THEN** the extension refreshes the session's credentials
- **AND** the refreshed session is returned rather than being treated as
  unreachable or skipped in favor of a worse fallback

#### Scenario: URL targets a managed sub-org in the session region

- **GIVEN** a Rewst URL whose base URL identifies the European region
- **AND** the parsed organization id is a managed sub-org of an active European
  session
- **WHEN** the extension resolves a session for that URL
- **THEN** it selects the European session that manages the sub-org
- **AND** it does not fall back to a different region or default organization

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

The system SHALL provide a way to remove all saved Rewst sessions, not merely
disconnect active in-memory sessions. Clearing sessions SHALL delete raw cookies
from VS Code `secrets` for every active or known session profile, including
primary organization keys and any legacy managed-organization secret keys if
present. It SHALL remove `SessionProfiles` and `RewstAllKnownProfiles` from
`globalState`, clear in-memory sessions, org indexes, validation caches, and
known-profile caches, and update extension context so no session is considered
active.

#### Scenario: User clears sessions

- **GIVEN** one or more active sessions
- **WHEN** the user runs `Rewst Buddy: Clear Sessions`
- **THEN** active profiles are removed from `SessionProfiles`
- **AND** all known profiles are removed from `RewstAllKnownProfiles`
- **AND** raw cookies for active, known, and legacy managed-org profile keys are
  deleted from VS Code `secrets`
- **AND** no org id resolves to an active session
- **AND** the Sessions tree is emptied

#### Scenario: User clears known-only sessions

- **GIVEN** no session is active
- **AND** `RewstAllKnownProfiles` contains previously saved profiles
- **WHEN** the user runs `Rewst Buddy: Clear Sessions`
- **THEN** known profiles and their primary-org and legacy managed-org secrets
  are removed
- **AND** future startup does not restore those sessions without a new cookie

### Requirement: Remove a single session

The system SHALL provide a way to remove one authenticated or previously
authenticated session — active or known-only — without disturbing any other
session. Removing a session SHALL delete its raw cookie(s) from VS Code
`secrets` (primary organization key and any legacy managed-organization keys),
remove its profile from `SessionProfiles` (if active) and `RewstAllKnownProfiles`,
and clear its entries from in-memory sessions and org indexes. If the removed
session was the only active session, extension context SHALL be updated so no
session is considered active.

#### Scenario: User removes one active session from the Sessions tree

- **GIVEN** two or more active sessions
- **WHEN** the user right-clicks one in the Sessions tree and runs "Remove
  Session"
- **THEN** that session's cookie is deleted from `secrets`
- **AND** its profile is removed from `SessionProfiles` and
  `RewstAllKnownProfiles`
- **AND** no org id it managed resolves to it any longer
- **AND** every other active session is unaffected

#### Scenario: User removes a known-only (previously authenticated) session

- **GIVEN** no active session, but `RewstAllKnownProfiles` contains a
  previously saved profile
- **WHEN** the user runs `Rewst Buddy: Remove Session` and picks that profile
- **THEN** its cookie is deleted from `secrets`
- **AND** it is removed from `RewstAllKnownProfiles`
- **AND** future startup does not restore it without a new cookie

#### Scenario: Removing the last active session clears the active-sessions context

- **GIVEN** exactly one active session
- **WHEN** the user removes it
- **THEN** the extension no longer considers any session active
- **AND** the background credential-refresh interval stops
