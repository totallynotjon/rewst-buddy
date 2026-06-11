---
id: '009'
slug: source-citations
status: pending
depends_on: ['006']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 009: Source citations in the provider response

## Agreed approach (spec-level)

Implement DECISIONS.md D8. When `askRewstAi`'s `complete` event carries `sources`, render
them with the answer in the provider response: URL sources as reference/links and non-URL
sources as a labeled list (port the participant's `renderSources` behavior). Factor the
formatting into a small pure function so it is unit-testable independent of the provider.

## Allowed files

- `src/ui/chat/` (small `sourceRendering.ts` + `*.test.ts`, or fold into the provider with a pure helper)
- `src/ui/chat/RewstChatModelProvider.ts`

## Done-check

- Unit test of the source-rendering formatting: URL sources -> links/references; non-URL
  sources -> labeled list with section (criterion 10).
- `npm run test:unit` exits 0
