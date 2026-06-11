---
id: '006'
slug: language-model-chat-provider
status: pending
depends_on: ['004', '005']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 006: Implement and register the LanguageModelChatProvider

## Agreed approach (spec-level)

Implement DECISIONS.md D1. Create the provider (singleton manager style):

- `provideLanguageModelChatInformation`: return ONE `LanguageModelChatInformation` per
  active session-org (id derived from orgId), each declaring `capabilities.toolCalling`.
  Single session -> one model; multiple -> one per org.
- `provideLanguageModelChatResponse`: resolve the org/session from the selected model;
  resolve/record the backend conversationId via the task-004 module; drive the existing
  `askRewstAi` stream, reporting text chunks as `LanguageModelTextPart`s and tool calls via
  the task-005 translation (ToolCallPart out, ToolResultPart folded back). Preserve the
  multi-round tool loop semantics and `maxToolRounds` from the participant.
- Register with `vscode.lm.registerLanguageModelChatProvider` in `extension.ts`; push the
  disposable to `context.subscriptions`.
- Approvals (007), resume (008), sources (009), apply (010) land in their own tasks; leave
  clean seams (e.g. handle the `approval` event minimally / TODO-free stubs that 007 fills).

## Allowed files

- `src/ui/chat/` (new `RewstChatModelProvider.ts` + `*.test.ts`)
- `src/ui/index.ts`
- `src/extension.ts`

## Done-check

- Unit tests: model-info returns one entry per active session/org with toolCalling; a chat
  turn streams an answer through a mocked `askRewstAi` (criterion 2); two sequential turns
  in one session reuse the conversationId (criterion 7b) using the task-004 module.
- `npm run test:unit` exits 0
