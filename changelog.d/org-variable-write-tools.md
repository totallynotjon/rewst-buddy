---
category: Added
pr: 80
---

- **MCP server (experimental): org variable write tools** — when write tools are enabled, external MCP clients can now manage Rewst configuration variables through org-scoped tools (`create_org_variable`, `update_org_variable`, and `delete_org_variable`). Each runs against a single organization, re-verifies that the target variable belongs to that org before changing anything, and requires a per-change approval inside VS Code.
