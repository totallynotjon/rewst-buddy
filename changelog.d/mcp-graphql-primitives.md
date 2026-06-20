---
category: Added
pr: 60
---

- **MCP GraphQL primitives (experimental)** — the MCP server now exposes the three GraphQL-wrapping tools the rest of the feature is built on. Schema introspection (`buddy_graphql_schema`) and read-only queries (`rewst_graphql_query`) are available to external MCP clients when GraphQL tools are enabled, and a dedicated write tool (`rewst_graphql_mutate`) runs mutations behind a clean read/write split: it requires `rewst-buddy.mcp.enableWriteTools` and a per-resource approval prompt **inside VS Code** before any change is sent — an external client can never approve its own write. Until you approve, the mutation is not run and the tool returns a clear `approval_required` result.
