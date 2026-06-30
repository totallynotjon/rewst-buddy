---
category: Added
pr: 80
---

- **MCP server (experimental): trigger enable/disable tool** — when write tools are enabled, external MCP clients can now turn a Rewst workflow trigger on or off with `buddy_set_trigger_enabled`. It runs against a single organization, re-verifies the trigger belongs to that org before changing it, and requires a per-change approval inside VS Code.
