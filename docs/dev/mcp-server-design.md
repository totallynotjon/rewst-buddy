# MCP Server — Design Draft

> Status: **IN PROGRESS**. Captures the direction for adding Model Context
> Protocol support to Rewst Buddy. Decisions locked: **HTTP transport served
> from the extension** (MCP Streamable HTTP, mounted on the localhost server at
> `/mcp`), **read-only by default**, **no separate process / no stdio**.
>
> Earlier drafts used a stdio bridge spawned by the client; that was dropped in
> favor of HTTP-direct (no `node` on PATH, no discovery file). The transport
> decision is tracked in the epic (#52) and foundation (#53) issues, which are
> the source of truth; this doc trails them.

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
host**. The extension host is already Node and already runs a localhost server,
so the simplest way to reuse the solved auth is to run the MCP server **in the
host** and let clients connect to it over HTTP. There is no separate process to
hand credentials to, so the credential boundary is trivially honored: clients
send only tool names and arguments; cookies never leave the host.

## Architecture

```text
Capability Registry (src/capabilities)  ← single source of truth
  Capability = ToolSpec + access(read|write) + settings gate + handler(ctx)
        │
        ├── Surface A: MCP server (Role 1)
        ├── Surface B: Cage-Free Rewsty chat (lmTools)
        └── Surface C (optional): VS Code LM tools (Copilot agent mode)

MCP path:
  Claude Desktop/Code
    └─(MCP Streamable HTTP, URL + Authorization: Bearer <token> header)→
        extension localhost server (src/server) /mcp route
          └─ MCP SDK Server (stateless) — src/mcp/mcpServer.ts
              └─ capability surface (src/mcp/McpActions.ts)
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
  — tsconfig only; esbuild reads paths natively).
- `Capability { spec: ToolSpec; access: 'read'|'write'; enabled(settings); run(input, ctx) }`
  with `CapabilityContext { session: Session; orgId: string }` — session injected, never secrets.
- Migrate read paths of `GRAPHQL_TOOL_SPECS` into capabilities; `lmTools` derives
  its governed specs from the registry via a temporary shim (chat behavior unchanged).
- Extend `packageManifest.test.ts` to cover the registry.

### Phase 1 — in-extension MCP HTTP server, read-only (headline milestone)

**Capability surface** (`src/mcp/McpActions.ts`) — transport-agnostic functions:
`listTools`, `callTool`, `listResources`, `readResource`.

- `callTool` resolves `{ orgId }` → `Session` via `SessionManager`, runs the capability.
- **Read-only enforced**: `access:'write'` is rejected unless write tools are enabled.
- Throttled; capability errors come back as `isError` tool results.

**MCP HTTP server** (`src/mcp/mcpServer.ts`) — an `@modelcontextprotocol/sdk`
`Server` whose request handlers call the capability surface, driven by a
`StreamableHTTPServerTransport`:

- Stateless: a fresh `Server` + transport per request (the documented pattern).
- Mounted on the localhost server at the `/mcp` route (`Server.ts` routes it
  before the browser-action handling).
- Auth: master switch (`mcp.enable`) + a stable per-install token presented in
  the standard `Authorization: Bearer <token>` header + DNS-rebinding protection
  (`allowedHosts`).

**Onboarding.** For VS Code's own MCP client, an `McpServerDefinitionProvider`
(registered via `vscode.lm.registerMcpServerDefinitionProvider` +
`contributes.mcpServerDefinitionProviders`) publishes the server natively while
`mcp.enable` is on, injecting the live localhost token into the `Authorization`
header; the `AddMcpToVSCode` command flips `mcp.enable` on and surfaces it. For
external clients, `CopyMcpConfig` copies a credential-free client config JSON: the
`/mcp` URL plus the `REWST_BUDDY_MCP_TOKEN` Bearer placeholder. No `node`, no
spawned process, no discovery file.

Initial read tools: `buddy_list_orgs`, `buddy_search_templates`, `buddy_get_template`,
`buddy_list_workflows`, `buddy_get_workflow`, `buddy_graphql_query` (read-only), `buddy_get_bundle`.
Resources: `rewst://{org}/templates`, `…/templates/{id}`, `…/workflows`.

### Phase 2 — converge chat onto the registry

Remove the Phase 0 shim; `lmTools` consumes `src/capabilities` natively. One
definition feeds both chat and MCP.

### Phase 3 — write capabilities, opt-in + approved

`buddy_update_template_body`, `buddy_create_template`, `buddy_export_workflow`, `buddy_import_bundle`.
Reuse the existing mutation-approval machinery; unapproved writes return a
structured "approval required" result; **approval happens in VS Code**, not the
external client. Setting `rewst-buddy.mcp.enableWriteTools` (default false).

### Phase 4 — (optional, deferred) MCP client / Role 2

Only if Cage-Free Rewsty should orchestrate external servers server-side.
Otherwise VS Code's native MCP client covers user-wired external servers.

## Settings (`rewst-buddy.mcp.*`)

| Setting                              | Default | Effect                                          |
| ------------------------------------ | ------- | ----------------------------------------------- |
| `mcp.enable`                         | `false` | Master switch; gates MCP actions; exposes reads |
| `mcp.enableWriteTools`               | `false` | Allows `access:'write'` (non-dangerous) tools   |
| `mcp.enableDangerousGraphqlMutation` | `false` | Allows the raw `buddy_graphql_mutate` tool      |

## File layout

```text
src/capabilities/   index.ts (@capabilities), Capability.ts, registry.ts, *.test.ts
src/mcp/ (@mcp)     index.ts, McpActions.ts (capability surface), mcpServer.ts
                    (SDK server + /mcp HTTP handler), runtime.ts (token), settings.ts,
                    McpDefinitionProvider.ts (native VS Code MCP registration)
src/server/Server.ts   + /mcp route → handleMcpHttp
src/commands/mcp/   CopyMcpConfig.ts, AddMcpToVSCode.ts
```

## Testing (CLAUDE.md mandates)

- Unit: registry gating (read/write, settings), each capability handler via
  `MockWrapper`, the SDK server handlers via the in-memory transport, the `/mcp`
  token/enable gate, and write-rejection at the boundary.
- Integration (`REWST_TEST_TOKEN`): `callTool` round-trip for read tools.

## Docs to update on ship

`docs/features.md` (deep dive), `docs/reference.md` (commands + `mcp.*` settings),
`README.md` features bullet, and a per-PR note in `changelog.d/` (never hand-edit
`CHANGELOG.md`).

---

## Pre-build considerations (open — resolve before/while building)

These change what we build; tracked here so they aren't discovered mid-implementation.

1. ~~**Port + token discovery.**~~ **Resolved by HTTP-direct.** No bridge to
   discover the port; the `CopyMcpConfig` command bakes the live URL + token
   into the client config (and the native `McpDefinitionProvider` wires VS Code's
   own client directly). The token is now **stable** (persisted), so the config
   survives window reloads. Open: a "rotate MCP token" command for revocation.

2. **Multiple VS Code windows.** Each window runs its own extension host. Only one
   can bind the port; the rest hit `EADDRINUSE`. The `/mcp` endpoint is therefore
   served by **whichever window owns the port**, which may not be the one the user
   is looking at, and its sessions differ. Need a defined story: surface which
   org/sessions the port-owning window exposes.

3. ~~**Node on PATH for spawning.**~~ **Resolved by HTTP-direct.** There is no
   spawned process; clients connect to a URL. No `node` requirement.

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

8. **Structured error contract.** Stable `McpErrorCode` set for: session missing,
   org not found, approval required, GraphQL errors, refresh failed — surfaced as
   `isError` tool results so the agent gets actionable messages, not opaque 500s.

9. ~~**Version handshake.**~~ **Resolved by HTTP-direct.** The MCP `initialize`
   handshake negotiates protocol version natively; there is no separate bridge
   config to drift from the extension.

10. **Prompt-injection surface.** Tool descriptions and any resource _content_
    returned (template bodies) enter an agent's context. Keep descriptions boring/
    descriptive (same discipline as the steering prompt per CLAUDE.md). Consider
    tools-first, resources optional/off by default (client resource support varies).

11. **`@modelcontextprotocol/sdk` dependency.** Runtime dep now bundled into the
    extension bundle (the HTTP transport runs in-host) — watch bundle size and do
    a license review. No separate `dist/mcp/` artifact to ship.

12. **Unofficial-extension / ToS posture.** Exposing authenticated MSP automation
    to autonomous agents via MCP is a meaningful escalation for an _unofficial_
    extension. Confirm this is an acceptable stance before shipping; keep the
    "unofficial" framing prominent.
