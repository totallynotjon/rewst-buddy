# Rewst AI Assistant (RoboRewsty) — API Reference

Developer documentation for integrating Rewst's AI assistant into rewst-buddy.
Everything here was **verified live** on 2026-06-10 against the North America region
using `scripts/probe-ai.mjs`. Nothing below is speculative unless marked.

## TL;DR — minimum requirements for a successful call

| Requirement                  | Value                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| Transport                    | WebSocket (GraphQL subscription)                              |
| WS endpoint                  | `wss://api.rewst.io/subscriptions` (**not** `/graphql`)       |
| Subprotocol                  | `graphql-transport-ws` (modern `graphql-ws` library protocol) |
| Auth                         | `cookie: appSession=<token>` header on the WS upgrade request |
| Operation                    | `subscription conversationMessage(...)`                       |
| Critical variable            | `metadata` **must include** `{ "orgId": "<org id>" }`         |
| HTTP endpoint (history/CRUD) | `https://api.rewst.io/graphql`, same cookie                   |

Failure mode to know: if `metadata.orgId` is missing, the server replies with a single
`request_registered` event and then **silently never processes the request** — no error,
no further events. This cost us a debugging round; don't repeat it.

## Endpoint discovery

The WS endpoint is not guessable from the schema. It comes from the web app's runtime
config at `https://app.rewst.io/__ENV.js`:

```
NEXT_PUBLIC_API_URI    = https://api.rewst.io/graphql
NEXT_PUBLIC_API_WS_URI = wss://api.rewst.io/subscriptions
```

For multi-region support, fetch `__ENV.js` from the region's app host (or add a
`wsUrl` field to `RegionConfig` defaulting to the graphql URL with `/graphql` →
`/subscriptions`). A WS upgrade attempt against `/graphql` returns HTTP 400 — the
upgrade falls through to Apollo Server's HTTP handler (Apollo Server 4 + Express;
its CSRF guard generates the 400 body).

## Authentication

Identical to the rest of the extension: the `appSession` cookie.

- HTTP requests: `cookie: appSession=<token>` header (what `Session`/`GraphQLClient` already do).
- WS: pass the same cookie header on the **upgrade request**. With the `ws` package:

```js
class CookieWebSocket extends WebSocket {
	constructor(url, protocols) {
		super(url, protocols, { headers: { cookie } });
	}
}
const client = createClient({ url: WS_URL, webSocketImpl: CookieWebSocket });
```

`connectionParams` are accepted but the cookie header alone is sufficient (verified).

## The subscription

This is the only way to talk to the AI. There is no mutation that triggers a reply
(`createConversationMessage` just writes a message record; verified that no assistant
reply ever appears from the HTTP-only flow).

```graphql
subscription ConversationMessageSubscription(
	$orgId: ID!
	$message: String!
	$conversationId: ID
	$conversationType: String
	$metadata: JSON
	$resumeRequestId: ID
) {
	conversationMessage(
		orgId: $orgId
		message: $message
		conversationId: $conversationId
		conversationType: $conversationType
		metadata: $metadata
		resumeRequestId: $resumeRequestId
	) {
		status
		conversation_id
		message {
			id
			content
			role
			metadata
			createdAt
		}
		metadata
		error
	}
}
```

(This is character-for-character what the web app sends; extracted from its bundle.)

### Variables

| Variable           | Notes                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orgId`            | Required. The org the user is operating in.                                                                                                                                                                                     |
| `message`          | Required. The user's chat message.                                                                                                                                                                                              |
| `conversationId`   | `null` → server creates a new conversation and auto-titles it. Pass an existing id for multi-turn (verified working).                                                                                                           |
| `conversationType` | A `String`, not the `ConversationType` enum. Web app sends `"HELP_DOCS"` (default) or `"WORKFLOW_DIAGNOSIS"`. Schema enum also lists `WORKFLOW_AUTO_DOCUMENTATION`.                                                             |
| `metadata`         | **Must contain `{ orgId }`.** The web app sends `{ ...pageContext, orgId }`. Route/workflow context can be added here to unlock context-aware behavior (e.g. workflow editing tools only activate in Workflow Builder context). |
| `resumeRequestId`  | `null` for new requests. To reattach after a dropped connection, pass the `requestId` from the `request_registered` event (see resume statuses below).                                                                          |

### Status event state machine

One subscription produces a stream of events. `status` values observed live, in order:

```
request_registered        metadata: { requestId }            ← save requestId for resume
thinking                  conversation_id now populated      ← save conversation_id for multi-turn
summarizing               metadata: { agentName: "roborewsty_supervisor" }
summarization_complete
context_usage             metadata: { totalTokens, maxTokens, percent, agentName }
streaming_response        metadata: { partialContent, agentName }   ← repeated; text chunks
searching                 metadata: { queries: [...] }
TOOL_CALL_IN_PROGRESS     metadata: { toolCalls: [{ name, args, id, type }], ... }
search_complete
TOOL_CALL_COMPLETE
TOOL_SPECIFIC_EVENT
complete                  message: { id, content, role: ASSISTANT, createdAt },
                          metadata: { sources: [{ label, source, section }], baseMessageId }
