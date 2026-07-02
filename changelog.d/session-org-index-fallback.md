---
category: Fixed
---

- **Org lookups recover stale sessions instead of failing** — When more than one signed-in session could manage the same org id, tools and commands could resolve to whichever session was indexed last, even if it had gone stale and another signed-in session for that org was still valid. Lookups now try refreshing a stale session before falling through to another one that still works.
