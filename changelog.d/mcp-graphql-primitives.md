---
category: Added
pr: 60
---

- **MCP GraphQL primitives (experimental)** — the MCP server now exposes schema introspection (`buddy_graphql_schema`) and read-only queries (`buddy_graphql_query`) when GraphQL tools are enabled, plus a write tool (`buddy_graphql_mutate`) that requires `rewst-buddy.mcp.enableWriteTools` and a per-resource approval inside VS Code before any mutation runs.