```

`complete` is the terminal success event; the server then closes the subscription
normally (close code 1000). Full answer text is in `message.content`; documentation
citations in `metadata.sources`.

Additional statuses handled by the web app (not all observed live, extracted from
its bundle — treat as the complete set):

```
message, success, error, interrupted, conversation_killed, approval_required,
streaming_thinking, resume_attached, resume_not_found, resume_forbidden
```

- `error` → check the `error` field on the payload.
- `resume_attached` / `resume_not_found` / `resume_forbidden` → responses to a
  `resumeRequestId` reconnect attempt.
- `conversation_killed` → another client called the `KillConversation` mutation.

### Timing observed

End-to-end (question → `complete`) took roughly 20–40 s for a docs question; the
assistant runs a doc-search tool loop (`gitbook_retriever`) mid-stream. UI must
render progress from the status events — do not block on `complete`.

## HTTP operations (history & management)

These work over the existing `graphql-request` client at `https://api.rewst.io/graphql`
with the same cookie. All verified except where noted.

```graphql
# List conversations (the web app's "GetConversationsVirtualized" — operation
# names are client-side labels; the schema field is just `conversations`)
query getConversations($where: ConversationWhereInput, $limit: Int, $offset: Int, $order: [[String!]]) {
	conversations(where: $where, limit: $limit, offset: $offset, order: $order) {
		id title type metadata createdAt updatedAt orgId userId
		firstUserMessage { content role createdAt }
	}
}

# Fetch one conversation with messages (messages also accepts (limit, offset))
query getConversation($id: ID!) {
	conversation(id: $id) {
		id title type metadata createdAt updatedAt orgId userId
		messages { id content role metadata createdAt updatedAt userId conversationId }
	}
}

mutation deleteConversation($id: ID!) {
	deleteConversation(id: $id)
}

# Thumbs up/down on an assistant message
mutation createConversationMessageVote($vote: ConversationMessageVoteInput!) {
	createConversationMessageVote(vote: $vote) { id vote reason comment conversationMessageId }
}

# Exists in the web app; not yet tested live
mutation KillConversation($id: ID!) { ... }
```

Notes:

- `conversation(id:)` takes a bare `id`, not a `where` input.
- `conversations(where: { orgId, userId, type })` — conversations are per-user;
  other users' conversations don't appear.
- `activeConversationRequests` / `activeConversationRequest` return `Not Authorized`
  (`AUTH_ERR`) for normal users — superuser-only. Use `resumeRequestId` on the
  subscription instead for reconnect.
- `conversation.metadata.rehydratedConversation.internalMessages` exposes the raw
  agent transcript **including the full system prompt** — useful for understanding
  capabilities (Jinja render/test tools, workflow-builder tools, gitbook doc
  retriever), and for knowing the assistant is context-gated: workflow editing
  tools only exist when the request metadata carries Workflow Builder route context.

## Implementation requirements for the extension

1. **Dependencies**: declare `graphql-ws` and `ws` in `devDependencies`
   (consistent with `graphql-request` — webpack bundles everything except `vscode`,
   so devDependencies is correct; both were already importable as transitive deps).
   Add `bufferutil` and `utf-8-validate` to webpack `externals` — `ws` optionally
   requires these native addons in a try/catch and webpack must leave them unresolved.
2. **Region config**: extend `RegionConfig` with the subscriptions URL
   (NA default `wss://api.rewst.io/subscriptions`).
3. **Client**: a `ConversationClient` beside `Session` wrapping
   `graphql-ws.createClient` with the cookie-injecting `webSocketImpl` (above).
   `client.iterate()` gives an async iterator over the events; map the status
   machine into typed events for the UI.
4. **Codegen**: put the HTTP operations in
   `src/sessions/graphql/conversationOps.graphql` and run `npm run codegen`.
   The subscription can also live there for types, but
   `typescript-graphql-request` does not generate a usable subscription client —
   the WS path stays hand-rolled.
5. **Reconnect**: on WS drop while generating, resubscribe with
   `resumeRequestId` = saved `requestId` and expect `resume_attached`.

## Probe script

`scripts/probe-ai.mjs` — standalone exploration/regression tool, no extension code.

```
REWST_TEST_TOKEN=<appSession token> node scripts/probe-ai.mjs <command>

whoami                       validate token; prints user + org
list                         list conversations for the org
show <conversationId>        full conversation incl. internal metadata
ws-chat "<msg>" [convId]     full AI round-trip over the subscription
ws-legacy "<msg>" [convId]   legacy subprotocol fallback (not needed; NA speaks graphql-transport-ws)
http-chat "<msg>"            proves the HTTP-only flow does NOT trigger the AI
active                       activeConversationRequests (expect AUTH_ERR for normal users)
cleanup                      deletes only conversations this probe created (title prefix "[rewst-buddy probe]")
```

Env overrides: `REWST_GRAPHQL_URL`, `REWST_WS_URL`.

## Verified transcript (abridged)

Question: _"What is a Rewst workflow? Reply in one sentence."_ → 24 events →

> "A Rewst workflow is a series of automated actions — made up of actions and
> triggers — that gather data from integrated tools, process it using conditional
> logic, and execute automated steps to accomplish a specific business process."

with `metadata.sources` citing `docs.rewst.help` pages. Follow-up in the same
conversation ("What did I just ask you?") answered correctly, confirming
server-side conversation memory.
