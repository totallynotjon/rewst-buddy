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
