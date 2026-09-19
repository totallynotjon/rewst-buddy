# Rewst Buddy

**Understand your workflows. Investigate failures. Work from your AI assistant.**

Connect **Codex, Claude Code, Cursor, VS Code, or another local MCP client** to Rewst. Find the workflow you need, follow a failed run through its task outputs, and read the templates behind it—all using your existing Rewst session and permissions.

Rewst Buddy is an **unofficial community project**, unaffiliated with or supported by Rewst LLC.

**[Connect your assistant →](docs/mcp-setup.md)** · **[Try an investigation](docs/using-mcp.md)**

**Here for the VS Code extension?** [Start with the editor quick start →](docs/quickstart.md) to link templates, edit locally, and sync changes back to Rewst. The extension can run the server itself; a separate standalone installation is optional.

## Start with the question you need answered

> Why did Employee Onboarding fail in Acme? Find the latest failed run, inspect the failed task's input and output, and explain the evidence. Propose a fix without changing anything.

Rewst Buddy gives your assistant tools to follow that question from workflow to execution to task output. Instead of supplying the workflow contents yourself, you can ask it to retrieve the relevant data and explain what it finds.

For example, an investigation might uncover:

| Evidence retrieved                                                             | What the assistant can explain                                                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| The workflow graph and failed execution                                        | Which task failed and where it sits in the onboarding process.                                  |
| A task input with an empty email field and an output reporting a missing email | The immediate failure is a missing input; the output alone does not establish why it was empty. |
| The expression that supplies that field                                        | What to inspect next and which change to propose for review.                                    |

_Illustrative scenario, not a captured run. Acme and Employee Onboarding are example names; actual findings depend on your workflow and execution data._

**[Walk through the investigation →](docs/using-mcp.md)**

You can also ask:

- **Understand a workflow:** “Find the onboarding workflow in Acme and explain its tasks, branches, and integrations.”
- **Find reusable code:** “Find notification templates in Acme and show their contents.”
- **Explore the API:** “Inspect the GraphQL schema and build a read-only query for this data.”

## Connect in three steps

### 1 · Add Rewst Buddy to your assistant

Install **Node.js 22+**, then configure your MCP client to launch:

```sh
npx -y rewst-buddy-mcp@latest
```

For example, with **Codex**:

```sh
codex mcp add rewst-buddy -- npx -y rewst-buddy-mcp@latest
```

Your client starts the server for you. Copy the setup for [Codex](docs/mcp-setup.md#codex), [Claude Code](docs/mcp-setup.md#claude-code), [Cursor](docs/mcp-setup.md#cursor), [VS Code / GitHub Copilot](docs/mcp-setup.md#vs-code--github-copilot), or [another local client](docs/mcp-setup.md#other-local-mcp-clients).

### 2 · Connect your Rewst session

Install the [Chrome companion](docs/browser-extension.md), start the server in your assistant, then reload a signed-in Rewst organization page. The companion transfers your session to the local server. **VS Code is optional for this setup.**

The companion requires loading an unpacked extension; the [illustrated walkthrough](docs/browser-extension.md) shows each step. For another Rewst region or an environment without a local browser, see [session options](docs/mcp-setup.md#chrome-extension-and-rewst-login).

### 3 · Verify the connection, then investigate

Ask: **“Use Rewst Buddy to list my organizations and show the current working scope.”** An organization list confirms that the server can access Rewst. Then try the investigation above with your own organization and workflow names.

## How it connects

![Connection diagram: AI clients connect to a local Rewst Buddy server; Chrome supplies the Rewst session, and optional VS Code adds editing and approvals.](docs/images/how-it-connects.png)

Your assistant uses MCP to call Rewst Buddy's tools. The local server connects to Rewst using your session. Data returned to your assistant is subject to that client's data-handling policy.

## Read first. Choose when to enable changes

The default setup enables read tools and disables writes. You can investigate a failure and review a proposed fix before enabling changes.

Optional writes are controlled by organization scope and approval settings. You can require approval in an attached VS Code window, or grant **standing approval** for supported write tools within an organization allowlist. Standing approval lets those writes proceed **without a prompt for each change**. Raw GraphQL mutations always require an attached editor's approval for each call.

**[Configure write permissions and scope →](docs/mcp-setup.md#enabling-writes)**

## Edit templates in VS Code

The [VS Code extension](https://marketplace.visualstudio.com/items?itemName=JBramley.rewst-buddy) adds linked template files, sync-on-save with conflict detection, Jinja completion and live preview, workflow export, and approval dialogs. Link one template or mirror an organization's templates into a folder, then work with your usual editor tools.

**[Set up template editing →](docs/quickstart.md)** · **[Explore editor features](docs/features.md)**

## Go further

- [MCP setup and troubleshooting](docs/mcp-setup.md): client configurations, login, regions, and environment requirements.
- [Chrome walkthrough](docs/browser-extension.md): download, load, and verify session transfer.
- [Persistent server](docs/mcp-setup.md#persistent-http-server): share a server between clients and keep it running after an assistant closes.
- [Server reference](packages/mcp-server/README.md): launch flags, credential storage, and embedding.
- [All documentation](docs/README.md) · [Build from source](docs/mcp-setup.md#build-from-source)

MIT licensed. [Report an issue](https://github.com/totallynotjon/rewst-buddy/issues) · [Browser extension source](https://github.com/totallynotjon/rewst-buddy-browser)
