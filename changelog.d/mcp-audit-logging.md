---
category: Added
pr: 64
---

- **MCP server (experimental): audit logging** — every external MCP tool call is now logged to the Rewst Buddy output channel as one `[MCP audit]` line (tool, org, outcome, duration). Argument values, GraphQL query bodies, and secrets are never logged.
