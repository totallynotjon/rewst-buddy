# Standalone MCP server

## Purpose

The Rewst backend is an independently versioned npm package in this repository.
It runs without VS Code and is also embedded by the extension. The extension
owns editor UI, documents, template links, and sync-on-save orchestration.
The server owns Rewst requests, GraphQL documents, subscriptions, session
validation and refresh, working scope, and agent mutation policy.

## Requirements

### Requirement: Install and run independently

The package SHALL provide a Node CLI executable suitable for `npx`. Its packed
artifact SHALL run outside the source checkout with no VS Code runtime or build
tools. Standard input/output SHALL carry MCP protocol messages; diagnostic logs
SHALL go to standard error. `--help` and `--version` SHALL work without credentials.

#### Scenario: Headless client

- **GIVEN** only the packed npm artifact and a supported Node installation
- **WHEN** a client initializes the default stdio server and lists tools
- **THEN** the server exposes Rewst capabilities without opening VS Code
- **AND** editor-only link and document synchronization tools are absent

### Requirement: Backend ownership

All authenticated Rewst requests SHALL originate in the server package. The
extension SHALL call typed operation adapters over a private MCP connection to an embedded or shared runtime.
The editor SHALL receive profile metadata and results, never session cookies
from the server. Host storage adapters MAY use VS Code SecretStorage and
Memento; the server SHALL manage their session and scope contents.
The extension SHALL reflect loaded session snapshots in its session tree and
active-session command availability, including when attaching to an owner that
has already restored its sessions.

#### Scenario: Save a linked template

- **GIVEN** a valid session and a linked document with sync-on-save enabled
- **WHEN** the user saves that document
- **THEN** the extension resolves local content and conflict decisions
- **AND** it sends the remote update through the private MCP connection
- **AND** the server validates the session and executes the Rewst update

### Requirement: Synchronize attached editor session lifecycle

The owner process SHALL remain the canonical session store for every attached
editor. An editor attachment SHALL return a redacted session snapshot in its
response so the window can render the current sessions immediately; it SHALL
not copy cookies, tokens, or secret-storage values into a second store. The
owner SHALL notify attached editors of later session and scope changes. When
the owner connection closes unexpectedly, an attached editor SHALL clear its
cached sessions, scope, and capability catalog and reject further backend
operations. A window that starts without a verified owner SHALL use a fresh
local store and show only its own known profiles.

#### Scenario: Attach receives the canonical snapshot

- **GIVEN** a standalone owner has restored active and known sessions
- **WHEN** a VS Code window attaches over the private editor connection
- **THEN** the attach response contains the owner's current redacted session
  snapshot
- **AND** the editor does not receive cookies, tokens, or secret-store values

#### Scenario: Owner shutdown invalidates an attached editor

- **GIVEN** a VS Code window is attached to the owner
- **WHEN** the private owner connection closes unexpectedly
- **THEN** the editor clears its session, scope, and tool caches
- **AND** subsequent backend operations fail instead of using stale state

#### Scenario: Reload without an owner starts fresh

- **GIVEN** no compatible verified owner is available during startup
- **WHEN** a VS Code window initializes its backend
- **THEN** it creates or loads only its own local session store
- **AND** it does not import another process's credentials or profiles

### Requirement: Separate editor and agent authority

Trusted editor operations SHALL be registered only on private embedded or separately authenticated editor MCP
connections. Public stdio/HTTP clients SHALL NOT discover or invoke those
operations. Normal agent tools SHALL retain write toggles, organization and
workflow scope checks, resource membership checks, approval, and throttling.
Editor tools exposed through the embedding host SHALL pass through those same
agent policy checks before reaching editor adapters.

#### Scenario: Agent attempts an editor administrative operation

- **GIVEN** a public MCP client
- **WHEN** it calls `rewst_editor_operation`
- **THEN** the server returns an unknown-tool error
- **AND** no session, scope, or remote data is changed

### Requirement: Standalone credentials and policy

The standalone server SHALL accept a session cookie through an environment
variable or a local `login --stdin` command. It SHALL NOT ask an agent to put
credentials into tool arguments. Persistent credentials SHALL be encrypted
using an operator-supplied passphrase; without a passphrase, credentials SHALL
remain in memory. Writes SHALL be disabled by default. External MCP calls SHALL delegate approval to the AI client's tool-call
permissions by default, including scope changes and enabled raw mutations.
The server SHALL retain write enablement, organization/workflow scope checks,
resource ownership checks, and the separate raw GraphQL opt-in. Legacy
`approveWrites` settings SHALL NOT bypass built-in editor approval or be
required for public MCP calls. Runtime write settings remain shared by all
clients connected to the owner until restart.

#### Scenario: No write grant

