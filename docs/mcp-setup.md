# MCP setup guide

Connect your AI assistant to Rewst to find workflows, inspect executions, read templates, explore the GraphQL schema, and optionally make changes controlled by organization scope and approval settings. Rewst Buddy runs locally as an MCP server and uses your Rewst session permissions.

**VS Code is optional.** The companion Chrome extension transfers your browser session to the server. The VS Code extension adds template editing, sync-on-save, Jinja tooling, and approval dialogs.

This is an unofficial community project, unaffiliated with or supported by Rewst LLC. For help, use [GitHub Issues](https://github.com/totallynotjon/rewst-buddy/issues).

[← Documentation](README.md) · [Browser walkthrough](browser-extension.md) · [Things to try](using-mcp.md)

## Choose your setup

| Environment                                                                    | Setup                                                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Codex, Claude Code, Cursor, or another local MCP client                        | Let the client launch the server over **stdio**. Start with the quick start below. |
| Several local clients, or a server that stays running when an assistant closes | Start a **persistent HTTP server** and connect clients to it.                      |
| VS Code with Rewst Buddy                                                       | Use the extension's server, or attach the extension to a standalone server.        |
| WSL, SSH, containers, or cloud clients                                         | Read the environment notes below; the server's HTTP endpoint is local-only.        |

- [Quick start](#quick-start)
- [Client configuration](#client-configuration)
- [Chrome extension and Rewst login](#chrome-extension-and-rewst-login)
- [Using the tools](#using-the-tools)
- [Enabling writes](#enabling-writes)
- [Persistent HTTP server](#persistent-http-server)
- [VS Code companion](#vs-code-companion)
- [Operating systems and remote environments](#operating-systems-and-remote-environments)
- [Troubleshooting](#troubleshooting)

## Quick start

You need **Node.js 22 or newer**, access to Rewst, and an MCP client that supports stdio or Streamable HTTP.

1. Add Rewst Buddy to your client using one of the configurations below. The launch command is:

    ```sh
    npx --yes rewst-buddy-mcp@latest
    ```

2. Start or enable the server in your client's MCP settings. With stdio, the client launches the process for you; you do not need a separate terminal server.
3. Install the [Chrome companion](#chrome-extension-and-rewst-login), sign in to Rewst, and reload an organization page to transfer your session.
4. Ask your assistant: **“Use Rewst Buddy to list my organizations and show the current working scope.”**

The server starts with read tools enabled and write tools disabled. It can list tools before login, but requests for Rewst data need an active session. If you do not use the browser extension, supply a session through the environment or encrypted login as described below.

Examples use `@latest` so new setups follow the current published release. If you need reproducible startup, replace `@latest` with an exact version deliberately. Restart the server to pick up a new release; an already-running owner keeps its current version.

## Client configuration

Choose one configuration for your client. Merge it into any existing configuration rather than replacing other servers. Restart or reconnect the server after editing its configuration.

### Codex

Register the server from a terminal:

```sh
codex mcp add rewst-buddy -- npx --yes rewst-buddy-mcp@latest
codex mcp list
```

Or add this entry to `~/.codex/config.toml`:

```toml
[mcp_servers.rewst-buddy]
command = "npx"
args = ["--yes", "rewst-buddy-mcp@latest"]
```

Use `/mcp` in the CLI to inspect the connection. See the [official OpenAI MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) for configuration locations and desktop/IDE setup. This configures a local server; it does not expose the server to a cloud client.

### Claude Code

Register it for your user account, across projects:

```sh
claude mcp add --transport stdio --scope user rewst-buddy -- npx --yes rewst-buddy-mcp@latest
claude mcp list
```

Use `/mcp` in Claude Code to check its status. See [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp) for project scope and environment settings.

### Cursor

Add this to `~/.cursor/mcp.json` for all projects, or `.cursor/mcp.json` for one project:

```json
{
	"mcpServers": {
		"rewst-buddy": {
			"type": "stdio",
			"command": "npx",
			"args": ["--yes", "rewst-buddy-mcp@latest"]
		}
	}
}
```

Enable the server in Cursor's MCP settings. See [Cursor's MCP documentation](https://cursor.com/docs/mcp).

### VS Code / GitHub Copilot

To launch the standalone server from VS Code, add `.vscode/mcp.json` to your workspace:

```json
{
	"servers": {
		"rewst-buddy": {
			"type": "stdio",
			"command": "npx",
			"args": ["--yes", "rewst-buddy-mcp@latest"]
		}
	}
}
```

Start the server from that file or **MCP: List Servers**, then enable its tools in chat. This works without the Rewst Buddy VS Code extension. If the extension already provides a Rewst Buddy MCP entry, use that entry instead of adding a duplicate. See [VS Code's MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

### Other local MCP clients

Choose **stdio**, set the command to `npx`, and supply these as separate arguments:

```json
["--yes", "rewst-buddy-mcp@latest"]
```

Clients using an `mcpServers` JSON object can use the Cursor example as a starting point; check the client's accepted fields. Session handoff works independently of which MCP client launches the server.

## Chrome extension and Rewst login

### Transfer your session from Chrome or Edge

Follow the [illustrated browser walkthrough](browser-extension.md) for screenshots of the download and folder selection.

1. Clone or download the [Rewst Buddy browser extension](https://github.com/totallynotjon/rewst-buddy-browser). It is installed by loading the unpacked extension.
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Enable **Developer mode**, choose **Load unpacked**, and select the repository's **`build-chrome/`** directory.
4. Start the MCP server on its default port, **27121**, using your client's setup above or HTTP mode below.
5. Sign in to Rewst and navigate to or reload a page inside an organization. The extension sends your session to `http://127.0.0.1:27121/` automatically.
6. Retry the organization-list request in your assistant to verify the login.

**Session transfer does not require VS Code.** The browser extension may still describe the destination as VS Code. Its template-opening action does require an attached VS Code window with Rewst Buddy installed.

The browser extension targets port 27121; keep that port for this workflow. For Firefox's temporary add-on installation, see the [browser extension README](https://github.com/totallynotjon/rewst-buddy-browser#installation).

### Supply a session without the browser extension

Set `REWST_SESSION_COOKIE` in the server process's environment through your client's secret or environment settings. It accepts a raw session token or a cookie string such as `appSession=...`. Obtain the session cookie from your signed-in Rewst browser session.

Keep cookies out of chat messages and checked-in configuration files. Public MCP tools cannot accept or return session cookies. Environment-variable syntax differs between clients; a terminal's environment is not necessarily inherited by a desktop application.

### Keep your login across restarts

Standalone credentials are **in memory by default**. To persist them, set `REWST_BUDDY_PASSPHRASE` in the owner's environment before starting the server, then transfer your session from Chrome. Subsequent starts must receive the same passphrase.

Alternatively, with that passphrase set, run:

```sh
npx --yes rewst-buddy-mcp@latest login --stdin
```

Supply the cookie on standard input and end the input stream. Run this before starting the server, or stop and restart the owner afterward so it loads the saved credentials.

Credentials are encrypted in `credentials.enc`; session metadata and working scope live separately in `state.json`.

| Platform | Default state directory                                        |
| -------- | -------------------------------------------------------------- |
| Linux    | `$XDG_STATE_HOME/rewst-buddy`, or `~/.local/state/rewst-buddy` |
| macOS    | `~/Library/Application Support/Rewst Buddy`                    |
| Windows  | `%LOCALAPPDATA%\Rewst Buddy`                                   |

Use `--state-dir PATH` to select another directory. An existing encrypted vault requires its original passphrase at startup.

### Rewst regions

North America (US), United Kingdom (UK), Asia (AU), and Europe (DE) are
configured by default. Their built-in endpoints and session-cookie names are:

| Region | App/login                 | GraphQL API                       | Engine                       | Subscriptions                         | Cookie         |
| ------ | ------------------------- | --------------------------------- | ---------------------------- | ------------------------------------- | -------------- |
| US     | `https://app.rewst.io`    | `https://api.rewst.io/graphql`    | `https://engine.rewst.io`    | `wss://api.rewst.io/subscriptions`    | `appSession`   |
| UK     | `https://app.eu.rewst.io` | `https://api.eu.rewst.io/graphql` | `https://engine.eu.rewst.io` | `wss://api.eu.rewst.io/subscriptions` | `euAppSession` |
| AU     | `https://app.rewst.asia`  | `https://api.rewst.asia/graphql`  | `https://engine.rewst.asia`  | `wss://api.rewst.asia/subscriptions`  | `auAppSession` |
| DE     | `https://app.rewst.eu`    | `https://api.rewst.eu/graphql`    | `https://engine.rewst.eu`    | `wss://api.rewst.eu/subscriptions`    | `deAppSession` |

Rewst's public deployment documentation verifies these regional app, API, and
engine hosts. The docs do not publish cookie names; the built-in values above
match the current regional auth endpoints and remain configurable if your
account uses a different cookie. For another region, start the owner with
`--config /absolute/path/regions.json`. The file must contain a non-empty
`regions` array with your region's `name`, `cookieName`, `graphqlUrl`, and
`loginUrl`; `subscriptionsUrl` is optional. See the [region configuration
example](../packages/mcp-server/README.md#regions).

Browser support for a Rewst domain does not change the server's configured
region list. Built-in regions are probed automatically; configure a custom
region before transferring its session.

## Using the tools

Start by confirming the organization and current scope. Then ask for a concrete task, for example:

- “Find the onboarding workflow in Acme and explain its tasks and branches.”
- “Show the latest failed executions of this workflow and inspect the failed task's output.”
- “Find templates with ‘notification’ in their name and show their contents.”
- “Show the inputs for this Rewst action.”
- “Inspect the GraphQL schema and write a read-only query for this data.”

Useful tools include `buddy_list_orgs`, `buddy_get_working_scope`, `buddy_workflow_search`, `buddy_workflow_get`, and `buddy_graphql_query`. The client lists the available tools and their input schemas. Large responses can be paged through `buddy_result_read` using the result ID returned by the original call.

`buddy_graphql_query` supports query operations and schema exploration; it rejects mutations and subscriptions. Prefer a dedicated tool when one covers the task.

Working scope is shared and persisted by the server. Inspect it with `buddy_get_working_scope`; request changes with `buddy_set_working_scope`. In the default strict mode, a pinned organization scope restricts reads too. MCP scope changes use your AI client’s tool-call permissions and do not require VS Code. Initial read-only discovery does not require a pinned scope.

## Enabling writes

Writes require an effective organization scope and the owner's write policy. To allow typed write tools without VS Code approval dialogs, stop the existing owner and launch it with:

```sh
npx --yes rewst-buddy-mcp@latest --org YOUR_ORG_ID --allow-writes
```

For a client-managed stdio server, append those flags to its `args` array instead. Replace `YOUR_ORG_ID` with an ID returned by `buddy_list_orgs`.

- `--org` sets the owner's standing organization allowlist. Repeat it or use comma-separated IDs for multiple organizations.
- `--allow-writes` exposes typed write tools.
- `--approve-writes` is accepted for compatibility but is no longer needed. Resource membership and workflow scope checks still apply.

External MCP calls use the AI client’s tool-call permissions, including working-scope and runtime write-setting changes. No Buddy approval dialog is required. Built-in VS Code actions keep their approval prompts. Runtime write settings affect every client connected to the owner until restart.

**Raw GraphQL mutations require a separate opt-in:** `--allow-graphql-mutations` alongside `--org` and `--allow-writes`. Approval belongs to the AI client. An arbitrary mutation can affect organizations outside its declared org; that argument does not sandbox the document.

For a first write, ask the assistant to inspect the target, describe the proposed change, and apply it to an explicitly named organization and resource.

## Persistent HTTP server

Use this when the server should outlive an individual client. First set **`REWST_BUDDY_MCP_TOKEN`** to a random secret in the server environment, then start:

```sh
npx --yes rewst-buddy-mcp@latest --transport http --port 27121
```

Leave the process running. Connect your client using **Streamable HTTP**:

```text
URL: http://127.0.0.1:27121/mcp
Authorization: Bearer <your REWST_BUDDY_MCP_TOKEN value>
```

For example, replace the stdio entry in Codex with:

```toml
[mcp_servers.rewst-buddy]
url = "http://127.0.0.1:27121/mcp"
bearer_token_env_var = "REWST_BUDDY_MCP_TOKEN"
```

The Codex process must receive the same token in its environment. Other HTTP clients should use their secret/header settings to supply the `Authorization` header.

These credentials serve different purposes:

| Variable                 | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `REWST_SESSION_COOKIE`   | Authenticate the server to Rewst. Chrome handoff is an alternative. |
| `REWST_BUDDY_PASSPHRASE` | Encrypt and unlock persisted Rewst credentials.                     |
| `REWST_BUDDY_MCP_TOKEN`  | Authenticate a local HTTP MCP client to the server.                 |

If no MCP token is configured, the server generates one for automatic local discovery. Explicitly setting it makes manual HTTP client configuration easier.

### Sharing a server between clients

The first compatible process on port 27121 owns sessions, refresh, scope, storage, and policy. Later stdio launches and compatible VS Code windows authenticate and reuse that owner. A stdio client can therefore use the earlier launch examples to attach to a persistent HTTP owner without manually configuring an HTTP token.

Configure owner options on the **first** process. Attaching launches must omit `--org`, write flags, `--state-dir`, `--config`, and `REWST_BUDDY_PASSPHRASE`. Restart the owner to change its policy. For a separate instance, choose another port and state directory.

Closing an attached client leaves the owner running. Closing the owner disconnects all its clients; this includes closing the client that originally launched a stdio owner.

## VS Code companion

Install [Rewst Buddy from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=JBramley.rewst-buddy) for linked template files, sync-on-save with conflict detection, Jinja completion and preview, and approval dialogs.

With a version that supports the standalone server, start the standalone owner first and then open VS Code to share its sessions and policy. When attached, the extension does not copy its previously saved cookies into the owner; use Chrome handoff or the owner's login flow.

To let **VS Code own the server**, open the extension first, keep `rewst-buddy.server.enabled` enabled, and enable `rewst-buddy.mcp.enable` for external MCP access. Connect a session in the Rewst Buddy sidebar or through Chrome. Write policy is then controlled by the extension's MCP settings, rather than flags on an attaching CLI process. VS Code stores credentials in SecretStorage when it owns the runtime.

For local editing, open a file, choose **Link File to Template**, select the organization and template, then enable sync-on-save. The browser extension's template-opening action can open a template in an attached editor.

See the [editor quick start](quickstart.md), [features](features.md), and [settings reference](reference.md) for the full editor workflow.

## Operating systems and remote environments

- **macOS and Linux:** the examples use `npx` from your PATH. If a desktop client cannot find it, configure an absolute executable path or use the local-build option below with an absolute Node.js path.
- **Windows:** install Node.js 22+ on Windows when the client runs there. If the client cannot launch `npx` directly, use `command: "cmd"` with arguments `["/c", "npx", "--yes", "rewst-buddy-mcp@latest"]`. JSON paths need escaped backslashes or forward slashes.
- **WSL, SSH, and containers:** the command runs in the client's execution environment. Install Node.js there and supply `REWST_SESSION_COOKIE` or an encrypted login there. A browser on another host or network namespace cannot be assumed to reach that environment's loopback address. Keep Chrome and the owner in the same local environment for the simplest session handoff.
- **Remote or cloud HTTP clients:** this server binds only to loopback and rejects forwarded requests, unknown Host headers, and non-loopback browser origins. It is not a public/LAN endpoint; publishing or forwarding port 27121 is not a supported remote deployment recipe.

## Troubleshooting

| Symptom                                                | What to check                                                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Server will not launch / `npx` not found               | Confirm Node.js 22+ is installed in the client's environment. Check the client's PATH or use an absolute executable path.                 |
| Tools appear, but “No Rewst sessions are active”       | Reload a signed-in Rewst organization page with Chrome handoff installed, or supply a session through the owner's environment/login flow. |
| Browser reports that the VS Code server is not running | Start the standalone server on port 27121, then reload the Rewst page. The message can refer to the shared server even without VS Code.   |
| Session is rejected                                    | Confirm you are still signed in and the owner has the matching Rewst region configured.                                                   |
| HTTP connection is unauthorized                        | Supply the owner's MCP bearer token, not the Rewst cookie or vault passphrase.                                                            |
| “An existing Rewst Buddy server owns this port”        | Remove owner-only settings from the attaching process, or stop the owner before restarting with new settings.                             |
| Discovery / identity error                             | Check which process owns port 27121. An unrelated or incompatible listener cannot be reused.                                              |
| Encrypted credentials found / vault cannot unlock      | Supply the original passphrase, or choose a fresh state directory.                                                                        |
| Write or scope request denied                          | Check owner write policy, organization/workflow scope, and your AI client’s tool permissions.                                             |
| Template-opening action fails                          | Attach a compatible Rewst Buddy VS Code window. Session transfer alone does not open an editor.                                           |

Logs go to standard error; standard output is reserved for MCP messages. Use your client's MCP logs to diagnose startup failures. Run `npx --yes rewst-buddy-mcp@latest --help` for all launch options.

## Build from source

From a checkout of this repository:

```sh
npm ci
npm run build:mcp
node packages/mcp-server/dist/cli.cjs --help
```

In your client configuration, replace `npx` with `node` and the package arguments with the **absolute path** to `packages/mcp-server/dist/cli.cjs`. Append server flags after that path. This uses your local build instead of the published package.

The [MCP package guide](../packages/mcp-server/README.md) covers storage and configuration in more detail.

## Support and license

- [Report a bug or request a feature](https://github.com/totallynotjon/rewst-buddy/issues)
- [MCP and VS Code source](https://github.com/totallynotjon/rewst-buddy)
- [Browser extension source](https://github.com/totallynotjon/rewst-buddy-browser)

MIT licensed. Rewst sessions retain your existing Rewst permissions. Data returned through MCP is also subject to the connected AI client's data-handling policy.
