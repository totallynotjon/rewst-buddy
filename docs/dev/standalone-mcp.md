# Server and extension package boundary

Keep the extraction in this repository. `packages/mcp-server` has its own npm
name, version, executable, README, and publishable artifact. A separate Git
repository is unnecessary for independent installation or versioning, and a
shared checkout keeps contract changes and editor compatibility reviewable in
one change.

The runtime dependency runs in one direction:

```text
VS Code UI / documents / links / sync decisions
              |
        typed MCP client
              |
      private in-memory or local HTTP MCP transport
              |
    Rewst Buddy server package
    sessions / scope / policy / GraphQL / subscriptions
              |
            Rewst
```

The same server package runs without VS Code with a public stdio or localhost
HTTP transport. Launchers discover and authenticate an existing local owner
before touching session stores or starting another runtime. The first process
owns the listener and state; attached clients only close their own connections.
Public servers expose ordinary policy-gated capabilities. The embedded editor
connection additionally registers private operations for explicit editor
commands and streaming UI requests. A public tool argument cannot enable those
operations. Optional editor capabilities are installed by the extension and
pass through the ordinary server policy boundary.

The extension supplies storage, logging, token prompt, and approval UI ports.
The standalone host supplies local state and default encrypted credential
storage. Rewst cookies stay behind the server boundary after input. Existing
profile/secret keys are retained when embedding to preserve saved sessions.

Build with `npm run build:mcp`; run headless tests with `npm run test:mcp`.
The [package README](../../packages/mcp-server/README.md) is the operator guide
for npx installation, stdio and Streamable HTTP client configuration, session
intake, policy flags, and troubleshooting. Keep user setup details there rather
than duplicating them in this architecture note. Building or packing does not
publish the npm package.

A later repository split should preserve the npm contract and move this package,
its tests, and its release workflow. It is worth doing when maintainers or release
cadence diverge, after the extension consumes a stable package API. During this
migration, source compatibility barrels keep existing imports pointed at the
single server implementation.

An attached editor registers optional UI callbacks over a separately authenticated
MCP connection. Approval dialogs, token prompts, template opening, and local
capabilities cross that connection; Rewst I/O remains in the server. Browser
`addSession` handoff works without an editor. A public MCP bearer cannot call the
private editor/session administration surface. The server verifies its owner-only
discovery record with a challenge before a client uploads a cookie.

The shared listener is claimed before runtime initialization. HTTP operations
wait for runtime readiness; discovery is available during startup. Bind races
retry discovery, while unknown listeners fail without sending credentials.
Standalone HTTP mode keeps the server alive independently of a stdio client or
VS Code. A process that attaches never stops the shared owner.

An attached editor mirrors the owner's current sessions and scope. If the owner
connection closes unexpectedly, reload the VS Code window before starting a new
local server.

The public surface has three distinct credential paths. `REWST_SESSION_COOKIE`
and browser `addSession` supply a Rewst session to the owner. The optional
`REWST_BUDDY_PASSPHRASE` unlocks the standalone encrypted credential vault.
`REWST_BUDDY_MCP_TOKEN` authenticates public Streamable HTTP clients and never
acts as a Rewst credential. Public MCP tools cannot submit or retrieve Rewst
cookies; private editor operations handle VS Code session administration.

Read-only GraphQL exploration is part of the default public capability set.
Typed mutations require the owner's write switch and effective org scope. External MCP clients enforce their own tool permissions without editor prompts.
Arbitrary GraphQL documents require the separate mutation switch and are not
contained by their declared organization. Built-in editor actions retain host
approval. Trusted bridge metadata preserves that distinction for optional editor
tools, which disappear when no supporting editor is connected.

## Standalone credential persistence

Standalone logins survive restarts using encrypted credentials protected by the
OS credential store. Headless hosts can instead supply a passphrase. Stop the
current owner before running `login --stdin`; browser handoff works while the
owner is running. An unavailable credential store produces an error rather than
silently losing the login. See the
[package authentication guide](../../packages/mcp-server/README.md#encrypted-persistent-login)
for platform requirements and recovery.
