---
category: Changed
---

- **MCP exposure now uses three settings** — `rewst-buddy.mcp.enable` exposes read capabilities, `rewst-buddy.mcp.enableWriteTools` exposes workflow writes, and `rewst-buddy.mcp.enableDangerousGraphqlMutation` separately exposes raw GraphQL mutation. The old MCP family checklist (`rewst-buddy.ai.tools`) and the per-tool allowlist (`rewst-buddy.mcp.enabledTools`) were both removed.
