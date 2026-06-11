---
id: '012'
slug: docs-and-changelog
status: pending
depends_on: ['011']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 012: Docs, CHANGELOG, and full suite green

## Agreed approach (spec-level)

Implement criteria 12 and 13. Update user-facing docs to reflect that RoboRewsty is now a
chat MODEL (picker) rather than the `@rewst` participant, working signed-out, with the same
`rewst-buddy.ai.*` settings (names/semantics unchanged):

- `docs/features.md`: rewrite the AI feature deep dive (model picker, tools, approvals,
  resume command, apply-to-file, sources).
- `docs/reference.md`: update commands list (new `Resume Rewst AI Conversation`; remove the
  `@rewst /resume` slash reference) and confirm the settings table still matches package.json.
- `README.md`: update the features-at-a-glance bullet.
- `CHANGELOG.md`: add an entry for the model-provider migration.
  Follow the doc conventions in CLAUDE.md (which file owns which content; command names match
  `package.json` titles exactly).

## Allowed files

- `docs/features.md`, `docs/reference.md`, `README.md`, `CHANGELOG.md`

## Done-check

- `grep -rni "@rewst" docs README.md` shows no stale participant references (or only
  historical CHANGELOG mentions).
- Settings table in `docs/reference.md` matches `package.json` `rewst-buddy.ai.*`.
- `npm run test:unit` exits 0 (criterion 13).
