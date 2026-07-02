---
category: Fixed
---

- **Org lookups skip stale sessions instead of failing** — When more than one signed-in session could manage the same org id, tools and commands could resolve to whichever session was indexed last, even if it had gone stale and another signed-in session for that org was still valid. Lookups now skip an invalid session and fall through to the next one that still works.
