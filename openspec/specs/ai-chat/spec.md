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
`rewst-buddy.ai.showActivity` is on, and otherwise wait silently until the answer
is ready.

#### Scenario: Activity hidden

- **GIVEN** `ai.showActivity` is false
- **WHEN** the assistant runs tools mid-response
- **THEN** intermediate activity is not surfaced; only the final answer appears

### Requirement: Run in-process Buddy tools with a per-response cap

The system SHALL let the assistant request local "Buddy" tools via fenced
`vscode-tool` JSON blocks that the extension intercepts and routes through the
MCP capability surface, and SHALL cap the number of Buddy tool rounds per
response at `rewst-buddy.ai.maxBuddyToolRounds` (1–100, default 8).

#### Scenario: Assistant requests a tool

- **GIVEN** an in-progress assistant response
- **WHEN** the assistant emits a `vscode-tool` block
- **THEN** the extension parses it, runs the named Buddy tool in-process, and
  feeds the result back as the next turn

#### Scenario: Round cap reached

- **GIVEN** an assistant response that keeps requesting tools
- **WHEN** the number of Buddy tool rounds reaches the configured cap
- **THEN** further tool rounds are stopped for that response

### Requirement: Open the assistant quickly

The system SHALL provide an `Ask Rewst AI` command (bound to Ctrl+Alt+R /
Cmd+Alt+R) that opens the chat view, and a command to resume a prior
conversation.

#### Scenario: Ask Rewst AI

- **WHEN** the user presses Ctrl+Alt+R
- **THEN** the chat view opens ready for a message

#### Scenario: Resume a conversation

- **GIVEN** prior conversations exist for the org
- **WHEN** the user runs `Resume Rewst AI Conversation`
- **THEN** recent conversations are listed and the chosen one's transcript opens
  as a markdown document

### Requirement: Apply suggested edits behind a diff preview

The system SHALL apply an assistant-suggested code change only after showing a
diff and an explicit confirmation, and SHALL NOT auto-save the result (leaving
save — and any resulting sync — to the user).

#### Scenario: User applies a suggestion

- **GIVEN** an assistant answer containing a code block and an active file
- **WHEN** the user runs `Apply Rewst AI Suggestion`
- **THEN** a diff of the proposed change is shown, and on confirmation the edit is
  applied to the file without saving it

#### Scenario: Multiple code blocks

- **GIVEN** an assistant answer with several code blocks
- **WHEN** the user applies a suggestion
- **THEN** the user is prompted to choose which block to apply
