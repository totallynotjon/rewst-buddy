---
category: Fixed
---

- Fixed the `buddy_list_workflows` MCP tool, which always failed because its underlying `visibleWorkflows` query is broken server-side; it now uses the `workflows` query.
