# AI Chat Specification

## Purpose

The extension surfaces Rewst's AI assistant ("Cage-Free Rewsty") as a VS Code
chat model, lets the assistant run a bounded set of in-process "Buddy" tools, and
lets users apply the assistant's suggested edits behind a diff preview. This
capability covers the chat provider, its settings, the tool protocol, and the
related commands.

Source: `src/ui/chat/` (`model/RoboRewstyChatModelProvider.ts`,
`tools/toolProtocol.ts`, tool specs), `src/commands/ui/AskRewstAI.ts`,
`src/commands/ui/ResumeRewstAiConversation.ts`,
`src/commands/ui/ApplyRewstAiEdit.ts`.

## Requirements

### Requirement: Provide a Rewst-backed chat model

The system SHALL register a VS Code chat model (vendor `rewst-buddy`, displayed
as "Cage-Free Rewsty") that streams responses from Rewst's AI backend for the
active organization's session.

#### Scenario: User chats with the model

- **GIVEN** an authenticated session
- **WHEN** the user selects the Cage-Free Rewsty model and sends a message
- **THEN** the message is sent to Rewst's AI backend and the streamed response is
  shown in the chat view

### Requirement: Preserve conversation continuity safely

The system SHALL reuse a warm backend conversation for follow-up turns in the
same visible chat when the replayed VS Code history is still at the backend
conversation tip. It SHALL fork a fresh backend conversation when the visible
history has been rewound, and SHALL forget/delete the stale backend conversation
so rolled-back turns are not reattached later.

#### Scenario: Follow-up turn

- **GIVEN** a user has sent a first message and the backend returned a
  conversation id
- **WHEN** the user sends the next message in the same visible chat
- **THEN** the extension sends only the incremental user turn to the existing
  backend conversation
- **AND** it does not re-send the full visible transcript or the transport
  directive

#### Scenario: Restored checkpoint

- **GIVEN** a visible chat has been restored to an earlier checkpoint
- **WHEN** the user asks a different follow-up
- **THEN** the extension starts a fresh backend conversation with a stateless
  visible transcript
- **AND** the old backend conversation is forgotten so hidden rolled-back turns
  cannot leak into the new branch

### Requirement: Honor conversation type and custom instructions

The system SHALL send the configured conversation type
(`rewst-buddy.ai.conversationType`, `HELP_DOCS` or `WORKFLOW_DIAGNOSIS`) with each
message, and SHALL prepend `rewst-buddy.ai.customInstructions` to every message
when set. Custom instructions SHALL NOT be able to override Rewst's own system
prompt.

#### Scenario: Workflow diagnosis mode

- **GIVEN** `ai.conversationType` is `WORKFLOW_DIAGNOSIS`
- **WHEN** the user sends a message
- **THEN** the backend conversation is started in workflow-diagnosis mode

#### Scenario: Standing instructions

- **GIVEN** `ai.customInstructions` is set
- **WHEN** any message is sent
- **THEN** those instructions are prepended to the user's message

### Requirement: Control activity visibility

The system SHALL show the assistant's live activity (searches, tool calls) when
`rewst-buddy.ai.showActivity` is on, and otherwise suppress those intermediate
activity lines. This setting SHALL NOT disable answer streaming itself; answer
text may still appear incrementally as the backend produces it.

#### Scenario: Activity hidden

- **GIVEN** `ai.showActivity` is false
- **WHEN** the assistant runs tools mid-response
- **THEN** intermediate activity is not surfaced
- **AND** answer text may still stream normally

### Requirement: Run in-process Buddy tools with a per-response cap

The system SHALL let the assistant request local "Buddy" tools via fenced
`vscode-tool` JSON blocks that the extension intercepts and routes through the
capability registry, and SHALL cap the number of Buddy tool rounds per
response at `rewst-buddy.ai.maxBuddyToolRounds` (1–100, default 8).
Cage-Free Rewsty SHALL have its contributed Buddy tools available in-process
whenever the model is used, regardless of `rewst-buddy.mcp.enable`; that setting
controls the external `/mcp` bridge, not the chat model's local tool
contribution. The in-process path SHALL still honor the capability registry's
write-tool, dangerous-GraphQL, working-scope, approval, throttle, and
per-capability gates. Each in-process Buddy tool call that mutates Rewst data
SHALL be confirmed through the same custom approval modal and session-scoped
mutation-scope reuse cache that mcp-bridge's external MCP transport uses (see
mcp-bridge's `Reuse approvals only for reusable mutation scopes` requirement) —
Buddy tools never surface as native `vscode.lm` tool calls, so VS Code's own
per-tool confirmation/auto-approve UI does not apply to this path. Approving a
mutation scope from chat also satisfies it for the external MCP transport
within the same extension session, and vice versa.

#### Scenario: Assistant requests a tool

- **GIVEN** an in-progress assistant response
- **WHEN** the assistant emits a `vscode-tool` block
- **THEN** the extension parses it, runs the named Buddy tool in-process, and
  feeds the result back as the next turn

