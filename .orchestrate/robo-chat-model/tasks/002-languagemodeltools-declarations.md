---
id: '002'
slug: languagemodeltools-declarations
status: pending
depends_on: ['001']
codex_task_id: null
codex_session_id: null
worktree_branch: null
worktree_path: null
attempts: 0
tokens: 0
---

# Task 002: Declare the concrete local tools in package.json

## Agreed approach (spec-level)

Add `contributes.languageModelTools` entries for EVERY concrete tool name listed in
DECISIONS.md D3 (all 16, derived from the existing spec arrays `WORKSPACE_TOOL_SPECS`,
`EDIT_TOOL_SPECS`, `WEB_TOOL_SPECS`, `COMMAND_TOOL_SPECS`, `GRAPHQL_TOOL_SPECS`).

- Each entry's `name` MUST equal the spec's `name` exactly (read_file, list_files,
  search_files, open_file, find_symbols, get_diagnostics, get_file_outline,
  list_open_files, list_template_links, edit_file, write_file, web_search, fetch_url,
  run_command, rewst_graphql, rewst_graphql_schema). Name parity with the text protocol is
  the point (obj 3).
- Provide `displayName`, `modelDescription` (reuse each spec's `description`), and an
  `inputSchema` matching each spec's args. Mark `canBeReferencedInPrompt` as appropriate.
- This task is manifest-only. Registration code is task 003.

## Allowed files

- `package.json`
- `src/ui/chat/tools/*.ts` — READ ONLY for names/args; do not modify

## Done-check

- `node -e "const p=require('./package.json'); const names=(p.contributes.languageModelTools||[]).map(t=>t.name); for(const n of ['read_file','list_files','search_files','open_file','find_symbols','get_diagnostics','get_file_outline','list_open_files','list_template_links','edit_file','write_file','web_search','fetch_url','run_command','rewst_graphql','rewst_graphql_schema']) if(!names.includes(n)) throw 'missing '+n;"` exits 0
- `npm run test:unit` exits 0
