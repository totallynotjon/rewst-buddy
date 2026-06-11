---
id: '005'
slug: tool-call-translation-module
status: pending
depends_on: ['003']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 005: Tool-call translation between VS Code LM tools and the text protocol

## Agreed approach (spec-level)

Implement DECISIONS.md D4 as a module bridging the VS Code provider tool contract and the
existing `toolProtocol.ts` text protocol. Reuse `buildToolInstructions`,
`parseToolRequests`, `formatToolResults` — do not reinvent them.

- Input: `options.tools` (VS Code-declared tools for the request) + the current settings.
- Filter `options.tools` down to those whose governing `rewst-buddy.ai.*` setting is
  enabled (D3 mapping); a disabled tool is excluded from injection even if present in
  `options.tools`.
- Inject the filtered tools into the message via the text protocol.
- Parse RoboRewsty's `rewst-tool` replies; emit each as a `LanguageModelToolCallPart`
  whose `name` is in the injected set. A parsed request whose name is NOT in `options.tools`
  is returned as text/error content (the undeclared-tool fallback), never a stalled call.
- Fold `LanguageModelToolResultPart`s (from the next provider message array) back into the
  next backend turn via `formatToolResults`.

## Allowed files

- `src/ui/chat/` (new module, e.g. `toolTranslation.ts` + `toolTranslation.test.ts`)
- `src/ui/chat/tools/` — READ for spec arrays / protocol; reuse, do not duplicate
- `src/ui/index.ts` (export)

## Done-check

- Unit tests cover: declared-tool injection; settings filter (disabled setting -> tool
  withheld despite presence in `options.tools`); output->tool-call parsing; result folding;
  undeclared-tool fallback (criterion 5).
- `npm run test:unit` exits 0
