---
id: '003'
slug: register-tools-gated-by-settings
status: pending
depends_on: ['002']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 003: Register the concrete tools via vscode.lm.registerTool, gated per setting

## Agreed approach (spec-level)

Register each concrete tool (DECISIONS.md D3) with `vscode.lm.registerTool`, reusing the
existing run modules (`runToolRequests` and the tool spec arrays) so a registered tool's
`invoke` executes the SAME local logic the text protocol runs. Implement criterion 4:

- Iterate the spec arrays to build registrations — never hand-list names — so registered
  names always equal the protocol names.
- Gate each registration by its governing `rewst-buddy.ai.*` setting per the D3 mapping
  (enableWorkspaceTools; edit tools also need enableEditTools; enableWebTools;
  enableCommandTool; enableGraphqlTool). A disabled setting => its tools are NOT registered
  (withheld), and they re-register when re-enabled (subscribe to config changes, dispose
  cleanly).
- Push disposables to `context.subscriptions`.

## Allowed files

- `src/ui/chat/tools/` (new registration module, e.g. `registerLanguageModelTools.ts` + `*.test.ts`)
- `src/ui/index.ts` (export if needed)
- `src/extension.ts` (wire registration into activation)

## Done-check

- New unit test proves: each enabled setting yields its registered tools and each disabled
  setting withholds exactly its tools (criterion 4).
- `npm run test:unit` exits 0
