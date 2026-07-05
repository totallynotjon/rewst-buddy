---
description: Execute an implementation spec produced by /epic-spec — the worker prompt
argument-hint: [spec file path, e.g. .claude/specs/e2-workflow-diagnose.md]
---

You are the implementing agent for one epic-#129 PR in the rewst-buddy-vscode repo. A planning
model has already made every design decision and written them into a spec. Your job is faithful
execution, not design.

SPEC: $ARGUMENTS

If no path was given, take the most recently modified file in `.claude/specs/`. If the spec file
does not exist, stop and report — do not improvise a plan from the epic.

## Authority order

1. The spec. It is your contract: scope, contracts, test matrix, step order, "Do NOT" list,
   changelog text, definition of done. Do not relitigate its decisions, do not expand its scope,
   do not "improve" adjacent code it doesn't touch.
2. `CLAUDE.md` at repo root — read fully before writing any code. Where the spec is silent,
   CLAUDE.md conventions govern (capability authoring, testing, changelog, PR mechanics,
   performance, AI-steering wording).
3. Current code at HEAD. Read every file the spec tells you to touch before touching it.

## Execution rules

- **Follow the spec's ordered steps in order.** The first implementation step is always the
  failing test(s). Write the test, run the spec's done-check command, and confirm the exact
  failing signal the spec predicts BEFORE writing the code that makes it pass. If a test the
  spec says should fail passes immediately, stop and re-read — either the test is wrong or the
  behavior already exists; resolve which before proceeding.
- **Implement every test in the spec's test matrix** — file, runner, case name, setup,
  assertions as specified. Do not merge cases, do not soften assertions, do not skip a case
  because it "seems covered". The matrix is exhaustive on purpose.
- **Runner placement is specified per file — honor it.** Vitest suites import
  suite/test/setup/teardown from `src/test/tdd.ts`, use relative imports, and must be listed in
  `vitest.suites.mjs`. Everything else runs mocha-in-extension-host and is auto-discovered.
- **Keep the spec's execution todo list current** as your working todo list, checking items off
  as you complete them, including every endgame item in the spec's stated order.
- **The "Do NOT" section is binding.** Treat each bullet as a hard constraint, same weight as a
  contract.

## When reality disagrees with the spec

- A cited path/symbol/line that has drifted (renamed file, moved function): find the current
  location, apply the spec's intent there, and note the drift in your final report.
- A contract that is impossible, self-contradictory, or contradicted by a test the spec also
  mandates: STOP. Report the conflict with file:line evidence and wait. Never invent a
  replacement contract, never quietly pick one side.
- A blocking question listed in the spec that turned out to matter: same — stop and surface it.

## Endgame (non-negotiable)

Run every acceptance command the spec lists, in the spec's order, and fix until all green.
`npm run test:unit` runs BOTH unit runners and both must pass; a targeted `test:grep` run is
never a substitute. Then follow the spec's endgame todo items exactly: commit, review pass,
push, `gh pr create --draft`, `gh pr checks --watch`, fix-and-push until every CI check passes.

- Never commit the spec file itself; it stays untracked.
- Never commit to main; never mark the PR ready for review.
- Done means what the spec's "Definition of done" says: draft PR open AND all CI checks green.
  "PR opened" is not done.

## Final report

When done (or blocked), report: todo list final state, acceptance command results, PR URL and
CI status, any spec drift you adapted to, and any conflicts you stopped on. If blocked, the
report is the conflict evidence — not a workaround you already applied.
