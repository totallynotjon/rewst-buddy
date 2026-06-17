# Changelog notes (`changelog.d/`)

Every PR that changes user-facing behavior adds **one file here** instead of
editing `CHANGELOG.md` directly. Because each PR touches its own file, two PRs
never edit the same lines — so the changelog stops causing merge conflicts.

These notes are **version-agnostic**: a release rolls up however many notes have
accumulated into a single `CHANGELOG.md` section, so one release can cover many
PRs. The version is assigned only at release time, never in the note.

## Adding a note

```bash
npm run changelog:new
```

It asks for a category and a one-line summary and writes the file for you,
filling in the PR/issue number from `gh` or your branch name. Or write the file
by hand:

```
changelog.d/<pr-or-issue-number>.md      e.g. changelog.d/42.md
```

```markdown
---
category: Added
pr: 42
---

- **Short bold lead** — the entry exactly as it should read in the changelog.
  Nested bullets and extra lines are allowed for richer entries.
```

- **`category`** (required): `Added`, `Changed`, or `Fixed` (also accepts
  `Deprecated`, `Removed`, `Security`). Common synonyms like `Feature`/`Bugfix`
  are auto-corrected.
- **`pr`** (optional): the PR number. If you name the file `<number>.md` it is
  inferred. The collator appends `(#<pr>)` to the first line for you.
- **Body**: the Markdown bullet(s) as they should appear under the category
  heading. Start with `- `.

## How it ships

- **On every PR**, CI requires at least one new note here and validates them
  (`scripts/changelog/check.mjs`). A PR that legitimately needs no entry carries
  the `skip-changelog` label.
- **At release**, `scripts/changelog/build.mjs --version x.y.z` folds all notes
  into a new `## [x.y.z]` section in `CHANGELOG.md` and deletes them.
