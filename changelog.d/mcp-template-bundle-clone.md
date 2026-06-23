---
category: Added
pr: 85
---

- **Deep-clone a template bundle over MCP** - The new `buddy_template_bundle_clone` tool deep-copies a template and the templates it references (transitively, via `template('<id>')` calls) into new templates in a target org, rewriting every reference to the new ids. It walks the live remote graph (cycle-safe, depth- and count-capped), creates the clones behind a single approval, and rolls back every created template if the clone fails partway. References to other orgs or to deleted templates are reported rather than silently dropped.
