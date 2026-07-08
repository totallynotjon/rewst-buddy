---
category: Fixed
---

**Execution diagnostics across managed orgs:** `buddy_execution_logs` and `buddy_workflow_diagnose` now resolve an execution's owner from its id before reading logs, so Rewst result URLs anchored on a managing org can diagnose child-org executions and still fetch workflow definitions from the workflow's owning org.
