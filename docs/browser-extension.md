# Bring your Rewst session from Chrome

[← Documentation](README.md) · [Client setup](mcp-setup.md#client-configuration) · [Try the tools](using-mcp.md)

The browser companion transfers your signed-in Rewst session to the local MCP server. **You do not need VS Code for session transfer.** Chrome and the server should run in the same local environment, using port **27121**.

## 1 · Download the companion

Open the [browser extension repository](https://github.com/totallynotjon/rewst-buddy-browser), choose **Code → Download ZIP**, and extract the archive into a folder you can keep on your computer.

![Actual GitHub download menu with Download ZIP visible.](images/browser-download.png)

_The Code menu contains Download ZIP. You can also clone the repository._

## 2 · Load the right folder

Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge. Enable **Developer mode**, choose **Load unpacked**, and select **`build-chrome/` inside the extracted repository**.

![Actual build-chrome folder on GitHub, containing icons, popup, background.js, and manifest.json.](images/browser-build-folder.png)

_This is the folder's content on GitHub. In the local folder picker, select the matching `build-chrome` directory, not the ZIP or repository root. It contains `manifest.json` and `background.js`._

The screenshots show the real download pages. The browser's internal extension-management page is not pictured.

**Checkpoint:** Your browser's extensions page should show a Rewst Buddy entry enabled. Keep the unpacked directory in place so the browser can continue loading it.

For Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `build-firefox/manifest.json`. This is a temporary installation; see the [browser repository](https://github.com/totallynotjon/rewst-buddy-browser#installation).

## 3 · Start the MCP server

If you used a [stdio client configuration](mcp-setup.md#client-configuration), enable or start the server in that client. It launches the server for you.

For a process that stays running separately, follow the [persistent HTTP setup](mcp-setup.md#persistent-http-server). Keep port **27121**: the browser companion sends session handoffs there.

## 4 · Reload Rewst

Sign in to Rewst, then navigate to or reload a page **inside an organization**. The browser extension detects the completed navigation and transfers the session automatically.

![Connection diagram showing Chrome handing a session to the local Rewst Buddy server.](images/how-it-connects.svg)

_Connection diagram. The browser supplies login; your MCP client uses the tools. The server validates and manages the session._

You do not need to click the template-opening action to transfer a session. That separate action needs an attached VS Code editor.

The built-in North America (US), United Kingdom (UK), Asia (AU), and Europe
(DE) entries are probed automatically. If you use another region, configure
the [server's region](mcp-setup.md#rewst-regions) before the handoff.

## 5 · Verify it from your assistant

Ask:

> Use Rewst Buddy to list my organizations and show the current working scope. Do not change anything.

**Success means an actual organization list**, not just a list of available tool names. The server can advertise tools before it has a valid session.

| What happens                                                     | Next step                                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Organizations are returned                                       | Continue with [your first investigation](using-mcp.md).                                                                          |
| No active sessions                                               | Confirm the server is running, then reload a signed-in organization page.                                                        |
| “VS Code server not running”                                     | Check port 27121. The browser's wording also applies to a standalone owner.                                                      |
| Session rejected                                                 | Sign in again and verify the configured Rewst region.                                                                            |
| It works until the server restarts                               | Enable [encrypted persistence](mcp-setup.md#keep-your-login-across-restarts), or hand off the session again.                     |
| Browser is local but the client runs in WSL, SSH, or a container | Read [environment notes](mcp-setup.md#operating-systems-and-remote-environments); loopback may refer to a different environment. |

## Optional · Open a template in VS Code

Install the [Rewst Buddy VS Code extension](https://marketplace.visualstudio.com/items?itemName=JBramley.rewst-buddy), attach a compatible window to the server, and use the browser companion's opening action on a template/script page.

![Actual Marketplace listing showing how to install the VS Code companion.](images/vscode-marketplace.png)

[Continue with template linking and sync →](quickstart.md)
