---
category: Added
pr: 80
---

- **MCP server (experimental): workflow create/delete tools** — when write tools are enabled, external MCP clients can create an empty workflow (`buddy_create_workflow`) and permanently delete one (`buddy_delete_workflow`), each org-scoped, re-verified against the target org, and gated by a per-change approval inside VS Code.
