---
id: '011'
slug: retire-rewst-participant
status: pending
depends_on: ['007', '008', '009', '010']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 011: Retire the @rewst chat participant

## Agreed approach (spec-level)

Implement criterion 11. Now that the model provider has parity (007–010 landed), remove the
participant:

- Remove `contributes.chatParticipants` from `package.json`.
- Remove `RewstChatParticipant.init()` registration and import from `extension.ts`.
- Delete `RewstChatParticipant.ts` and any code that becomes dead ONLY because of its
  removal (the approve-command/`workbench.action.chat.open` hack, etc.). Do NOT delete
  modules the new provider reuses (tool specs/run modules, toolProtocol, conversationMap,
  conversationTranscript, ProposedContentProvider, ApplyRewstAiEdit).
- If any parity feature genuinely cannot be delivered without a participant, STOP and record
  the justification in DECISIONS.md instead of retaining silently.

## Allowed files

- `package.json`
- `src/extension.ts`
- `src/ui/chat/RewstChatParticipant.ts` (delete)
- `src/ui/index.ts` (drop export)
- any file that only existed to support the participant (verify it is truly unused first)

## Done-check

- `grep -rn "chatParticipants" package.json` returns nothing; `grep -rn "RewstChatParticipant" src` returns nothing (criterion 11).
- `npm run test:unit` exits 0
