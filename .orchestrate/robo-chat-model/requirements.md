# Feature: RoboRewsty as a native chat model (remove Copilot account requirement)

## Summary

- Today, Rewst Buddy's AI chat is the `@rewst` chat participant inside the VS Code chat view. The chat view only functions when a language model is available, which in practice requires a GitHub Copilot sign-in/plan. Users without Copilot accounts cannot use RoboRewsty.
- Outcome: RoboRewsty appears as a selectable model in VS Code chat's model picker. Chatting with it requires no GitHub account and no Copilot plan. (The free Copilot Chat extension may remain installed as the chat surface — accepted by the user.)
- The `@rewst` chat participant is retired, unless a parity feature can only be delivered as a participant — any such retention must be justified and recorded in DECISIONS.md.
- Full feature parity with the current participant experience:
  - Local workspace read tools, edit tools (with visible diffs), web tools, command tool, and the session-authenticated GraphQL tool — all governed by the same existing `rewst-buddy.ai.*` settings.
  - Rewst-side action approvals (Approve once / Always allow) still work.
  - Resuming previous Rewst conversations still works, including continued multi-turn context.
  - Applying suggested code to a file still works.
  - Source citations still shown.
- Everything else untouched: template sync, sessions, server features, existing settings names and meanings.

## Acceptance criteria

1. `package.json` contributes `languageModelChatProviders` (vendor + displayName) and the extension registers a `LanguageModelChatProvider` exposing RoboRewsty as a model (org/session resolution preserved: single session auto-selects; multiple sessions resolved per a Layer-1-decided mechanism such as per-org models or a picker). Verify: `npm run test:unit` provider tests exit 0; manual: model appears in the picker.
2. Selecting RoboRewsty and sending a chat message streams the answer through the existing `askRewstAi` streaming path. Verify: unit test with mocked conversation stream; manual smoke in Extension Development Host.
3. **Signed-out verification:** on VS Code ≥ 1.122 with no GitHub account signed in and no Copilot plan, the RoboRewsty model is selectable and a chat turn completes end to end. Verify: manual acceptance check in a signed-out profile (documented as a release checklist step in the verify evidence), plus `engines.vscode` ≥ ^1.122.0 asserted by a unit test or grep check.
4. **Tool ownership:** every locally-executed tool (workspace read, edit, web, command, GraphQL) is exposed to chat as a registered VS Code language-model tool (`package.json` `languageModelTools` + `vscode.lm.registerTool`), enabled/disabled by the same existing `rewst-buddy.ai.*` settings; where the chat UI's built-in agent tools already cover a capability, the Layer-1 plan may delegate to them, recording the mapping in DECISIONS.md. Verify: unit tests that each enabled setting yields its registered tool and each disabled setting withholds it.
5. **Tool-call translation:** the provider declares the `toolCalling` capability; tools passed by VS Code in `options.tools` are injected into RoboRewsty's text tool protocol, and parsed tool requests are emitted as `LanguageModelToolCallPart`s, with `LanguageModelToolResultPart`s folded into the follow-up turn. The provider advertises to RoboRewsty only the tools permitted by the existing `rewst-buddy.ai.*` settings semantics — a tool whose governing setting is disabled is excluded from injection even if present in `options.tools`. The provider never emits a tool call whose name is not present in `options.tools`; an out-of-set request from the model is returned as text/error content instead of a stalled call. Verify: unit tests covering declared-tool injection, the settings filter (disabled setting → tool withheld despite presence in `options.tools`), output→tool-call parsing, result folding, and the undeclared-tool fallback.
6. **Approvals:** a Rewst-side approval pause surfaces with approve-once / always-allow choices, and the turn resumes correctly after approval, without the participant. Approve-once reverts the allow-list after the turn; always-allow persists. Verify: unit tests of the approval mapping and revert; manual.
7. **Conversation continuity and isolation:** consecutive chat turns with the RoboRewsty model continue the same backend conversation (conversationId persisted and reused across provider requests within a chat session), and after resuming a previous Rewst conversation, subsequent turns continue that conversation rather than starting a new one. Independent chat sessions (and different org/session selections) map to distinct backend conversations — no shared "current conversation" global. Verify: unit tests asserting (a) two sequential provider requests from one chat session hit the mocked backend with the same conversationId, (b) the post-resume turn reuses the resumed conversationId, and (c) interleaved requests from two distinct chat sessions/orgs keep distinct conversationIds.
8. **Conversation resume:** previous Rewst conversations can be listed and loaded, then continued per criterion 7. Verify: unit test of the listing/loading path; manual.
9. **Apply-to-file:** code blocks in a RoboRewsty answer can still be applied to the attached/active file with a diff preview shown before the edit lands (native chat UI affordance or the existing `ApplyRewstAiEdit` command — mechanism decided in Layer 1 and recorded). Verify: unit test asserting the preview path is invoked before content is written (a direct-write path fails the test); manual check that the preview appears and the code block lands only after confirmation.
10. **Source citations:** when RoboRewsty returns sources, they are rendered with the answer (links and labeled non-URL sources). Verify: unit test of the source-rendering formatting; manual.
11. The `@rewst` participant registration and its package.json contributions are removed (or retention justified in DECISIONS.md). Verify: grep of package.json contributions and activation code.
12. Existing `rewst-buddy.ai.*` settings keep their names and semantics; docs updated (docs/features.md, docs/reference.md, README features-glance bullet, CHANGELOG). Verify: diff review against docs conventions.
13. Full unit suite green: `npm run test:unit` exit 0.

## Architecture notes (internal; bound at Layer 1, not here)

- Map `provideLanguageModelChatResponse` onto the existing `ConversationClient`/`askRewstAi` subscription machinery.
- RoboRewsty is stateful server-side (conversationId); the provider API is a stateless message-array contract — a conversation-mapping layer keyed on the chat session/message history is required (strategy decided in Layer 1; criterion 7 binds the behavior).
- Approvals likely map to a registered LanguageModelTool with VS Code's confirmation UI, else surfaced via notification/command; criterion 6 binds the behavior, not the mechanism.
- Conversation resume likely a command (`Resume Rewst AI Conversation`) since model providers have no slash commands.
- Research (corroborated, ≥2 independent hosts): LM Chat Provider API finalized in VS Code 1.104 (Aug 2025); Copilot sign-in/plan requirement for extension-contributed models removed in VS Code 1.122 (May 2026); chat UI (Copilot Chat extension) is free and open source.
