---
category: Security
---

- **Local server now enforces loopback-only access** — The credential server refuses to bind a non-localhost host, and rejects any session or template-open request whose remote address, `Host`, or browser `Origin` isn't local, instead of using wildcard CORS.
