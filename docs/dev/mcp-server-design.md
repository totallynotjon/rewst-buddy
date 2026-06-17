# MCP Server — Design Draft

> Status: **DRAFT** (pre-build). Captures the agreed direction for adding Model
> Context Protocol support to Rewst Buddy. Decisions locked so far: **stdio
> transport**, **read-only by default**, **credential-free bridge process**.

## Goal

Expose Rewst (templates, workflows, bundles) as MCP tools/resources so external
MCP clients (Claude Desktop, Claude Code, Cursor) can operate against Rewst
through the authenticated, multi-org sessions the extension already manages. The
extension's solved auth layer (encrypted cookies, region detection, refresh,
multi-org) is the asset being reused — clients inherit it instead of re-solving
it.

Secondary outcome: converge the in-extension Cage-Free Rewsty chat tools and the
MCP tools onto one capability definition so each Rewst operation is defined once.

## The constraint that dictates the architecture

Rewst cookies live in VS Code `secrets`, readable **only inside the extension
host**. A stdio MCP server spawned by Claude Desktop is a **separate process**
and cannot read those secrets. To honor the stdio choice _and_ reuse the solved
auth, the stdio binary must be a **thin, credential-free proxy** that forwards
tool calls back into the running extension (which holds the sessions and already
runs a localhost server).

## Architecture

```
Capability Registry (src/capabilities)  ← single source of truth
  Capability = ToolSpec + access(read|write) + settings gate + handler(ctx)
        │
        ├── Surface A: MCP server (Role 1)
        ├── Surface B: Cage-Free Rewsty chat (lmTools)
        └── Surface C (optional): VS Code LM tools (Copilot agent mode)

MCP path:
  Claude Desktop/Code
    └─(MCP stdio JSON-RPC)→ stdio bridge  (src/mcp/bin/rewst-mcp.js, NO secrets)
        └─(localhost HTTP + token)→ extension server (src/server, 8765)
            └─ SessionManager + Session.rawGraphql → Rewst GraphQL
```

Surfaces are thin adapters; the registry is the brain. Adding a capability
surfaces it on every enabled surface automatically.

## Reused building blocks (already in the codebase)

- `ToolSpec { name, description, args, inputSchema }` — `src/ui/chat/tools/toolProtocol.ts`
- Registry-from-spec-arrays pattern — `src/ui/chat/model/lmTools.ts` (`GOVERNED_TOOL_SPECS`)
- Dep-injected execution — `createGraphqlDeps(session)` → `session.rawGraphql`, `runGraphqlTool` in `src/ui/chat/tools/graphqlTool.ts`
- Per-scope mutation approval — `MutationScope`, `approveMutationScope`, `isMutationScopeApproved` (`graphqlTool.ts`)
- Localhost server lifecycle + action dispatch — `src/server/Server.ts` (`processRequest` switch)
- `Session.rawGraphql(query, variables)`, `SessionManager` for session lookup
- Manifest/spec sync enforcement — `packageManifest.test.ts`

## Phases

### Phase 0 — Capability registry refactor (foundation, no user-visible change)

- New `src/capabilities/` (+ `@capabilities` alias in **both** `tsconfig.json`
  and `webpack.config.cjs`).
- `Capability { spec: ToolSpec; access: 'read'|'write'; enabled(settings); run(input, ctx) }`
  with `CapabilityContext { session: Session; orgId: string }` — session injected, never secrets.
- Migrate read paths of `GRAPHQL_TOOL_SPECS` into capabilities; `lmTools` derives
  its governed specs from the registry via a temporary shim (chat behavior unchanged).
- Extend `packageManifest.test.ts` to cover the registry.

### Phase 1 — stdio MCP server, read-only (headline milestone)

**1a. MCP actions on the existing server** (`Server.ts` `processRequest`):
`mcp.listTools`, `mcp.callTool`, `mcp.listResources`, `mcp.readResource`.

- `callTool` resolves `{ orgId }` → `Session` via `SessionManager`, runs the capability.
- **Read-only enforced at the server boundary**: reject `access:'write'` regardless of bridge input.
- Guard with a bridge token (`x-rewst-mcp-token`).

**1b. stdio bridge** `src/mcp/bin/rewst-mcp.ts` (separate webpack entry → `dist/mcp/rewst-mcp.js`):

- `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport`.
- Maps `tools/list` → `mcp.listTools`, `tools/call` → `mcp.callTool`.
- Holds no credentials; reads port + token from a discovery file / env.
- Extension unreachable → MCP error "Open VS Code with Rewst Buddy running."

**Onboarding command** `GenerateMcpConfig` → writes/prints client config JSON.

Initial read tools: `list_orgs`, `list_templates`, `get_template`,
`list_workflows`, `get_workflow`, `rewst_graphql_query` (read-only), `get_bundle`.
Resources: `rewst://{org}/templates`, `…/templates/{id}`, `…/workflows`.

### Phase 2 — converge chat onto the registry

