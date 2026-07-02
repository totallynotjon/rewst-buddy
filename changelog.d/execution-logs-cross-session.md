---
category: Fixed
---

**Task logs across accounts:** `buddy_execution_logs` no longer reports an empty result for executions owned by another signed-in session — it now checks every active session and accepts an optional `orgId` to target the right account directly.
