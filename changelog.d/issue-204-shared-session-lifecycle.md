---
category: Fixed
---

- **VS Code follows the standalone MCP session owner** — Attached windows receive the owner's current sessions immediately, clear stale state when the owner shuts down or transport retries are exhausted, never copy credentials into a second store, and ask for a reload before starting a fresh local owner after disconnect.
