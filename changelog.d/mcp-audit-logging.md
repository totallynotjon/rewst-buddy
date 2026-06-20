---
category: Added
---

- **MCP server (experimental): audit logging** — every tool call an external MCP client makes is now logged to the Rewst Buddy output channel as a single `[MCP audit]` line showing the tool name, the organization it targeted, the outcome (`ok`, `approval_required`, or the specific error), and how long it took. Argument values, GraphQL query bodies, and secrets are never logged, so you can see what an external agent did without leaking sensitive data.
