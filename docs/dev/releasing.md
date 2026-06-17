# Releasing & changelog (maintainers)

The changelog is built from **per-PR notes**, and releases run through GitHub
Actions with two human approval gates so nothing reaches `main` or the
Marketplace unreviewed.

## Changelog notes

- Each PR adds one file under [`changelog.d/`](../../changelog.d/README.md)
  (`npm run changelog:new`). No PR edits `CHANGELOG.md` directly, so there are
  no changelog merge conflicts.
- Notes are version-agnostic. A release rolls up however many have accumulated.
- `npm run changelog:check` (CI, per PR) requires a note and validates them.
- `npm run changelog:build -- --version x.y.z` collates the notes into
  `CHANGELOG.md` and deletes them. `--preview` prints without writing.

## Release flow

1. **Prepare** — run the **Prepare release** workflow (Actions → Run workflow)
   with the target version. It collates `changelog.d/` into a `## [x.y.z]`
   section, bumps `package.json`, and opens a `release/vx.y.z` PR.
2. **Review & merge** — review the PR and merge it (squash). Branch protection
   requires the approval here — this is gate #1.
3. **Tag** — from the merged `main`: `npm run release:tag` (tags `vx.y.z` and
   pushes it).
4. **Publish** — the tag triggers the **Publish** workflow. It runs in the
   `release` environment, which requires a maintainer to approve the run — gate
   #2 — then packages the `.vsix`, creates the GitHub release, and publishes to
   the Marketplace. The `VSCE_PAT` is scoped to that environment, so it never
   unlocks without that approval.

## One-time GitHub setup (required for the gates)

These live in repo settings, not in code — set them once:

- **Branch ruleset on `main`**: require a pull request, ≥1 approval, conversation
  resolution, and the `CI / Lint, type-check, build, test` + `CI / Changelog
note` status checks; block direct pushes and force-pushes. CodeRabbit's
  `request_changes_workflow` (`.coderabbit.yaml`) then counts toward the gate.
- **`release` environment** (Settings → Environments): add yourself / maintainers
  as **required reviewers**, and store the **`VSCE_PAT`** secret (a VS Code
  Marketplace PAT for the `JBramley` publisher) there — not as a repo-wide secret.
  Optionally add `OVSX_PAT` for Open VSX and uncomment that step in
  `publish.yml`.

## Hardening notes

- Workflows declare least-privilege `permissions:` and use
  `persist-credentials: false` except where a push is required.
- Actions are referenced by major version tag. For supply-chain hardening, pin
  them to full commit SHAs (e.g. with `pin-github-action` or `zizmor`).
- The publish token lives only in the `release` environment and is referenced
  only by the publish step, behind the required-reviewer gate.
