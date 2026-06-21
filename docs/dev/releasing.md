# Releasing & changelog (maintainers)

The changelog is built from **per-PR notes**, and releases run through GitHub
Actions. Approving and merging the release PR is the single human gate — it both
lands the version on `main` and publishes to the Marketplace. There is no manual
release skill — these workflows are the whole process.

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
   picking a version bump (`patch`/`minor`/`major`) or an explicit version. It collates `changelog.d/` into a `## [x.y.z]`
   section, bumps `package.json`, and opens a `release/vx.y.z` PR.
2. **Review & merge — this ships it.** Review the PR and merge it (squash).
   Branch protection requires the approval here, and **merging is the approval to
   publish**: on merge, `tag-on-merge.yml` creates and pushes the `vx.y.z` tag
   (using the release-bot App token, so the tag triggers Publish).
3. **Publish** — the tag triggers the **Publish** workflow, which packages the
   `.vsix`, creates the GitHub release, and publishes to the Marketplace
   automatically. The `VSCE_PAT` is scoped to the `release` environment, so only
   that job can read it.

> If the auto-tag ever needs re-running by hand, `npm run release:tag` from the
> merged `main` does the same thing.

## Nightly (pre-release) channel

There are **two Marketplace channels for the one extension**, split by VS Code's
even/odd minor convention:

- **Stable** rides **even** minors (`package.json` on `main`, e.g. `0.44.x`) and
  ships only through the Release flow above.
- **Nightly** rides the next **odd** minor and ships automatically: every push to
  `main` runs `nightly.yml`, which publishes a `--pre-release` build as
  `MAJOR.<oddMinor>.<build>`, where `<build>` is `git rev-list --count HEAD` — a
  monotonic commit count. So stable `0.44.x` ⇒ nightly `0.45.<build>`.

The odd minor is derived from `package.json`, so when a release bumps stable to
`0.46.0`, nightlies automatically move to `0.47.<build>`. Because even-stable is
always below the surrounding odd-nightly and the next even-stable is above it,
versions only ever increase across both channels — the Marketplace's
single-extension requirement. `nightly.yml` **fails fast** if `package.json` ever
lands on an odd minor (that would collide with the nightly minor).

Before packaging, the nightly injects the pending `changelog.d/` notes into its
`CHANGELOG.md` as a preview section (`build.mjs --preview`), so pre-release users
see "what's new since stable". This is **runner-only and non-destructive** — the
committed `CHANGELOG.md` and the notes are untouched (the real stable release
still collates them), and an empty or invalid note never fails the publish.

Nightlies are **not tagged and get no GitHub release** — only stable does. The
job runs in its own **`nightly`** environment, scoped to the `main` branch, while
the stable `release` environment stays scoped to `v*` tags. Each environment
answers only the ref that should drive it, so the publish token is reachable only
from protected refs (tags for stable, `main` for nightly) and never from an
unmerged PR or feature branch — even though both environments reuse the same
`VSCE_PAT`. Users opt in with the extension's **"Switch to Pre-Release Version"**
button in the Extensions panel.

## One-time GitHub setup (required for the gates)

These live in repo settings, not in code — set them once:

- **Branch ruleset on `main`**: require a pull request, ≥1 approval, conversation
  resolution, and the `CI / Lint, type-check, build, test` + `CI / Changelog
note` status checks; block direct pushes and force-pushes. CodeRabbit's
  `request_changes_workflow` (`.coderabbit.yaml`) then counts toward the gate.
- **`release` environment** (Settings → Environments): store the **`VSCE_PAT`**
  secret (a VS Code Marketplace PAT for the `JBramley` publisher) here as an
  **environment secret** — not a repo-wide secret — so only the publish job can
  read it. Leave it with **no required reviewers**: merging the release PR is the
  publish approval, so a second environment gate would just re-ask. Optionally add
  `OVSX_PAT` for Open VSX and uncomment that step in `publish.yml`.
- **`nightly` environment** (Settings → Environments): used by `nightly.yml` for
  the pre-release channel. Restrict its **deployment branches** to **`main` only**
  (custom branch policy), and store the **`VSCE_PAT`** secret here too — reuse the
  same Marketplace PAT as `release` (a Marketplace PAT can't be scoped to a single
  release, so a second token buys no real isolation and just doubles what you
  rotate). Leave it with **no required reviewers** (nightlies publish
  automatically on merge). The split from `release` is about **deployment refs,
  not the credential**: `release` answers only `v*` tags and `nightly` only the
  `main` branch, so neither can be triggered from an unmerged PR/feature branch,
  and the tag path can't mint a nightly nor the branch path a stable release. The
  environment and its branch policy can be created with the GitHub API (`gh api
  .../environments/nightly` + `.../deployment-branch-policies`); only the secret
  must be added by hand.
- **Release-bot GitHub App** (for the Prepare release PR): the default
  `GITHUB_TOKEN` cannot open a PR, and a PR it opened would not trigger the
  required CI checks. So `release.yml` mints a short-lived token from a GitHub
  App instead. One-time setup:
    1. Settings → Developer settings → **GitHub Apps → New GitHub App**. Name it
       (e.g. `rewst-buddy-release-bot`), set any Homepage URL, and **uncheck
       Webhook → Active**.
    2. **Repository permissions**: `Contents: Read and write` and
       `Pull requests: Read and write` (Metadata read-only is implied). Install
       target: **Only on this account**. Create the app.
    3. On the app's page, note the **App ID** and **Generate a private key**
       (downloads a `.pem`).
    4. **Install App** → this account → **Only select repositories** →
       `rewst-buddy`.
    5. Store the credentials as repo secrets: **`RELEASE_APP_ID`** (the App ID)
       and **`RELEASE_APP_PRIVATE_KEY`** (the `.pem` contents).

## Hardening notes

- Workflows declare least-privilege `permissions:` and use
  `persist-credentials: false` except where a push is required.
- Actions are referenced by major version tag. For supply-chain hardening, pin
  them to full commit SHAs (e.g. with `pin-github-action` or `zizmor`).
- The publish token lives only in the `release` environment and is referenced
  only by the publish step, behind the required-reviewer gate.
