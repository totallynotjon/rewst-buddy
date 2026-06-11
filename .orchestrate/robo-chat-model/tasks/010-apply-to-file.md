---
id: '010'
slug: apply-to-file
status: pending
depends_on: ['006']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 010: Apply-to-file via the preview-before-write command

## Agreed approach (spec-level)

Implement DECISIONS.md D7. Keep `ApplyRewstAiEdit` as the CANONICAL apply path (diff
preview shown before write) and make it invocable in provider mode:

- Register/surface it as a command the user triggers on the active file with a chosen code
  block (command palette / editor context) — providers have no chat stream buttons.
- Preserve and, if needed, strengthen the existing unit test so it asserts the preview path
  (`vscode.diff` / proposed-content provider) is invoked BEFORE any `applyEdit`/write — a
  direct-write path must fail the test.
- Document (DECISIONS.md D7 already records this) that VS Code's native code-block apply
  affordance is supplementary and not interceptable; the guaranteed-preview path is this
  command.

## Allowed files

- `src/commands/ui/ApplyRewstAiEdit.ts` + a colocated `*.test.ts`
- `package.json` (`contributes.commands`/menus entry if surfacing in palette/context)
- `src/ui/chat/ProposedContentProvider.ts` — READ/reuse

## Done-check

- Unit test asserts the diff/preview path is invoked before content is written (direct
  write fails) (criterion 9).
- `npm run test:unit` exits 0
