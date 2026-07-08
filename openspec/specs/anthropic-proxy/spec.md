# Anthropic Proxy Specification

## Purpose

Local tools that speak the Anthropic Messages API (such as Claude Code pointed at a custom
base URL) can use the Rewst AI assistant as their model. The extension serves a localhost
Anthropic-compatible endpoint that relays requests over the existing Rewst AI conversation
transport, emulating client tool calling through the same fenced-block text protocol the chat
uses.

Source: `src/server/anthropic/` (`anthropicProxy.ts`, `wire.ts`, `sse.ts`), `src/server/Server.ts`.

## Requirements

### Requirement: Gate the proxy behind a setting, loopback, and the local token

The system SHALL serve `POST /v1/messages` and `POST /v1/messages/count_tokens` on the local
server only when `rewst-buddy.ai.anthropicProxy` is enabled, the request is local (loopback
remote address and Host), and the request presents the extension's local token in the
`Authorization: Bearer` or `x-api-key` header. Rejections SHALL use Anthropic-style error
bodies and SHALL occur before the request body is processed.

#### Scenario: Disabled

- **GIVEN** `rewst-buddy.ai.anthropicProxy` is off
- **WHEN** a request arrives at `POST /v1/messages`
- **THEN** the server responds 403 with `{type:'error', error:{type:'permission_error', …}}`

#### Scenario: Bad token

- **GIVEN** the proxy is enabled but the request presents an invalid or missing token
- **WHEN** the request arrives
- **THEN** the server responds 401 with `error.type === 'authentication_error'`

#### Scenario: Non-local request

- **GIVEN** the request originates from a non-loopback host or remote address
- **WHEN** the request arrives
- **THEN** the server rejects it before reading the body

#### Scenario: Enabled and authenticated

- **GIVEN** the proxy is enabled and the request presents the correct local token from a loopback address
- **WHEN** a valid `POST /v1/messages` request arrives
- **THEN** the server processes it and returns an Anthropic-format response

### Requirement: Keep the local server running for the proxy

The system SHALL treat the enabled proxy as a driver that keeps the local server running, even
when the browser-action server and MCP server are disabled.

#### Scenario: Kept alive by the Anthropic proxy

- **GIVEN** `rewst-buddy.server.enabled` and `rewst-buddy.mcp.enable` are off but
  `rewst-buddy.ai.anthropicProxy` is on
- **WHEN** the extension runs
- **THEN** the server stays up to serve the proxy

### Requirement: Translate Anthropic requests into one assistant turn

The system SHALL serialize the request's system prompt, message history (including tool calls
and tool results), and tool definitions into a single message and send it as a Rewst AI
conversation turn. Client tools SHALL be advertised through the same fenced-block text protocol
the chat surface uses.

#### Scenario: System and messages serialized in order

- **GIVEN** a request with a system prompt and multiple messages
- **WHEN** the backend message is built
- **THEN** the system prompt appears first, followed by messages in order, wrapped in `<conversation_transcript>`

#### Scenario: Tool result paired with its tool_use name

- **GIVEN** a request where an assistant message contains a `tool_use` block and a subsequent user message contains a `tool_result` block referencing it
- **WHEN** the request is parsed
- **THEN** the tool result part names the tool by its original name, not a generic fallback

#### Scenario: Oversized history truncated oldest-first with an omission note

- **GIVEN** a request whose serialized transcript exceeds the total character cap
- **WHEN** the backend message is built
- **THEN** the oldest non-system entries are dropped and a `(N earlier message(s) omitted)` note is prepended

### Requirement: Reuse a warm backend conversation on pure-append requests

The system SHALL remember the backend conversation each successful response used, keyed by the
transcript the next request is expected to carry. When a request is a pure append of a
remembered transcript — the prior history unchanged, with only new trailing user turns — the
system SHALL send only those new turns (plus the tool advertisement) to the warm conversation
instead of re-sending the full transcript. When no remembered conversation matches, the system
SHALL fall back to a fresh stateless conversation carrying the full transcript. When a reused
conversation fails before any output reaches the client, the system SHALL forget it and retry
that request statelessly exactly once.

#### Scenario: Pure-append follow-up reuses warm

- **GIVEN** a first request that completed with a known backend conversation id
- **WHEN** a second request arrives whose history is the first request's history plus the assistant reply plus new user turns
- **THEN** the second request sends only the new tail to the warm conversation

#### Scenario: Edited history goes stateless

- **GIVEN** a first request that completed with a known backend conversation id
- **WHEN** a second request arrives with a modified earlier message
- **THEN** the second request falls back to a fresh stateless conversation with the full transcript

#### Scenario: Failed reuse downgrades to stateless retry

- **GIVEN** a warm conversation id is cached
- **WHEN** the reuse attempt errors before any output reaches the client
- **THEN** the system forgets the failed conversation, deletes it in the background, and retries statelessly exactly once

#### Scenario: Superseded or evicted backend conversation is deleted in the background

- **GIVEN** the LRU cache evicts a conversation id
- **WHEN** the eviction occurs
- **THEN** the system fires a background delete for the evicted id without blocking the HTTP response

### Requirement: Translate replies into Anthropic responses

The system SHALL return the assistant's reply as Anthropic content blocks: fenced tool
requests naming an advertised tool become `tool_use` blocks with `stop_reason` `tool_use`;
remaining prose becomes a `text` block with `stop_reason` `end_turn`. The proxy SHALL NOT
execute tools. When streaming is requested the system SHALL stream Anthropic-format server-sent
events; text streams incrementally and never renders fenced tool-request JSON.

#### Scenario: Tool round-trip

- **GIVEN** a request that advertises a tool and the assistant replies with a fenced tool request for that tool
- **WHEN** the response is built
- **THEN** the response contains a `tool_use` content block and `stop_reason: 'tool_use'`

#### Scenario: Text-only response

- **GIVEN** the assistant replies with plain prose and no tool requests
- **WHEN** the response is built
- **THEN** the response contains a `text` content block and `stop_reason: 'end_turn'`

#### Scenario: Streamed fence withheld

- **GIVEN** a streaming request and the assistant reply contains a fenced tool request
- **WHEN** chunks are streamed
- **THEN** no `content_block_delta` event contains the fence marker or its JSON

#### Scenario: Backend error surfaces as an Anthropic error

- **GIVEN** the backend returns an error event
- **WHEN** headers have not yet been sent
- **THEN** the server responds with a 500 Anthropic error body
- **WHEN** headers have already been sent (mid-stream)
- **THEN** the server emits an SSE `error` event and ends the stream

#### Scenario: Rewst-side approval pause is reported as an error

- **GIVEN** the backend emits an `approval` event
- **WHEN** the proxy receives it
- **THEN** the proxy responds with a 500 error explaining that approval cannot be granted, rather than hanging

### Requirement: Estimate token counts

The system SHALL answer `count_tokens` with a deterministic estimate derived from the
serialized message, without contacting the assistant.

#### Scenario: Count tokens

- **GIVEN** a valid `POST /v1/messages/count_tokens` request
- **WHEN** the proxy handles it
- **THEN** the response is `{input_tokens: <positive integer>}` and no ask call is made
