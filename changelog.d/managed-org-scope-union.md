---
category: Fixed
---

- **Restored access to all directly managed orgs.** The recent sub-org scoping fix accidentally replaced the managed-org list instead of extending it, so tools could no longer find orgs outside your own org's tree. Sessions now index the union of both sets.
