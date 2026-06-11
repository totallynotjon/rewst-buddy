# Pre-lock gate record (fold into DECISIONS.md at LOCK)

## Research findings (web validation, corroborated)

- LanguageModelChatProvider API finalized in VS Code 1.104 (Aug 2025): extensions contribute models to the chat model picker; toolCalling capability; tool-call/result streaming parts.
  Sources: code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider (primary, current), code.visualstudio.com/updates/v1_104 (primary), github.com/microsoft/vscode-extension-samples chat-model-provider-sample (primary).
- Copilot sign-in/plan requirement for BYOK / extension-contributed models removed in VS Code 1.122 (May 2026); works signed-out / offline.
  Sources: code.visualstudio.com/docs/agent-customization/language-models (primary, current), github.blog/changelog/2026-04-22-bring-your-own-language-model-key-in-vs-code-now-available (primary, independent host), visualstudiomagazine.com 2026/05/29 vs-code-1-122-lets-byok-work-without-github-sign-in (secondary, independent host).
  Status: corroborated (3 hosts, all within recency window). Decision impact: changed-plan (made "no sign-in" outcome achievable; engines floor set to ^1.122.0).
- Interim conflict noted and resolved: 1.104-era docs and the Oct 2025 BYOK blog stated extension-contributed models required individual Copilot plans (Free/Pro/Pro+); that restriction was lifted in 1.122. Current docs are authoritative.

## Gate round 1 (task-mq9rgyvg-umbewc) — 4 major objections, all resolved by revision

1. Signed-out outcome unverified → added AC3: explicit signed-out, no-plan manual acceptance check + engines assertion.
2. Tool ownership underspecified → AC4 pins every local tool as registered `languageModelTools` gated by existing settings; built-in delegation allowed if mapped in DECISIONS.md.
3. Apply-to-file and source citations lacked criteria → added AC9, AC10.
4. Multi-turn continuity after resume unverifiable → added AC7 binding same-conversationId behavior with unit tests.

## Gate round 2 (task-mq9rqc1c-4v907i) — 3 major objections, resolved by applying the reviewer's prescribed tightening verbatim (two-round cap reached; resolutions recorded here)

1. AC5 settings filter: provider must advertise only settings-permitted tools, even if VS Code passes more in options.tools; unit test added to criterion.
2. AC7 isolation: distinct chat sessions/orgs map to distinct backend conversations; interleaved-session unit test added.
3. AC9 diff preview: verification now asserts the preview path is invoked before write; direct-write fails the test.

No unresolved critical/major objections remain. Suggestions: none recorded.

---

# Layer 1: sequence + architecture decisions (canonical)

Single source of truth for cross-cutting decisions. Every plan/task file REFERENCES
these by id (D1–D8); never copies them.

## Bound decisions

- **D1 — Model identity / multi-session.** Register ONE `LanguageModelChatInformation`
  per active session-org (model id derived from orgId). Single session → one
  auto-selected model; multiple sessions → one model per org in the picker. The chosen
  model's org selects the backend session; distinct org models map to distinct backend
  conversations. No separate in-turn org picker.
- **D2 — Stateless→stateful conversation mapping.** The provider API is stateless (full
  message array per call) and exposes NO chat-session id; RoboRewsty is stateful
  (`conversationId`). An in-memory map keyed by `hash(orgId + serialized prior-history
PREFIX)` (all messages except the trailing user turn) holds prefix → conversationId.
  Empty prefix (first turn) ALWAYS starts a new backend conversation; a non-empty prefix
  that matches a stored key reuses its conversationId; a miss starts a new one. Distinct
  orgs and distinct conversation content → distinct keys → distinct conversationIds
  (criterion 7 isolation for the realistic case). **Accepted, documented limitation:** two
  same-org chat sessions with BYTE-IDENTICAL histories (same prompt and same model answer)
  are indistinguishable to a session-id-less stateless provider and will share one backend
  conversation until their histories diverge, after which they key/branch apart correctly.
  Criterion-7c unit tests assert isolation across distinct content and distinct orgs (not
  the byte-identical edge). [resolves gate-round-1 obj 1]
- **D3 — Tool ownership (concrete names, single source).** Expose EVERY concrete local
  tool — derived by iterating the existing spec arrays `WORKSPACE_TOOL_SPECS`,
  `EDIT_TOOL_SPECS`, `WEB_TOOL_SPECS`, `COMMAND_TOOL_SPECS`, `GRAPHQL_TOOL_SPECS` (16 tools:
  read_file, list_files, search_files, open_file, find_symbols, get_diagnostics,
  get_file_outline, list_open_files, list_template_links, edit_file, write_file,
  web_search, fetch_url, run_command, rewst_graphql, rewst_graphql_schema) — as registered
  VS Code language-model tools (`package.json languageModelTools` + `vscode.lm.registerTool`),
  each NAME-FOR-NAME identical to its protocol name and gated by its governing setting. NO
  collapse to category tools, NO delegation to built-in agent tools. Registration iterates
  the spec arrays so registered names always equal the text-protocol names. [resolves obj 3]

    Tool → setting mapping (governing `rewst-buddy.ai.*` setting):
    | tools | setting |
    |---|---|
    | read_file, list_files, search_files, open_file, find_symbols, get_diagnostics, get_file_outline, list_open_files, list_template_links | enableWorkspaceTools |
    | edit_file, write_file | enableWorkspaceTools AND enableEditTools |
    | web_search, fetch_url | enableWebTools |
    | run_command | enableCommandTool |
    | rewst_graphql, rewst_graphql_schema | enableGraphqlTool |
    (Exact per-module membership is taken from the spec arrays at implementation time;
    the arrays are authoritative if this table and the code ever disagree.)

