---
id: '007'
slug: approvals-in-provider-mode
status: pending
depends_on: ['006']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 007: Rewst-side approvals in provider mode

## Agreed approach (spec-level)

Implement DECISIONS.md D5. When `askRewstAi` yields an `approval` event during a provider
response, surface a modal `showInformationMessage` with Approve once / Always allow /
Cancel. On Approve, call `addAllowedTool` and continue the SAME provider response inline
(no participant button/re-open hack). Approve-once reverts via `removeAllowedTool` after
the turn (restoring prior allow-list state); Always-allow persists. Port the relevant
logic from `RewstChatParticipant` (do not keep the participant). Cancel ends the turn.

## Allowed files

- `src/ui/chat/RewstChatModelProvider.ts` + its `*.test.ts`
- `src/ui/chat/` (small helper module if needed)

## Done-check

- Unit tests: approval event -> the approve path calls `addAllowedTool`; approve-once
  reverts via `removeAllowedTool` after the turn; always-allow does not revert (criterion 6).
- `npm run test:unit` exits 0
