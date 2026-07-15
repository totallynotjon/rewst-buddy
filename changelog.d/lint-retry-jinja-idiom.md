---
category: Changed
---

- **Workflow lint now suggests a self-defaulting Jinja counter for manual retry loops.** The `task-retry-configured` finding shows the `CTX.retry|d|int` idiom so you don't need an extra task to initialize the counter before the loop starts.