- **D4 — Tool-call translation.** Provider declares `capabilities.toolCalling`. Tools VS
  Code passes in `options.tools` are filtered by the D3 settings semantics, then injected
  via the EXISTING text protocol (`buildToolInstructions`). RoboRewsty's `rewst-tool`
  replies are parsed (`parseToolRequests`) and emitted as `LanguageModelToolCallPart`s;
  `LanguageModelToolResultPart`s returned in the next message array are folded back into
  the next backend turn (`formatToolResults`). A tool whose governing setting is disabled
  is never injected even if present in `options.tools`. A parsed request whose name is not
  in `options.tools` is returned as text/error content, never a stalled tool call. Emitted
  ToolCallPart names == registered tool names == protocol names (guaranteed by D3's single
  spec-array source).
- **D5 — Approvals.** On an `approval` event the provider surfaces a modal
  `showInformationMessage` (Approve once / Always allow / Cancel). Approve → `addAllowedTool`
  then continue the SAME provider response inline (the provider owns its loop, so no
  participant-style button/re-open hack). Approve-once reverts via `removeAllowedTool` after
  the turn; Always-allow persists.
- **D6 — Conversation resume.** Command `Resume Rewst AI Conversation` (providers have no
  slash commands) lists/loads a prior conversation, renders its transcript, and sets a
  ONE-SHOT, ORG-SCOPED pending binding `pendingResume[orgId] = conversationId`. The NEXT
  provider turn whose prefix is empty (a fresh turn) for that org binds to the pending
  conversationId instead of starting a new conversation, then CLEARS the binding;
  thereafter normal D2 prefix continuity applies. The binding is consumed by exactly one
  fresh turn and is the user's just-expressed intent (they chose to resume), so continuing
  the resumed conversation on their next message is correct, not a leak; an already-resumed
  or non-fresh turn does not consume it. Criteria 7b/8 bound by unit tests:
  (a) resume sets pending and the next fresh turn reuses the conversationId; (b) after
  consumption a later fresh turn starts a new conversation. [resolves obj 2]
- **D7 — Apply-to-file.** The existing `ApplyRewstAiEdit` command (diff-preview shown
  BEFORE write) is the CANONICAL, guaranteed-preview apply path, registered as an invocable
  command (command palette / editor context) operating on the active file with a chosen
  code block. VS Code's built-in native code-block "Apply" affordance is supplementary and
  NOT under extension control (it cannot be intercepted to force our preview), so the
  criterion-9 guarantee rides on the `ApplyRewstAiEdit` command, whose unit test asserts the
  preview path is invoked before any write (a direct-write path fails the test). [resolves obj 5]
- **D8 — Source citations.** Port the participant's source rendering into the provider
  response: URL sources as references/links, non-URL sources as a labeled list.

## Engines / types floor (criterion 3)

`engines.vscode` is raised to `^1.122.0` (the runtime floor that makes signed-out usage work,
per AC3) and `@types/vscode` to `^1.120.0` (plus lockfile), so the provider compiles against the
finalized LanguageModelChatProvider API surface. A type-check/compile is part of task 001's
done-check, not just an engines grep. [resolves obj 4]

### Decoupling of `@types/vscode` from the engine floor (task-001 forced revision)

ORIGINAL plan pinned BOTH `engines.vscode` and `@types/vscode` to `^1.122.0`. That is
unsatisfiable: `@types/vscode@^1.122.0` is NOT published on npm (highest published is `1.120.0`;
`npm install` fails ETARGET). The `LanguageModelChatProvider` API
(`registerLanguageModelChatProvider`, `provideLanguageModelChatInformation`/`Response`,
`toolCalling` capability) was FINALIZED in VS Code 1.104 (research 003, corroborated), so the
`1.120.0` typings already contain the full API surface; the 1.122 change was runtime/licensing
(no Copilot sign-in required), NOT a new typings symbol. Resolution: keep `engines.vscode`
`^1.122.0` (unchanged — satisfies the AC3 runtime floor + engines assertion), pin
`@types/vscode` to `^1.120.0` (highest published). Standard practice: typings lag the engine
floor. Validated by Codex gate (task-mq9th83b-44xym8 → AGREE; touched none).

## Gate round 1 (task-mq9s4b7l-vurxrc) — 5 major objections, all resolved by plan revision

1. D2 prefix-hash didn't guarantee distinct-session isolation → D2 revised: org+history-prefix
   key; isolation guaranteed for distinct content/org; byte-identical-history collision
   documented as an inherent stateless-API limit; criterion-7c tests use distinct content.
2. D6 resume unreliable via map pre-seed → D6 revised to a one-shot org-scoped pending-resume
   binding consumed by the next fresh turn, with unit tests for reuse and post-consumption reset.
3. "Five tools" would break tool parity → D3 revised to register all 16 concrete tools by
   iterating the existing spec arrays (single source), name-for-name, gated per setting.
4. engines bump without `@types/vscode`/lockfile bump would fail compile → task 001 bumps both
   and adds a compile/type-check to its done-check.
5. Native apply affordance not bound to the preview path → D7 fixes the apply mechanism on the
   `ApplyRewstAiEdit` command (guaranteed preview-before-write, unit-tested); native affordance
   documented as uncontrollable/supplementary.
