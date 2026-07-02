---
category: Fixed
---

- **Org lookups recover stale sessions instead of failing** — A stale session sharing an org id with another signed-in session could block access to that org. Lookups now refresh a stale session, or fall through to another valid one, instead of failing.
