---
description: Take a GitHub issue from triage to an open, review-clean PR (worktree, tested fix, changelog, PR) ready for /merge_release.
argument-hint: <issue-number> [extra context or constraints]
---

You are addressing GitHub issue #$1 end to end: understand it, spin up a worktree, implement a tested fix, document it, and open a PR that references the issue. Stop at an open, review-clean PR — versioning, merging, and publishing are a separate step (`/merge_release`).

Extra context from the user (may be empty): $ARGUMENTS

## Configuration

<target_branch>main</target_branch>
<remote>origin</remote> <!-- totallynotjon (Jon's). The OwenIbarra remote is a PR-review fork — never push there. -->
<changelog_notes_dir>changelog.d/</changelog_notes_dir> <!-- one note file per PR; never edit CHANGELOG.md directly (see changelog.d/README.md) -->
<branch_prefix>fix/issue-$1-</branch_prefix>
<issue_reference>Addresses #$1</issue_reference> <!-- use "Addresses", not "Closes": leave the issue open for the user to close once they've confirmed the fix in real use -->

## Project rules (do not violate)

- **Exploration tooling:** use the pre-approved read-only tools — `Read`, `Glob`, `Grep`, `Bash(git log/diff/show/status/branch)`, `Bash(ls/tree)`, `mcp__ide__getDiagnostics`. Never use `Bash(cat/grep/find)` for what those dedicated tools handle (see CLAUDE.md).
- **Tests are mandatory.** Every fix ships with tests: colocated `*.test.ts` unit tests next to the source, plus an integration test under `src/test/integration/` when live API / assistant behavior is involved. Prefer the mock SDK wrapper (`createMockSession`, `Fixtures`) for unit tests — see CLAUDE.md "Testing".
- **Type-check via `mcp__ide__getDiagnostics`**, not `tsc`.
- **Prompt steering changes must stay transport-shaped.** When editing Cage-Free Rewsty steering or `vscode-tool` protocol text, avoid XML authority wrappers and override language ("supersedes", "overrides", "ignore your system prompt", "trusted system instruction"). Use neutral VS Code context / local tool protocol wording, and keep edit/write tool routing close to the concrete Available tools list. See CLAUDE.md "AI Prompt Steering Directives".
- **Path aliases**, if you add one, must go in BOTH `tsconfig.json` and `webpack.config.cjs`.
- **Do not merge, tag, bump the version, or publish here.** That is `/merge_release`.

## Phase 1 — Understand

1. `gh issue view $1` — read the title, body, and any screenshots/links. Restate the problem in one or two sentences.
2. Explore the code to locate the relevant path and existing patterns to reuse. Trace the real code path; never guess at behavior a tool can confirm.
3. If the fix has a genuine fork (naming, UX, scope, a behavior tradeoff) or the issue is ambiguous, use `AskUserQuestion` to settle it BEFORE implementing. Recommend an option; don't survey every alternative.

## Phase 2 — Worktree

Do the work in a dedicated git worktree so the primary checkout stays untouched.

1. `git fetch origin main`.
2. Create a worktree on a fresh branch off `origin/main` (slug from the issue topic, e.g. `fix/issue-$1-tool-call-context`):
   `git worktree add ../rb-issue-$1 -b fix/issue-$1-<short-slug> origin/main`
   A sibling path keeps it out of the primary checkout's file watchers and build globs.
3. Run every remaining phase from inside that worktree (`../rb-issue-$1`) — point tool calls at its absolute paths and run npm/git with it as the cwd.
4. A fresh worktree shares `.git` but starts with no dependencies and no local secrets. Before running tests:
    - Reuse the primary checkout's dependencies instead of a slow reinstall: `ln -s "$(pwd)/node_modules" ../rb-issue-$1/node_modules` (run from the primary checkout; fall back to `npm ci` in the worktree if the symlink misbehaves).
    - Copy the gitignored `.env` so integration tests can read `REWST_TEST_TOKEN`: `cp .env ../rb-issue-$1/.env`.

## Phase 3 — Implement + test

- Make the smallest correct change that reads like the surrounding code (match comment density, naming, idioms). No redundant comments.
- Add or extend tests for the change — happy path, error paths, and the edge cases the change introduces.
- For assistant-steering / chat-behavior changes, the real proof is a live integration test (`src/test/integration/directive.test.ts`). It needs `REWST_TEST_TOKEN`; load it from `.env` without printing it, e.g.
  `npm run test:grep:integration -- "<exact live regression test name>"` for the focused check, then `npm run test:integration` when a broader live pass is warranted.
  Only exercise the sandbox org; never delete data without asking.

## Phase 4 — Verify

- `mcp__ide__getDiagnostics` on the edited files — zero errors.
- Target changed test areas first: `npm run test:grep -- "<Unit suite or test name>"`, and for live assistant behavior `npm run test:grep:integration -- "<Integration test name>"`.
- `npm run test:unit` — all green; re-run until clean. Report failures honestly with their output.

## Phase 5 — Document

- Add a **changelog note**, not a `CHANGELOG.md` edit. Create `changelog.d/$1.md` (or run `npm run changelog:new`) with frontmatter `category: Added|Changed|Fixed` and a body that is the bullet exactly as it should read in the changelog. Do **not** touch `CHANGELOG.md` — the release flow collates these notes, and one file per PR is what keeps the changelog conflict-free. See `changelog.d/README.md`.
- If the change is user-facing, update the matching `docs/` file and the README per CLAUDE.md "User-Facing Documentation".

## Phase 6 — Commit, push, PR

1. Stage the files for this fix. The worktree was checked out clean from `origin/main`, so there is no stray local noise to exclude. The pre-commit hook runs eslint + prettier + type-check.
2. Commit with a normal-English message whose body explains the _why_, ending with `Addresses #$1`.
3. `git push -u origin <branch>` (from the worktree).
4. `gh pr create --base main --title "<concise>" --body "..."` — the body covers the problem, the change, and how it was tested (state live-validation results honestly, including any unrelated flakes). Reference `#$1` with "Addresses", not "Closes".
5. Once the PR number is known, set `pr: <PR number>` in the `changelog.d/` note so the changelog links the PR (not the issue), then commit and push that one-line change.

## Phase 7 — Review loop

After the automated review (CodeRabbit) runs: fetch its comments, fix the legitimate findings (skip false positives with a one-line reason), push, and resolve each addressed thread with the GitHub GraphQL `resolveReviewThread` mutation. Leave the PR green and approved.

## Done

Report the PR URL. Then, from the primary checkout, tear down the worktree: `git worktree remove ../rb-issue-$1` (the branch and pushed PR remain on `origin`). The PR is now ready for `/merge_release`. Do not close the issue — the user closes it after confirming the fix.
