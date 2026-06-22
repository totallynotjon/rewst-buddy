---
category: Added
---

- **MCP server (experimental): tag write tools** — when write tools are enabled, external MCP clients can now manage Rewst tags through three org-scoped tools: `create_tag`, `update_tag`, and `delete_tag`. Each runs against a single organization, re-verifies that the target tag belongs to that org before changing anything, and requires a per-change approval inside VS Code.
