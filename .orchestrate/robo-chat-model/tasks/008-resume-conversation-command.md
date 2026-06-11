---
id: '008'
slug: resume-conversation-command
status: pending
depends_on: ['006']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 008: Resume Rewst AI Conversation command

## Agreed approach (spec-level)

Implement DECISIONS.md D6. Add a command `Resume Rewst AI Conversation`
(`contributes.commands` + a `GenericCommand` subclass) that:

- lists the org's stored conversations (reuse `getConversations`/`getConversation` and the
  transcript formatting already in `conversationTranscript.ts`),
- renders/loads the picked conversation's transcript,
- sets the ONE-SHOT org-scoped pending-resume binding on the task-004 module
  (`seedResume(orgId, conversationId)`), so the NEXT empty-prefix provider turn for that org
  continues that conversation, then clears the binding.
- Surface the transcript to the user (e.g. open it / notify) since the provider has no chat
  surface of its own.

## Allowed files

- `src/commands/` (new command + `*.test.ts`; export from the command index)
- `src/commands/exportedCommands.ts`
- `package.json` (`contributes.commands` entry)
- `src/ui/chat/conversationMap.ts` — use `seedResume` (already provided by task 004)
- `src/ui/chat/conversationTranscript.ts` — READ/reuse

## Done-check

- Unit tests: listing/loading path returns conversations and seeds the pending binding;
  the next fresh turn reuses the resumed conversationId; a later fresh turn (after
  consumption) starts a new conversation (criteria 7b, 8).
- `npm run test:unit` exits 0
