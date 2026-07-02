---
category: Fixed
pr: 118
---

**No more silent input loss:** after a workflow edit, the tool re-reads the saved workflow and warns when the server dropped or coerced task inputs it had accepted — previously such edits reported plain success while data quietly went missing.