- **GIVEN** a server started without write authorization
- **WHEN** a client attempts a mutation
- **THEN** no authenticated write occurs

#### Scenario: MCP approval without an editor

- **GIVEN** writes are enabled for an effective organization scope
- **AND** no editor is attached and `approveWrites` is false
- **WHEN** the AI client permits an enabled MCP write or scope change
- **THEN** Buddy does not request GUI approval
- **AND** all server-side scope and resource checks remain enforced

#### Scenario: Raw mutation declares an allowed org but targets another

- **GIVEN** raw GraphQL is explicitly enabled and the declared org is in scope
- **WHEN** an MCP client permits a mutation document targeting another org
- **THEN** Buddy delegates approval to the client without a GUI prompt
- **AND** documentation states that declared scope does not contain raw GraphQL

### Requirement: Keep editor-only tools tied to a live editor

Template sync and sync-status tools SHALL be absent and uncallable until an
editor advertises them. The last supporting editor disconnecting SHALL remove
them and notify MCP clients that the tool catalog changed. A call that loses
its editor before dispatch SHALL fail rather than execute elsewhere without an editor.
Trusted bridge metadata SHALL preserve external MCP approval routing; private
editor actions and envelopes without origin metadata SHALL retain host approval.
Tool arguments SHALL NOT select the approval origin.

#### Scenario: Editor disconnects before sync dispatch

- **GIVEN** an MCP sync call is preparing its session
- **WHEN** the last supporting editor disconnects
- **THEN** the pending call fails and subsequent cached-name calls are rejected

#### Scenario: Tool arguments attempt to change approval origin

- **GIVEN** a private editor action with an `origin: mcp` tool argument
- **WHEN** it reaches the editor capability adapter
- **THEN** it remains an editor action requiring host approval

### Requirement: Local HTTP transport

Shared HTTP serving SHALL bind to loopback, require a separate MCP bearer
token, and reject unexpected Host and Origin headers. This token SHALL NOT be a
Rewst session cookie. The existing extension bridge enable/rotation controls
SHALL continue to govern its public HTTP endpoint.
Malformed request URLs SHALL receive an HTTP 400 response without terminating
the owner or disconnecting other clients.

#### Scenario: Invalid request URL

- **GIVEN** a running shared HTTP owner
- **WHEN** a client sends a request whose URL cannot be parsed
- **THEN** the owner returns HTTP 400
- **AND** subsequent discovery and client requests remain available

### Requirement: Stream lifecycle

Conversation events and crate installation progress SHALL travel over the
private MCP connection with correlation identifiers. Cancellation SHALL reach
the underlying server operation and subscriptions SHALL be closed. Concurrent
streams SHALL not receive one another's results.
Closing a conversation stream before completion SHALL cancel its backend
operation even if the enclosing chat request remains active.

#### Scenario: Consumer ends a conversation stream early

- **GIVEN** a conversation is still streaming
- **WHEN** the consumer exits the stream for a native-tool redirect or approval
- **THEN** the previous backend operation is canceled and its subscription closes
- **AND** a replacement turn does not retain the abandoned stream

### Requirement: Reuse a verified local owner

The CLI and extension SHALL discover the configured localhost port before
starting session storage or a runtime. They SHALL authenticate an existing
compatible owner against a private local record before sending credentials.
An unknown listener SHALL cause a clear error. A bind race SHALL reuse the
verified winner instead of starting a second runtime.
An interrupted discovery response SHALL reject startup with a clear error
instead of leaving discovery pending.

#### Scenario: A standalone server is already running

- **GIVEN** an independently launched Rewst Buddy server
- **WHEN** VS Code or another stdio client starts on its port
- **THEN** it attaches to the existing server and uses its sessions and scope
- **AND** VS Code immediately populates its session tree and enables commands
  that require an active session
- **AND** closing the attached client leaves the owner running
- **AND** stopping the owner disconnects its attached clients

#### Scenario: Existing listener disconnects during discovery

- **GIVEN** the configured port has a listener
- **WHEN** it sends response headers but disconnects before completing the body
- **THEN** discovery promptly reports a probe failure
- **AND** startup does not hang or launch an unverified second owner

### Requirement: Browser session intake without VS Code

The standalone owner SHALL accept the existing browser extension's local
`addSession` request and manage validation, sessions, refresh, and scope without
an editor. Browser requests SHALL NOT expose generic editor administration.
Editor-specific requests MAY use an attached editor callback and SHALL fail
clearly when no editor is attached.

#### Scenario: Browser login with no editor

- **GIVEN** a standalone owner and no running VS Code extension
- **WHEN** the browser sends a valid session cookie through `addSession`
- **THEN** the server validates and retains the session
- **AND** public MCP tools can use it subject to the owner's scope and policy
