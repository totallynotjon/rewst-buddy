---
category: Security
---

- **"Clear Sessions" now actually deletes stored credentials** — Previously it only cleared the in-memory session list; saved cookies, the known-profile cache, and the Sessions tree could all still show or restore a "cleared" session. Clearing now removes every stored cookie (including managed-org keys) and the known-profile cache.
