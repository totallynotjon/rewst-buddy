---
category: Added
pr: 80
---

- **MCP server: write-org allowlist** — a new `rewst-buddy.mcp.writeOrgAllowlist` setting limits which organizations MCP write tools (including `rewst_graphql_mutate`) may change. Leave it empty to allow any managed org, or list org ids to reject writes elsewhere at the MCP boundary. Read tools are never restricted.
