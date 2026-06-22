---
category: Added
pr: 80
---

- **MCP server: write-org allowlist** — a new `rewst-buddy.mcp.writeOrgAllowlist` setting limits which organizations MCP write tools (including `rewst_graphql_mutate`) may change. Leave it empty to allow any org your sessions manage; list one or more org ids and a write against any other org is rejected at the MCP boundary before it runs. This is a hard, declarative blast-radius cap that does not depend on the in-VS-Code approval prompt — which an external MCP client's user may never see. Read tools are never restricted.
