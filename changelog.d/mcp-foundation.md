---
category: Added
pr: 58
---

- **MCP server (foundation, experimental)** — Rewst Buddy can now expose your authenticated Rewst sessions to external MCP clients (Claude Desktop, Claude Code, Cursor) through a local, credential-free stdio bridge: the bridge process holds no secrets and forwards tool calls to the running extension, which does the work with the sessions it already manages. Off by default behind `rewst-buddy.mcp.enable`; read-only at the server boundary (writes are rejected unless `rewst-buddy.mcp.enableWriteTools` is set), with an optional `rewst-buddy.mcp.enabledTools` allowlist. Use the new **Generate MCP Config** command to print the client configuration. This release lands the plumbing and a capability registry shared with the Cage-Free Rewsty chat tools; the GraphQL introspect/query/mutate tools are wired onto the MCP surface in a follow-up.
