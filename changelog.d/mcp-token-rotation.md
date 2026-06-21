---
category: Added
pr: 65
---

- **MCP server (experimental): Rotate MCP Token command** — a new **Rotate MCP Token** command lets you revoke MCP access by minting a fresh endpoint token; any external client still using the old token immediately loses access. It confirms first (rotating breaks connected clients until you update their config), then points you at **Copy MCP Config to Clipboard** to share the new token.
