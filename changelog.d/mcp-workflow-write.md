---
category: Added
pr: 68
---

- **MCP server (experimental): workflow write tools behind in-VS-Code approval** — external MCP clients can now edit, auto-layout, and run Rewst workflows (`buddy_workflow_edit`, `buddy_workflow_autolayout`, `buddy_workflow_run`) when write tools are enabled (`rewst-buddy.mcp.enableWriteTools`). Every change is double-gated: writes are rejected at the MCP boundary unless write tools are turned on, and each edit then requires a per-workflow approval prompt **inside VS Code** before anything is sent — an external client can never approve its own write. Until you approve, the tool returns a clear `approval_required` result and makes no change.