Remove the Phase 0 shim; `lmTools` consumes `src/capabilities` natively. One
definition feeds both chat and MCP.

### Phase 3 — write capabilities, opt-in + approved

`update_template_body`, `create_template`, `export_workflow`, `import_bundle`.
Reuse the existing mutation-approval machinery; unapproved writes return a
structured "approval required" result; **approval happens in VS Code**, not the
external client. Setting `rewst-buddy.mcp.enableWriteTools` (default false).

### Phase 4 — (optional, deferred) MCP client / Role 2

Only if Cage-Free Rewsty should orchestrate external servers server-side.
Otherwise VS Code's native MCP client covers user-wired external servers.

## Settings (`rewst-buddy.mcp.*`)

| Setting                | Default   | Effect                               |
| ---------------------- | --------- | ------------------------------------ |
| `mcp.enable`           | `false`   | Master switch; gates MCP actions     |
| `mcp.enableWriteTools` | `false`   | Allows `access:'write'` capabilities |
| `mcp.enabledTools`     | all reads | Allowlist of capability names        |

## File layout

```
src/capabilities/   index.ts (@capabilities), Capability.ts, registry.ts, *.test.ts
src/mcp/            index.ts, McpActions.ts (server-side), bin/rewst-mcp.ts (bridge)
src/server/Server.ts   + mcp.* action cases
src/commands/mcp/   GenerateMcpConfig.ts, EnableMcpServer.ts
```

## Testing (CLAUDE.md mandates)

- Unit: registry gating (read/write, settings), each capability handler via
  `MockWrapper`, MCP action serialization, write-rejection at boundary, token guard.
- Integration (`REWST_TEST_TOKEN`): `mcp.callTool` round-trip for read tools.
- Bridge: stdio↔HTTP mapping with stubbed fetch (no real socket).

## Docs to update on ship

`docs/features.md` (deep dive), `docs/reference.md` (commands + `mcp.*` settings),
`README.md` features bullet, `CHANGELOG.md`.

---

## Pre-build considerations (open — resolve before/while building)

These change what we build; tracked here so they aren't discovered mid-implementation.

1. **Port + token discovery.** The default port (8765) is configurable and falls
   back on `EADDRINUSE`. The bridge must discover the _live_ port + current token,
   not assume them. Plan: extension writes `~/.rewst-buddy/mcp.json` (mode 0600)
   on activation with `{ port, token, pid, extensionVersion }`; bridge reads it.
   Token rotates per activation.

2. **Multiple VS Code windows.** Each window runs its own extension host. Only one
   can bind the port; the rest hit `EADDRINUSE` (existing behavior). The bridge
   therefore talks to **whichever window owns the port**, which may not be the one
   the user is looking at, and its sessions differ. Need a defined story: e.g.,
   the port-owning window is the MCP host; surface which org/sessions it exposes.

3. **Node on PATH for spawning.** The client config uses `"command": "node"`.
   Claude Desktop spawns independently of VS Code's bundled node, so node must be
   on the user's PATH — document it, or ship/launch differently.

4. **Session expiry during long-lived MCP use.** Cookies refresh on a ~15-min
   cycle inside the extension. An agent calling hours later may hit a stale
   session. `callTool` must run validate/refresh (SessionManager path) and return
   an actionable "re-authenticate in VS Code" error when refresh fails.

5. **Audit logging.** Every MCP call hits a real MSP org. Log each tool call
   (tool, orgId, outcome) to the output channel via `log` so the user can see what
   the external agent did — essential for trust given blast radius.

6. **Rate limiting / throttle.** An agent can hammer Rewst GraphQL via the cookie
   session, risking platform protections or session health. Add a throttle on
   MCP-originated calls (the chat path has `maxToolRounds`; MCP needs its own cap).

7. **Result size / truncation.** GraphQL results (workflows, executions) can be
   large and expensive in agent token terms. Reuse the chat's truncation +
   "continue" convention for MCP responses.

8. **Structured error contract.** Define a stable error shape across server↔bridge
   for: session missing, org not found, approval required, GraphQL errors, refresh
   failed — so the agent gets actionable messages, not opaque 500s.

9. **Version handshake.** A stale bridge config could point at a newer extension.
   Include `extensionVersion`/protocol version in `initialize`; warn on mismatch.

10. **Prompt-injection surface.** Tool descriptions and any resource _content_
    returned (template bodies) enter an agent's context. Keep descriptions boring/
    descriptive (same discipline as the steering prompt per CLAUDE.md). Consider
    tools-first, resources optional/off by default (client resource support varies).

11. **`@modelcontextprotocol/sdk` dependency.** New runtime dep, Node-target
    bundling for the bin, bundle size, license review, `.vscodeignore` must ship
    `dist/mcp/`.

12. **Unofficial-extension / ToS posture.** Exposing authenticated MSP automation
    to autonomous agents via MCP is a meaningful escalation for an _unofficial_
    extension. Confirm this is an acceptable stance before shipping; keep the
    "unofficial" framing prominent.

```

```
