---
category: Added
pr: 58
---

- **MCP server (foundation, experimental)** — Rewst Buddy can now expose your authenticated Rewst sessions to external MCP clients (Claude Desktop, Claude Code, Cursor) over a local HTTP endpoint served from the extension itself — no separate process and no `node` required. Clients connect to a `127.0.0.1/mcp` URL and present a per-install token header; your Rewst cookies never leave the extension. Off by default behind `rewst-buddy.mcp.enable`; read-only at the boundary (writes are rejected unless `rewst-buddy.mcp.enableWriteTools` is set), with an optional `rewst-buddy.mcp.enabledTools` allowlist. Use the new **Generate MCP Config** command to print the client configuration. This release lands the plumbing and a capability registry shared with the Cage-Free Rewsty chat tools; the GraphQL introspect/query/mutate tools are wired onto the MCP surface in a follow-up.
