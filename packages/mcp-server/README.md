# Rewst Buddy MCP

Rewst Buddy MCP is an unofficial, standalone MCP server for Rewst. It owns
Rewst sessions, token refresh, working scope, GraphQL access, and subscriptions.
It runs without VS Code; the Rewst Buddy VS Code extension adds editor UI,
linked files, and sync-on-save by connecting to the same server.

For an illustrated first run, see the [project setup guide](https://github.com/totallynotjon/rewst-buddy/blob/main/docs/mcp-setup.md) and [Chrome walkthrough](https://github.com/totallynotjon/rewst-buddy/blob/main/docs/browser-extension.md).
`buddy_template_sync` and `buddy_template_sync_status` are available only while
a VS Code editor providing those tools is attached. They are removed from the
MCP tool catalog when the last supporting editor disconnects, and calls using a
cached tool name are rejected. MCP clients receive a tool-list change notification.

## Requirements

- Node.js 22 or newer
- A Rewst session token or cookie
- An MCP client that can launch a stdio server, or one that supports Streamable
  HTTP

## Quick start with stdio

Add this command to your MCP client:

```sh
npx -y rewst-buddy-mcp@latest
```

An illustrative stdio configuration is:

```json
{
	"mcpServers": {
		"rewst-buddy": {
			"command": "npx",
			"args": ["-y", "rewst-buddy-mcp@latest"]
		}
	}
}
```

Configuration keys and secret injection differ between MCP clients. Use your
client's environment or secret settings for the variables described below. Pin
an exact package version instead of `@latest` when reproducible startup matters.

### Codex and ChatGPT desktop

Codex CLI, the Codex IDE extension, and ChatGPT desktop share the host's local
MCP configuration. Register the stdio server with:

```sh
codex mcp add rewst-buddy -- npx -y rewst-buddy-mcp@latest
```

Restart the desktop client or extension host after changing the configuration,
then use `/mcp` to inspect the server. See the
[official OpenAI MCP setup guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
This command configures the local desktop/CLI environment; it does not make a
local stdio process available to ChatGPT on the web.

The default transport is stdio. The first process also becomes the shared owner
on `127.0.0.1:27121`. A later `npx` process or VS Code window authenticates that
owner and reuses it instead of starting another Rewst runtime. Standard output
contains only MCP messages; logs go to standard error.

The server can initialize and list tools before a Rewst session is available.
Calls that need Rewst return a session error until you authenticate.

## Authenticate to Rewst

Rewst Buddy accepts either the raw session token or a cookie string such as
`appSession=...`. It validates the session against the configured Rewst region
and records all organizations that session can manage. Session cookies are not
returned in MCP tool results and cannot be submitted through the public MCP tool
surface.

Choose one of these intake methods.

### Browser extension handoff

Start the MCP server on the default port, then use the existing Rewst Buddy
browser extension while signed in to Rewst. Its `addSession` request goes to
`http://127.0.0.1:27121/`, even when VS Code is closed. The standalone server
then validates, refreshes, and owns that session.

The browser extension can add a session without VS Code. Opening a Rewst
template in an editor still requires an attached VS Code window.

### Environment session

Set `REWST_SESSION_COOKIE` in the environment of the server process. Use your
MCP client's secret settings rather than saving the cookie in a checked-in
configuration file. Validated credentials are saved securely for subsequent
launches, including cookies received from the browser extension.

### Encrypted persistent login

Pass the cookie on standard input:

```sh
npx -y rewst-buddy-mcp@latest login --stdin
```

Stop the current standalone owner before running login, then start it again.
By default, credentials are encrypted in `credentials.os.enc`; a random unlock
key is kept in macOS Keychain, Windows Credential Manager, or Linux Secret
Service. Linux requires `secret-tool` (usually the `libsecret-tools` or
`libsecret` package) and an unlocked persistent Secret Service collection, such
as GNOME Keyring. No VS Code installation is required. An OS unlock prompt may
appear when credentials are first saved or restored.

For headless environments, set `REWST_BUDDY_PASSPHRASE` using your service or MCP
client's secret settings for both login and every subsequent launch. This uses
the existing `credentials.enc` AES-256-GCM vault with a scrypt-derived key. The
passphrase is never stored by the server. Existing passphrase vaults remain
compatible. Changing storage modes requires a separate state directory and a
new login; it never silently replaces an existing vault.

Session metadata and working scope are stored separately in `state.json`.
The vault and state files are written atomically with owner-only permissions
on POSIX systems. Keep the state directory private on Windows using your user
profile's access controls. The OS key is tied to the canonical state-directory
path: moving or copying the vault alone does not transfer the login.

The server can list tools before any login without accessing the OS store.
Saving a login fails clearly if secure storage is unavailable; credentials are
never silently kept only in memory or written in plaintext. An existing vault
must unlock before session restoration starts. Valid saved sessions are
restored on restart; expired Rewst credentials still require a new login.
Failed validation (including offline startup) retains profiles for a later
restart. Removing or clearing sessions also removes their saved credentials.

Only one server or login process may write a state directory at a time, even
across different ports. Stop the owner before using `login --stdin`, or use the
browser handoff while the owner is running. After an abrupt crash, a stale
storage lock can take about ten seconds to expire before a new launch succeeds.

The default state location follows the platform:

| Platform | Default directory                                              |
| -------- | -------------------------------------------------------------- |
| Linux    | `$XDG_STATE_HOME/rewst-buddy`, or `~/.local/state/rewst-buddy` |
| macOS    | `~/Library/Application Support/Rewst Buddy`                    |
| Windows  | `%LOCALAPPDATA%\Rewst Buddy`                                   |

Use `--state-dir PATH` to override it.

## Run as a persistent HTTP server

Use HTTP when the server should live independently of any one MCP client or VS
Code window. Set a random `REWST_BUDDY_MCP_TOKEN` in both the server process and
your MCP client's secret settings, then start:

```sh
npx -y rewst-buddy-mcp@latest --transport http --port 27121
```

Connect the client to `http://127.0.0.1:27121/mcp` with this header:

```text
Authorization: Bearer <REWST_BUDDY_MCP_TOKEN>
```

An illustrative Streamable HTTP configuration is:

```json
{
	"mcpServers": {
		"rewst-buddy": {
			"url": "http://127.0.0.1:27121/mcp",
			"headers": {
				"Authorization": "Bearer ${REWST_BUDDY_MCP_TOKEN}"
			}
		}
	}
}
```

Adapt the field names and environment interpolation to your MCP client. Some
clients require the resolved header value rather than `${...}` syntax.

The MCP bearer authenticates a local client to Rewst Buddy. It is separate from
the Rewst session cookie. If no bearer is configured, the owner generates one
for trusted local discovery, which is sufficient for automatic `npx` and VS
Code reuse but is not a convenient credential for a manually configured HTTP
client.

The HTTP server binds only to loopback and rejects forwarded requests, unknown
Host headers, and non-loopback browser origins. It is not a remote or LAN
deployment endpoint.

## Working scope and writes

Read tools, including `buddy_graphql_query`, are available by default. The raw
GraphQL query tool accepts query operations, including schema exploration, and
rejects mutations and subscriptions. Dedicated tools are preferable when one
covers the task.

The server persists a working scope of organization and workflow IDs. Use
`buddy_get_working_scope` to inspect it and `buddy_set_working_scope` to request
a change. In the default strict mode, pinning an organization restricts reads
to the effective working scope. Writes always require an effective organization
scope.

For typed write tools in explicitly allowed organizations, start the owner with:

```sh
npx -y rewst-buddy-mcp@latest \
	--org YOUR_ORG_ID \
	--allow-writes
```

`--org` is repeatable and also accepts comma-separated IDs. It initializes the
owner's standing allowlist. External MCP calls delegate approval to the AI
client's tool-call permissions by default, including scope changes and enabled
writes. No attached editor or `--approve-writes` flag is needed. Buddy cannot
guarantee a client confirmation; configure permissions in your AI client.
Built-in VS Code actions retain their editor approval prompts.

You can also configure a running standalone owner without restarting it, even
when it was launched with no write flags. Call `buddy_get_write_settings` to
inspect the current policy, then `buddy_set_write_settings` with, for example:

```json
{
	"orgs": ["YOUR_ORG_ID"],
	"allowWrites": true,
	"approveWrites": false,
	"allowGraphqlMutations": false
}
```

These tools are available before signing in. Only request changes authorized by
the user. Changes affect **all clients connected to that owner** until restart;
they do not modify launch flags or VS Code settings. Omitted fields are unchanged,
and `orgs` replaces the allowlist. A settings change clears remembered approvals
and pinned working scope and invalidates pending approval requests. It cannot
undo writes already sent to Rewst. Clients receive a tool-list change notification; refresh
`tools/list` if your client does not automatically discover the newly enabled tools.

To disable all writes, set `allowWrites`, `approveWrites`, and
`allowGraphqlMutations` to `false` in one call. Enabling writes requires a nonempty
`orgs` list. Automatic approval and raw mutations also require `allowWrites`.
Invalid updates leave the current settings unchanged.

Typed tools retain their resource membership and workflow scope checks. Raw
GraphQL additionally requires `allowGraphqlMutations: true` (or the launch flag
`--allow-graphql-mutations`). Raw documents can affect organizations outside the
declared scope: the declared org is not a sandbox for arbitrary GraphQL.

`approveWrites` and `--approve-writes` remain accepted for compatibility but do
not control approval routing. MCP clients handle their own permissions; built-in
VS Code actions use host approval regardless of this legacy setting. Scope
changes still validate organization and workflow membership before applying.
The MCP server does not expose arbitrary shell-command execution.

## Sharing with VS Code

The default port is 27121 for the standalone package, the VS Code extension,
and the browser extension. The first compatible process to claim the port owns
session storage, refresh, scope, write policy, and the listener. Other launches
verify a private discovery record and cryptographic challenge before attaching.
An unrelated or incompatible listener produces an error; cookies are never sent
merely because the port is open.

When VS Code owns the runtime, it uses VS Code SecretStorage and existing profile
keys. When VS Code attaches to a standalone owner, it uses the owner's sessions,
scope, and policy. It does not copy its own saved cookies into that process.
Editor tools use the attached window's workspace.

An attaching process cannot replace owner settings. Omit `--org`, write flags,
`--state-dir`, `--config`, and `REWST_BUDDY_PASSPHRASE` when reusing an owner.
Stop the owner or choose a different port and state directory to run with a
different policy. Closing an attached client leaves the owner running; closing
the owner disconnects its clients.

The private discovery record contains local MCP credentials, never Rewst
cookies. The public `/mcp` endpoint and private `/editor` endpoint use different
bearers. `--discovery-dir PATH` overrides discovery only for testing or isolated
instances; processes that should share an owner must use the same discovery
directory.

## Regions

North America (US), United Kingdom (UK), Asia (AU), and Europe (DE) are built
in. The built-in regional endpoints are:

| Region | App/login                 | GraphQL API                       | Engine                       | Subscriptions                         | Cookie         |
| ------ | ------------------------- | --------------------------------- | ---------------------------- | ------------------------------------- | -------------- |
| US     | `https://app.rewst.io`    | `https://api.rewst.io/graphql`    | `https://engine.rewst.io`    | `wss://api.rewst.io/subscriptions`    | `appSession`   |
| UK     | `https://app.eu.rewst.io` | `https://api.eu.rewst.io/graphql` | `https://engine.eu.rewst.io` | `wss://api.eu.rewst.io/subscriptions` | `euAppSession` |
| AU     | `https://app.rewst.asia`  | `https://api.rewst.asia/graphql`  | `https://engine.rewst.asia`  | `wss://api.rewst.asia/subscriptions`  | `auAppSession` |
| DE     | `https://app.rewst.eu`    | `https://api.rewst.eu/graphql`    | `https://engine.rewst.eu`    | `wss://api.rewst.eu/subscriptions`    | `deAppSession` |

Rewst's public deployment docs verify the app, API, and engine hosts. Cookie
names are not published there; these built-in values match the current auth
endpoints and can be overridden. For other regions, pass `--config PATH` with
a JSON object containing a non-empty `regions` array:

```json
{
	"regions": [
		{
			"name": "Example",
			"cookieName": "appSession",
			"graphqlUrl": "https://api.example/graphql",
			"loginUrl": "https://app.example",
			"subscriptionsUrl": "wss://api.example/subscriptions"
		}
	]
}
```

`subscriptionsUrl` is optional and is derived from `graphqlUrl` when omitted.

## Troubleshooting

- **`No Rewst sessions are active`**: add a session through the browser
  extension, `REWST_SESSION_COOKIE`, encrypted login, or an attached VS Code
  session flow, then retry.
- **`An existing Rewst Buddy server owns this port`**: that owner already chose
  storage and policy. Remove owner-only flags to attach, stop it to restart with
  new settings, or use another `--port` with another `--state-dir`.
- **Discovery or identity error on port 27121**: another process is listening or
  the private discovery record is missing or stale. Stop the listener before
  starting Rewst Buddy; do not point it at an unrelated service.
- **Encrypted credentials found**: supply the original
  `REWST_BUDDY_PASSPHRASE`, or select a fresh state directory.
- **Secure credential storage unavailable or locked**: unlock the OS store. On
  Linux, install `secret-tool` and enable a persistent Secret Service. Headless
  hosts can use `REWST_BUDDY_PASSPHRASE` with a separate state directory.
- **Session storage is in use**: stop the owner or login process using that
  directory before retrying.
- **Write or scope request denied**: inspect `buddy_get_write_settings` and use
  `buddy_set_write_settings` to configure the authorized orgs and write policy,
  then set the intended working scope. MCP tool permissions belong to your AI client.
- **Browser handoff fails**: confirm the server is listening on the browser
  extension's configured loopback port and that you are signed in to the matching
  Rewst region.

Run `npx -y rewst-buddy-mcp@latest --help` for the complete CLI option list.

## Local development and embedding

From the repository root:

```sh
npm ci
npm run build:mcp
node packages/mcp-server/dist/cli.cjs --help
npm run test:mcp
```

The package exports runtime and host interfaces, `startRuntime`, `stopRuntime`,
and `createMcpServer`. An embedding host supplies storage, settings, logs, token
input, and approval UI. The extension connects with an in-memory transport when
it owns the runtime and the private local HTTP transport when another process
owns it. Rewst GraphQL and subscription implementations remain in this package.

Building or packing the repository does not publish the package. The packed
artifact contains compiled JavaScript and TypeScript declarations and runs
outside the source checkout without VS Code or build tools.

This project is unaffiliated with Rewst LLC.
