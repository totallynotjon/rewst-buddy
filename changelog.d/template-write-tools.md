---
category: Added
---

- **MCP server (experimental): template write tools** — when write tools are enabled, external MCP clients can now create and modify Rewst templates through four org-scoped tools: `create_template`, `update_template_body`, `rename_template`, and `delete_template`. Each runs against a single organization, re-verifies that the target template belongs to that org before changing anything, and requires a per-change approval inside VS Code before it runs.
