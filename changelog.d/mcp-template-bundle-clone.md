---
category: Added
pr: 85
---

- **Deep-clone a template bundle over MCP** — `buddy_template_bundle_clone` deep-copies a template and everything it references (transitively) into a target org behind one approval, rewriting references to the new ids and rolling back on failure. Cross-org or deleted references are reported, not dropped.
