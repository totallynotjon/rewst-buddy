---
category: Added
pr: 80
---

- **MCP server (experimental): workflow create/delete tools** — when write tools are enabled, external MCP clients can now create an empty workflow (`create_workflow`, then build it out with `buddy_workflow_edit`) and permanently delete one (`delete_workflow`). Both run against a single organization, `delete_workflow` re-verifies the workflow belongs to that org before removing it (along with its triggers, tasks, and execution history), and each requires a per-change approval inside VS Code.
