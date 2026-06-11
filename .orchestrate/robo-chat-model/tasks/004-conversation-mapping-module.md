---
id: '004'
slug: conversation-mapping-module
status: pending
depends_on: ['001']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 004: Conversation-mapping module (stateless message array -> backend conversationId)

## Agreed approach (spec-level)

Implement DECISIONS.md D2 as a small, pure, unit-testable module (singleton manager
style). API roughly: given `orgId` and the incoming provider message array, compute the
prefix key `hash(orgId + serialized prior-history PREFIX)` (all messages EXCEPT the
trailing user turn); expose `resolve(orgId, messages) -> { conversationId? }` and
`record(orgId, messages, conversationId)` to store the post-answer history hash.

- Empty prefix => no reuse (signals a fresh conversation to the caller).
- Non-empty prefix match => reuse the stored conversationId; miss => none.
- Include `orgId` in every key so distinct orgs never collide.
- Provide the one-shot org-scoped pending-resume hook used by task 008 (D6): a
  `seedResume(orgId, conversationId)` that the next empty-prefix resolve for that org
  consumes once, then clears.
- Do NOT wire into the provider here (that is task 006). Keep VS Code coupling minimal so
  it unit-tests without the provider.

## Allowed files

- `src/ui/chat/` (new module, e.g. `conversationMap.ts` + `conversationMap.test.ts`)
- `src/ui/index.ts` (export)

## Done-check

- Unit tests assert: (a) two sequential turns from one chat session reuse the same
  conversationId; (b) distinct conversation content -> distinct conversationIds; (c)
  distinct orgs -> distinct conversationIds; (d) a seeded resume is consumed by exactly the
  next empty-prefix turn and not by a later one (criterion 7 a/c, supports 7b/8).
- `npm run test:unit` exits 0
