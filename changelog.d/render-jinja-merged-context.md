---
category: Fixed
---

**Accurate Jinja test context:** `buddy_render_jinja` now merges an execution's context snapshots into one cumulative view by default — previously it used only the last snapshot, which holds just the final publish's keys, making run inputs and earlier variables appear undefined.