#### Scenario: External MCP disabled

- **GIVEN** `rewst-buddy.mcp.enable` is false
- **AND** the user is chatting with the Cage-Free Rewsty model
- **WHEN** the model is prepared for a turn
- **THEN** read-tier Buddy tools are still advertised through the local
  `vscode-tool` protocol
- **AND** write-tier and dangerous tools follow their own explicit toggles rather
  than the external MCP bridge toggle

#### Scenario: Round cap reached

- **GIVEN** an assistant response that keeps requesting tools
- **WHEN** the number of Buddy tool rounds reaches the configured cap
- **THEN** further tool rounds are stopped for that response

### Requirement: Parse the local tool protocol defensively

The system SHALL only treat line-start fenced `vscode-tool` JSON blocks as local
tool requests. It SHALL accept a single request object, an array of request
objects, and the shorthand shape where tool arguments live at the top level. It
SHALL ignore malformed blocks, non-line-start fences, and prose wrappers, and
SHALL cap the number of parsed requests from one assistant reply.

#### Scenario: Multiple local tool requests

- **GIVEN** an assistant reply with a `vscode-tool` block containing an array of
  valid requests
- **WHEN** the reply is parsed
- **THEN** each request is routed in order up to the per-reply request cap

#### Scenario: Invalid protocol text

- **GIVEN** an assistant reply with malformed JSON or an inline non-line-start
  `vscode-tool` fence
- **WHEN** the reply is parsed
- **THEN** no local tool request is emitted from that text

#### Scenario: Mixed Buddy and VS Code tools

- **GIVEN** a parsed reply requests both in-process Buddy tools and VS Code native
  editor tools
- **WHEN** Buddy tools are available
- **THEN** Buddy requests run through the in-process path first
- **AND** native VS Code tool calls are deferred or surfaced only when they are
  the remaining available route

### Requirement: Redirect backend-native Rewst tool attempts

When local Buddy tools are available, including when the external MCP bridge is
disabled, the system SHALL prevent backend-native Rewst tool activity from being
rendered as the final path. It SHALL interrupt the native attempt, send a neutral
correction that names the local `vscode-tool` transport, carry through any
resolved native tool arguments, and suppress abandoned native output.

#### Scenario: Backend tries a native Rewst tool

- **GIVEN** Buddy tools are advertised locally
- **WHEN** the backend emits activity for a native Rewst tool
- **THEN** the extension sends a correction turn in the same backend conversation
  explaining the local fenced protocol
- **AND** the abandoned native tool card and output are not shown to the user

#### Scenario: External MCP disabled but Buddy tools available

- **GIVEN** `rewst-buddy.mcp.enable` is false
- **AND** Cage-Free Rewsty has local Buddy tools available
- **WHEN** the backend emits native Rewst tool activity
- **THEN** the extension redirects that native attempt to the local `vscode-tool`
  transport

#### Scenario: Buddy tools disabled

- **GIVEN** no Buddy tools are available locally
- **WHEN** the backend emits native Rewst tool activity
- **THEN** that native activity is allowed to stream normally

### Requirement: Surface sources and context usage

The system SHALL append backend-provided sources to final answers and SHALL track
backend context-window usage so the status bar can show the current org's usage
percentage and token counts.

#### Scenario: Sources returned

- **GIVEN** the backend completes an answer with source references
- **WHEN** the answer is rendered
- **THEN** the visible response includes the source list after the answer

#### Scenario: Context usage returned

- **GIVEN** the backend reports context usage for an org
- **WHEN** the event is processed
- **THEN** the current context usage state is updated
- **AND** the context usage status bar shows the rounded percentage and token
  breakdown

### Requirement: Open the assistant quickly

The system SHALL provide a `Rewst Buddy: Ask Rewst AI` command (bound to
Ctrl+Alt+R / Cmd+Alt+R) that opens the chat view, and a command to resume a
prior conversation.

#### Scenario: Ask Rewst AI

- **WHEN** the user presses Ctrl+Alt+R
- **THEN** the chat view opens ready for a message

#### Scenario: Resume a conversation

- **GIVEN** prior conversations exist for the org
- **WHEN** the user runs `Rewst Buddy: Resume Rewst AI Conversation`
- **THEN** recent conversations are listed and the chosen one's transcript opens
  as a markdown document

### Requirement: Apply suggested edits behind a diff preview

The system SHALL apply an assistant-suggested code change only after showing a
diff and an explicit confirmation, and SHALL NOT auto-save the result (leaving
save — and any resulting sync — to the user).

#### Scenario: User applies a suggestion

- **GIVEN** an assistant answer containing a code block and an active file
- **WHEN** the user runs `Rewst Buddy: Apply Rewst AI Suggestion`
- **THEN** a diff of the proposed change is shown, and on confirmation the edit is
  applied to the file without saving it

#### Scenario: Multiple code blocks

- **GIVEN** an assistant answer with several code blocks
- **WHEN** the user applies a suggestion
- **THEN** the user is prompted to choose which block to apply
