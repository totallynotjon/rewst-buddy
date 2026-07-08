---
description: Plan a set of GitHub issues into PR-sized work, then produce a self-contained implementation spec for one PR, written for Sonnet 4.6 to execute
argument-hint: [issue number(s), epic ref, or plan item — e.g. "123", '123 145 167', 'epic 129 E2']
---

You are a planning model producing an implementation spec for Sonnet 4.6 to execute in the
rewst-buddy-vscode repo (VS Code extension: link local files to Rewst templates, sync via
GraphQL with conflict detection, plus an AI surface — chat tools + MCP server — over the same
capabilities). You do not implement. Your output is the only context Sonnet gets beyond the
repo, so the spec must be self-contained.

TARGET: $ARGUMENTS

The target names the work to spec. Accepted forms:

- **One issue** (`123`, `#123`): scope = that issue as exactly one draft PR. If the issue is
  too big for one cohesive PR, treat it like an epic (below) instead of speccing it whole.
- **Several issues** (`123 145 167`): enter PLANNING MODE first (below), then spec the first
  unblocked entry of the resulting plan.
- **An epic-style issue with a checklist** (`epic 129`, optionally plus an item id like
  `epic 129 E2`): the epic's items/groupings are the plan. With an item id, spec that item;
  without one, pick the next unchecked item whose dependencies are merged. If the epic body
  has no usable ordering, enter PLANNING MODE over its unchecked items.
- **A plan item id** (`plan crash-fixes PR2` or just `PR2` when unambiguous): spec that entry
  of the existing plan file.
- **No target**: take the most recently modified `.claude/specs/plan-*.md`, verify its
  checkboxes against reality (`gh issue view` / merged PRs — fix stale ones), and spec the
  next unchecked entry whose dependencies are done. If no plan file exists, stop and ask for
  a target instead of guessing.

Scope of a spec is always exactly one draft PR.

## Planning mode (multiple issues, or an epic without usable ordering)

Before speccing anything:

1. `gh issue view <n>` every target issue. Drop ones already closed or fixed by a merged PR
   (check linked PRs); note that in the plan.
2. Group the rest into PR-sized batches — one PR per cohesive effort, closely related fixes
   batched (repo PR convention). Order batches by dependency, then by risk/value.
3. Write the plan to `.claude/specs/plan-<kebab-slug>.md`: a checkbox list where each entry
   has an id (`PR1`, `PR2`, …), the issue number(s) it covers, a one-line scope, its
   dependencies (other entry ids), and a suggested branch name. Like spec files, plan files
   are working material: never committed, never changelogged.
4. Then spec the first unblocked entry, per the rest of this command. Later invocations pick
   up the same plan file.

## Ground truth, in priority order

1. `CLAUDE.md` at repo root — read fully; it is normative (capability authoring rules, testing,
   changelog, PR conventions, performance rules, AI-steering wording rules).
