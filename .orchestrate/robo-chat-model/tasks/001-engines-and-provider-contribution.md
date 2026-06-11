---
id: '001'
slug: engines-and-provider-contribution
status: verified
depends_on: []
codex_task_id: task-mq9ta2g7-jy1ytk
codex_session_id: null
worktree_branch: feat/robo-chat-model
worktree_path: /home/jon/Documents/dev/rewst-buddy-full/rewst-buddy-vscode/.worktrees/robo-chat-model
attempts: 1
tokens: 0
verified_by: jojo-build resume; done-checks green (manifest grep, tsc --noEmit, test:unit); decoupling validated by Codex gate task-mq9th83b-44xym8
verify_evidence: verify/001.md
---

# Task 001: Raise the VS Code floor and add the chat-model contribution point

## Agreed approach (spec-level)

Raise the API floor so the `LanguageModelChatProvider` API is available and signed-out
usage works (see DECISIONS.md "Engines / types floor", criterion 3):

- Set `engines.vscode` to `^1.122.0` in `package.json`.
- Bump the `@types/vscode` devDependency to `^1.122.0` and update `package-lock.json`
  accordingly so the project type-checks/compiles against the new API surface (obj 4).
- Add the `contributes.languageModelChatProviders` contribution point (vendor +
  displayName for RoboRewsty). No provider registration code yet (that is task 006) — this
  task only lands the manifest contribution and the version floor.

Do NOT touch the participant, tools, or runtime code in this task.

## Allowed files

- `package.json`
- `package-lock.json`
- (optional) a colocated `*.test.ts` for the engines-floor assertion, e.g. `src/test/...`

## Done-check

- `node -e "const p=require('./package.json'); if(!/\^1\.122/.test(p.engines.vscode)) throw 'engines'; if(!/\^1\.122/.test(p.devDependencies['@types/vscode'])) throw 'types'; if(!p.contributes.languageModelChatProviders) throw 'contribution';"` exits 0
- `npm run compile` (or the project's type-check) exits 0 against the new `@types/vscode`
- `npm run test:unit` exits 0
