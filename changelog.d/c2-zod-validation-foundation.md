---
category: Fixed
---

- **Capability input validation** — all 16 read-capability tools now validate and coerce inputs via Zod schemas at the `run()` boundary, so invalid arguments (wrong types, out-of-range limits, bad enums) are rejected with clear error messages instead of silently misbehaving.