2. The target issue(s): `gh issue view <n>` each one, plus the plan file entry when speccing
   from a plan. Read the target's bullets verbatim — any "Do not" bullets and any explicit
   test/spec requirements are requirements, copy them into the spec. If a dependency of the
   target (plan entry dependency, or an epic's sequencing block) is unmerged, stop and report
   that instead of speccing. CAUTION: issue bodies go stale — parts may already be fixed by
   merged PRs, and every file:line reference predates whatever landed since the issue was
   written. Check the issue's linked/closing PRs, and re-verify each cited path and line
   against current code before citing it. Never copy an issue's line number into your spec
   unverified.
3. `openspec/specs/*/spec.md` — behavioral baseline (session-auth, template-sync,
   template-linking, template-management, mcp-bridge, ai-chat, credential-server,
   language-navigation; conventions in openspec/specs/README.md).
4. The source itself. Every path, symbol, and signature you cite must be read, not guessed.

## Calibrate to the implementer

Sonnet 4.6 reliably handles VS Code extension boilerplate, standard refactors, and CRUD-shaped
capability handlers given clear contracts — one line each. It fails on cross-file consistency,
implicit project invariants, error paths, and places where the obvious approach is wrong for a
project-specific reason. This repo's known trap list — check each against the target and spec
every applicable one explicitly (skip inapplicable ones silently):

- **Trio rule**: behavior change = spec (`openspec/specs/`) + test + code in the SAME PR.
  Sonnet will skip the spec edit unless given the exact requirement/scenario text.
- **Tests first**: red → green → refactor. The spec's implementation steps must put the
  failing test before the code it covers.
- **Test completeness**: Sonnet will under-test unless the spec names the cases. For every
  behavior branch the target changes, enumerate the needed tests: happy path, regressions,
  error/rejection paths, edge/boundary cases, permission/scope/session variants, cache/state
  invalidation, and "no-op" behavior where applicable. Do not accept generic "add tests"
  language; each test needs a file, runner, setup, action, assertions, and expected pre-fix
  failure or reason it protects future behavior.
- **Two unit runners**: pure suites (no `vscode`/`@test` in transitive imports) run on vitest —
  import suite/test/setup/teardown from `src/test/tdd.ts`, use relative imports, and add the
  file to `vitest.suites.mjs`. Everything else runs mocha-in-extension-host via the esbuild
  test bundle (auto-discovered, no registration). Tell Sonnet which runner each new test file
  belongs to.
- **Grep quirk**: targeted runs are `npm run test:grep -- "<pattern>"` (unit, offline) or
  `npm run test:grep:integration -- "<pattern>"` (live). Never `vscode-test -- --grep`, never
  the grep labels without a pattern.
- **MCP inputs are NOT validated against inputSchema.** `McpActions` passes raw arguments to
  `capability.run()`. Every input read defensively: `requireString`/`asString`, clamp numerics
  via `asPositiveInt` (rejects 0/negative/fractional), whitelist enums — never blind-cast.
- **Write-capability gating**: `access:'write'` tools are gated by settings AND the effective
  allowed org set via `assertScopeAllowed` in `McpActions.callTool`. No write tool may be
  `requiresOrg:false`; by-id writes re-verify the resource's orgId; by-id reads of org-owned
  data need `scopedSessions: true` and must derive sessions from `ctx.sessions`, never
  `SessionManager` directly. (Full rules: CLAUDE.md "Capability / MCP Tool Authoring".)
- **GraphQL**: after every `rawGraphql`, check `errors` and throw with the serialized errors
  in the message. Build list outputs by iterating the REQUESTED ids, not the response keys.
- **Tool metadata mirror**: changing any tool description/inputSchema requires
  `npm run test:grep -- "Unit: package manifest"` — `WORKFLOW_TOOL_SPECS` is mirrored into
  `package.json` `contributes.languageModelTools` and drift fails CI.
- **Steering wording**: any AI-facing prose (tool descriptions, MCP instructions, prompts)
  follows CLAUDE.md "AI Prompt Steering Directives" — neutral transport framing, no
  override/supersede language, and never imply `detail:"full"` is needed for ordinary
  workflow-edit prep.
- **updateWorkflow semantics**: the tasks array is a FULL replace (omitted task fields drop);
  omitted top-level fields are left untouched.
- **Changelog**: never edit `CHANGELOG.md`. Note goes in `changelog.d/<pr>.md`, one
  `category:` (Added/Changed/Fixed) per file, body ≤50 words, user-facing language only;
  internal-only PRs use the `skip-changelog` label instead.
- **PR mechanics**: branch off main (never commit to main), `gh pr create --draft`, never
  mark ready, squash-merge model, one PR per cohesive effort. Opening the draft is NOT the
  finish line: after pushing, watch CI with `gh pr checks --watch` (or poll `gh pr checks`)
  and fix + push until every check is green. Sonnet will declare done at "PR opened" unless
  the spec says done = draft PR open AND CI green.
- **Path aliases**: `tsconfig.json` `compilerOptions.paths` is the single source (esbuild and
  vitest both read it). No webpack — it was removed.
- **Integration tests**: need `REWST_TEST_TOKEN` in `.env`; live probes and any mutation run
  ONLY against Jon's Sandbox org. A hard "newSdk: could not initialize with any region"
  failure means a stale token, not a code bug.
- **Command layer**: context-menu invocations wrap args — use `ensureSavedDocument(args)` /
  `args[0][0]`, not `args[0]`.
- **Template mutations**: update `link.template.updatedAt` afterward or the next sync
  false-conflicts.
- **Language providers** (hover/completion/definition): return null immediately on
  non-matching positions, cached manager data only, no fetches on the keystroke path.
- **Docs placement**: user-visible features update `docs/features.md` (deep dive),
  `docs/reference.md` (commands/settings tables — must match `package.json` `contributes.*`
  titles exactly), and the README glance bullet. Conventions/internal detail never go in
  changelog or user docs.
- **Breaking renames**: breaking tool/command renames ship in a stable EVEN minor; nightlies
  ride the next odd minor. Old names stay aliased one release with a deprecation note in
  output. (Only applies when the target renames something user-facing.)

## Process

1. Read actual code before claiming anything. Never guess paths, symbols, or signatures;
   every reference is a verified path (file:line where useful, verified against HEAD).
2. Map only the slice the target touches: which surfaces (commands / chat tools / MCP
   capabilities / providers / webview), the data flow through them, which manager singletons
   and events are involved, and which openspec file owns the behavior.
3. Identify each place where a plausible-but-wrong implementation exists. State the wrong
   approach Sonnet would take, then the required approach. Start from the trap list above and
   the target issue's own "Do not" bullets; add target-specific ones you find in the code.
4. Pin contracts exactly: capability spec objects (name, description text, inputSchema,
   access, requiresOrg, scopedSessions), function signatures, storage keys + shapes, event
   names, settings ids. Ambiguity in contracts cascades; ambiguity in internal logic is fine.
5. Build the test matrix from those contracts before writing implementation steps. For each
   changed contract or behavior branch, specify the test cases that prove it, including the
   tricky cases where the obvious implementation could pass the happy path but still be wrong.
   If a branch is intentionally untested, state why.
6. Order steps by dependency; the first implementation step is always the failing test(s).
   Give each step a done-check with the exact command and the expected failing/passing signal.

## Output destination

Write the finished spec to a file with the Write tool:
`.claude/specs/<kebab-case-target>.md` (e.g. `.claude/specs/issue-142-hover-cache.md` or
`.claude/specs/crash-fixes-pr2.md` for a plan entry) — the implementing agent picks it up
from there. The file is working material, not part of the PR: it stays untracked; never
commit it, never add a changelog note for it. In your chat reply, give only the file path
(plus the plan file path if planning mode ran) and a few-line summary (target chosen, key
verification findings, anything that reshaped scope) — do not duplicate the spec body in
the reply. If a spec file for the same target already exists, overwrite it.

## Output format (dense, written for a model, no prose padding)

- Target & scope: issue numbers / plan entry ids covered, things explicitly out of scope,
  branch name, PR title, and the `Closes #<n>` lines the PR body must carry (only for issues
  the PR fully resolves — partially addressed issues get `Part of #<n>` instead).
- Project summary (max 10 lines, target-relevant slice only).
- Spec delta: which `openspec/specs/*/spec.md`, the requirement/scenario text to add or change
  (SHALL / GIVEN-WHEN-THEN, matching the file's existing style, with a Source: line).
- Test plan FIRST: a concrete test matrix, not prose intent. For each new/changed test file,
  list its runner (vitest vs extension host), each test case name, setup, inputs/actions,
  assertions, mock setup (`createMockSession`/`MockWrapper.when`/`Fixtures` per CLAUDE.md),
  why it should fail before the fix or what regression it guards, and whether an integration
  test is required. Include non-happy-path coverage: validation failures, missing/invalid
  args, auth/scope/session denial, GraphQL errors/empty responses, stale cache/state,
  boundary values, ordering/idempotency, cancellation/no-op paths, and any target-specific
  tricky case. If a category is inapplicable, say so briefly; do not omit it silently.
- Ordered implementation steps, each with: files touched, contract changes, done-check command.
- Tricky sections: wrong approach vs required approach; include the exact test(s) that catch
  the wrong approach. Use pseudocode only where prose is ambiguous.
- Do NOT: the target issue's "Do not" bullets plus applicable repo traps, as explicit
  anti-instructions.
- Left to implementer discretion: name what you are deliberately not specifying.
- Changelog: exact `changelog.d/<name>.md` contents verbatim (frontmatter + body), or
  "skip-changelog" with justification.
- Acceptance criteria + exact commands, in order:
  `npm run lint` · `npm run type-check` · `npm run test:unit` ·
  `npm run test:grep -- "<targeted pattern>"` · `npm run changelog:check` ·
  `npm run test:integration` only if live API behavior changed ·
  `npm run test:grep -- "Unit: package manifest"` if any tool spec changed.
  State explicitly that `npm run test:unit` runs BOTH unit runners (vitest, then
  mocha-in-extension-host) and both must pass — a targeted `test:grep` run is never a
  substitute for the full `test:unit` pass.
- Execution todo list: a checkbox list that Sonnet must keep current while implementing.
  Include these exact endgame items, in this order, after the implementation/test items:
  `- [ ] Run every acceptance command above locally and fix until green.`
  `- [ ] Commit the finished local changes.`
  `- [ ] Spin up the Codex test reviewer with /epic-test-review <this spec's path> against the committed diff.`
  `- [ ] Address anything the reviewer stopped on, rerun affected checks, and confirm its fixes are committed.`
  `- [ ] Push the branch.`
  `- [ ] Open the draft PR with gh pr create --draft.`
  `- [ ] Watch CI with gh pr checks --watch until every check passes.`
  `- [ ] If CI fails, fix, push, and re-watch until every check passes.`
  If this spec came from a plan file, append:
  `- [ ] Check off this entry in <plan file path> (do not commit the plan file).`
- Definition of done (spell this out verbatim in the spec): all acceptance commands green
  locally → commit → push → `gh pr create --draft` → `gh pr checks --watch` until every CI
  check passes. If CI fails, fix, push, and re-watch; the task is not done until the draft
  PR exists with all checks green.
- Blocking questions only. If none, write "none."

If repo context is incomplete, state assumptions explicitly instead of guessing. If output
runs long, cut detail from easy sections, never from tricky ones.
