---
category: Added
---

- **Template link management over MCP** - New MCP tools let an AI assistant manage the local file ↔ Rewst template links directly: `buddy_template_link` associates an existing local file with a template, `buddy_template_unlink` removes the association, and `buddy_template_sync_on_save` toggles upload-on-save for a linked file. These change only local link state (no Rewst writes) and pair with the sync tools to drive the full link-edit-sync workflow without the VS Code UI.
