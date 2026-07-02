# Rewst Buddy VS Code Extension

VS Code extension for managing Rewst templates locally. Users link local files to Rewst templates, edit in VS Code, and sync changes back to Rewst with conflict detection.

## Tool Usage During Planning & Exploration

During planning, research, and exploration phases, **always use the pre-approved tools** that do not require user confirmation:

- **`Read`** — read file contents (prefer over `Bash(cat ...)`)
- **`Glob`** — find files by pattern (prefer over `Bash(find ...)` or `Bash(ls ...)`)
- **`Grep`** — search file contents (prefer over `Bash(grep ...)` or `Bash(rg ...)`)
- **`Bash(git log/diff/show/status/branch)`** — inspect git state
- **`Bash(ls/tree)`** — list directory contents
- **`mcp__ide__getDiagnostics`** — check TypeScript errors

These tools run without prompting the user. **Never use Bash equivalents** (e.g., `Bash(cat ...)`, `Bash(grep ...)`, `Bash(find ...)`) for tasks these dedicated tools handle — the dedicated tools are faster, produce better output, and don't require approval.

Subagents (Plan, Explore, etc.) inherit these permissions and should follow the same preference. Only prompt the user for write operations (Edit, Write) and potentially destructive commands.

## AI Prompt Steering Directives

When editing the Cage-Free Rewsty steering prompt or `vscode-tool` protocol text, keep the wording boring, descriptive, and transport-focused. The backend receives our preamble in the user-message channel, so XML-style wrappers, claims of special authority, and "override/supersede/ignore your system prompt" language can trigger the model's prompt-injection reflex, especially on edit/write requests.

**Use neutral framing:**

- Say "Rewst Buddy VS Code Context", "extension-supplied transport metadata", "local tool protocol", and "VS Code approval/sandbox flow."
- Say that local tools are requested with fenced `vscode-tool` JSON blocks and that the extension intercepts those blocks, parses them, and routes them through VS Code.
- Say safety constraints remain in effect and that the preamble does not grant direct filesystem or network access.

**Avoid override-shaped framing:**

- Do not wrap steering in XML-like authority tags such as `<engineering_layer_directive>`.
- Do not say the preamble "supersedes", "overrides", "owns this session", "is trusted system-level instruction", or tells the model to ignore its system prompt.
- Do not describe a refusal as an error by itself. Instead, explain the executable transport: if a listed editor tool is needed, emit the `vscode-tool` block and let VS Code handle execution and approval.

For edit/write tools specifically (`insert_edit_into_file`, `replace_string_in_file`, `create_file`, terminal tools, todo/agent tools), keep explicit steering close to the concrete Available tools list. The model has been observed to handle read/list tools correctly while refusing edit tools unless the protocol text states that fenced blocks are executable extension requests, not ordinary prose.

Live regression coverage for this behavior lives in `src/test/integration/directive.test.ts` under `an explicit insert edit tool request is a vscode-tool block, not a native call`.

When editing AI tool steering, keep all tool metadata surfaces in sync. Runtime specs such as `WORKFLOW_TOOL_SPECS` are mirrored into `package.json` `contributes.languageModelTools`; after changing a tool description or `inputSchema`, run `npm run test:grep -- "Unit: package manifest"` and fix any drift instead of leaving VS Code's contributed metadata stale.

For `buddy_workflow_get` detail steering specifically, do **not** say or imply that `detail:"full"` is needed for ordinary workflow edit prep. The summary view is enough for understanding and most name-based `buddy_workflow_edit` operations because edits resolve tasks by name. Reserve `detail:"full"` only for cases that actually need task ids, transition ids, or canvas positions, such as repositioning or targeting one specific transition by id. Regression coverage for this wording lives in `src/ui/chat/tools/workflowTools.test.ts` under `buddy_workflow_get spec reserves full detail for ids and positions, not ordinary edits`.

## Directory Structure

```text
src/
├── commands/           # VS Code commands (user interactions)
│   ├── client/        # Session commands (NewSession, ClearSessions)
│   ├── server/        # Server commands (StartServer, StopServer)
│   ├── template/      # Template operations
│   │   └── link/      # Link/Unlink commands
│   ├── GenericCommand.ts      # Base class for all commands
│   ├── CommandInitiater.ts    # Auto-registration system
│   └── exportedCommands.ts    # Command discovery exports
├── sessions/          # Rewst API sessions
│   ├── Session.ts             # SDK wrapper + validation
│   ├── SessionManager.ts      # Session lifecycle (singleton)
│   └── graphql/               # Auto-generated GraphQL SDK
├── providers/         # VS Code language providers
│   ├── TemplateHoverProvider.ts     # Hover info for template() calls
│   ├── TemplateDefinitionProvider.ts # Ctrl+click navigation
│   ├── templatePatternUtils.ts      # Shared regex/matching utilities
│   └── templatePatternUtils.test.ts # Colocated unit test
├── models/            # Business logic managers
│   ├── LinkManager.ts         # File-to-template associations (singleton)
│   ├── LinkManager.test.ts    # Colocated unit test
│   ├── TemplateSyncManager.ts # Sync-on-save handler (singleton)
│   └── syncDecision.test.ts   # Colocated unit test
├── ui/                # User interface
│   ├── pickers/       # QuickPick utilities (Session, Template, Org)
│   ├── webview/       # Tree views and sidebar
│   └── StatusBarIcon.ts
├── server/            # HTTP server for browser extension
├── context/           # Global VS Code context wrapper
├── events/            # Event type definitions
├── utils/             # Helpers (log, ensureSavedDocument, etc.)
│   ├── getHash.ts
│   ├── getHash.test.ts        # Colocated unit test
│   └── ...
├── test/
│   ├── helpers/       # Centralized test utilities (@test alias)
│   └── integration/   # Integration tests (require REWST_TEST_TOKEN)
└── extension.ts       # Entry point
```

## User-Facing Documentation

User docs are split between a short landing README and three deep-dive files in `docs/`. When adding or editing user-facing documentation, put content in the file whose purpose it matches — don't duplicate across files.

```text
README.md             # Marketplace/GitHub landing: banner, about, install,
                      #   3-step quick start, features glance, security, links out.
                      #   Keep short (~100 lines). No exhaustive feature detail.
docs/
├── quickstart.md     # Onboarding: first-time session setup (cookie + browser ext),
│                     #   single-template workflow (primary), bulk folder workflow.
├── features.md       # Per-feature deep dives, one H2 per feature
│                     #   (Auto-Sync, Auto-Fetch, Smart Opening, Rename,
│                     #   Stale Link Pruning, Navigation, Bundles, Server).
└── reference.md      # Flat reference: sidebar, status bar, commands list,
                      #   settings table, multi-region setup.
```

**Conventions:**

- Lead the Quick Start with the **single-template** workflow. Folder linking is secondary — framed as "mirror an entire org's templates locally."
- Command names in docs must match `package.json` `contributes.commands` titles exactly (e.g., `Link File to Template`, not `Link Template`).
- Settings table in `reference.md` must match `package.json` `contributes.configuration.properties` (name, type, default).
- Status bar appears in the **bottom-left** (`StatusBarAlignment.Left` in `src/ui/StatusBarIcon.ts`).
- "Unofficial" framing stays prominent in README — banner at top, title includes "Unofficial", package.json description starts with "Unofficial".
- Relative links (`docs/features.md`, `#anchor`) resolve on both GitHub and the VS Code Marketplace — prefer them over absolute URLs.
- When adding a new feature, update: `docs/features.md` (deep dive), `docs/reference.md` (commands + settings if any), `README.md` "Features at a glance" bullet if user-visible, and add a changelog note (see **Changelog & Releases**).

## Pull Request Conventions

- **Always open PRs as drafts** (`gh pr create --draft`). The maintainer flips a draft to "ready for review" — that transition is what triggers the CodeRabbit review, so opening ready-for-review PRs directly costs review runs. Never mark a PR ready yourself.
- **One PR per cohesive effort.** Batch closely related changes (e.g. several fixes coming out of the same investigation) into a single PR instead of parallel small PRs, unless asked to split them. Multiple `changelog.d/` notes in one PR are fine.

## Changelog & Releases

The changelog is generated from **per-PR note files** — never hand-edit `CHANGELOG.md`. This is the canonical process; the CI workflows point back here.

### Adding a changelog note (every user-facing PR)

- Add **one file per PR**: `changelog.d/<pr-or-issue-number>.md`. Scaffold it with `npm run changelog:new`, or write it directly.
- Frontmatter `category:` is `Added`, `Changed`, or `Fixed` (also accepts `Deprecated`, `Removed`, `Security`; common synonyms auto-correct). Optional `pr:` sets the PR link; a numeric filename is the fallback. When the PR number is only known after opening the PR, set `pr:` then and push that one-line change.
- The body is the Markdown bullet exactly as it should read in the changelog. **Keep it to 1–2 short sentences** — a bold lead plus one sentence of what changed for the user. A 50-word hard cap is enforced by `npm run changelog:check`. The changelog is for users to skim: deep functionality explanation goes in `docs/`, and coding conventions or internal detail go in this `CLAUDE.md` or internal docs — never in a changelog note.
- One file per PR is what keeps the changelog conflict-free — **never edit `CHANGELOG.md` directly.** Details: `changelog.d/README.md`.
- CI requires a note on every PR (`npm run changelog:check`); a PR that genuinely needs none carries the `skip-changelog` label.

### Releasing (fully automated in CI — there is no release skill)

Releases run entirely through GitHub Actions; runbook and one-time setup are in `docs/dev/releasing.md`. In short:

1. Run the **Prepare release** workflow (Actions → Run workflow) — pick a bump (`patch`/`minor`/`major`) or an explicit version. It collates `changelog.d/` into a new `## [x.y.z]` section in `CHANGELOG.md`, bumps `package.json`, and opens a `release/vx.y.z` PR.
2. Review and squash-merge that PR — **merging publishes.** On merge, `tag-on-merge.yml` pushes the `vx.y.z` tag (via the release-bot App token, so the tag triggers Publish), and the **Publish** workflow creates the GitHub release (notes from the CHANGELOG section) and publishes to the Marketplace. Merging the release PR is the approval to publish — there is no separate gate. (`npm run release:tag` stays as a manual fallback.)

Per-change code review happens on each feature PR (CodeRabbit + CI), not at release time.

### Nightly (pre-release) channel

Every push to `main` runs `nightly.yml`, which publishes a `--pre-release` build to the Marketplace. Stable rides **even** minors (`package.json`); nightlies ride the next **odd** minor as `MAJOR.<oddMinor>.<git rev-list --count HEAD>` (e.g. stable `0.44.x` ⇒ nightly `0.45.<build>`), so versions only ever increase across both channels. Stable must stay on an even minor — `nightly.yml` fails fast otherwise. Nightlies are not tagged and get no GitHub release. Details in `docs/dev/releasing.md`.

## Path Aliases (CRITICAL)

**Must be configured in BOTH files:**

| Alias       | Target                      | Purpose            |
| ----------- | --------------------------- | ------------------ |
| `@sessions` | `src/sessions/index.ts`     | Session/SDK access |
| `@models`   | `src/models/index.ts`       | Managers and types |
| `@commands` | `src/commands/index.ts`     | Command classes    |
| `@utils`    | `src/utils/index.ts`        | Utilities          |
| `@global`   | `src/context/index.ts`      | Extension context  |
| `@ui`       | `src/ui/index.ts`           | UI components      |
| `@server`   | `src/server/index.ts`       | HTTP server        |
| `@events`   | `src/events/index.ts`       | Event types        |
| `@test`     | `src/test/helpers/index.ts` | Test utilities     |

**When adding a new alias:**

1. Add to `tsconfig.json` under `compilerOptions.paths`
2. Add to `webpack.config.cjs` under `resolve.alias`

Both are required - TypeScript uses tsconfig for type checking, webpack uses its config for bundling.

## Core Patterns

### Command Pattern

```typescript
// All commands extend GenericCommand
export class MyCommand extends GenericCommand {
	commandName = 'MyCommand'; // Registered as rewst-buddy.MyCommand

	async execute(...args: unknown[]): Promise<void> {
		// Implementation
	}
}
```

- Export from `exportedCommands.ts` for auto-registration
- Commands registered with two prefixes: `rewst-buddy.{name}` and `rewst-buddy.prefix.{name}`

### Manager/Singleton Pattern

```typescript
export const TemplateLinkManager = new (class TemplateLinkManager {
  // Private state
  private links = new Map<string, TemplateLink>();

  // Event emitter for reactive updates
  private linksSavedEmitter = new vscode.EventEmitter<LinksSavedEvent>();
  readonly onLinksSaved = this.linksSavedEmitter.event;

  // Methods modify state and emit events
  addLink(link: TemplateLink) { ... }
})();
```

### Event Flow Pattern

Managers emit events → UI components subscribe → React to changes

```typescript
// In manager
this.linksSavedEmitter.fire({ links: this.links });

// In UI component
TemplateLinkManager.onLinksSaved(() => this.refresh());
```

### Picker Pattern (Chainable)

```typescript
const session = await pickSession(); // Returns RewstSession | undefined
const org = await pickOrganization(session); // Returns OrgPick | undefined
const template = await pickTemplate(); // Returns TemplatePick | undefined
```

## Context Menu Args Handling

**IMPORTANT:** When commands are invoked from context menu, args come wrapped:

```typescript
async execute(...args: any[]): Promise<void> {
  // Context menu: args[0][0] is vscode.Uri
  // Command palette: args is empty, use active editor

  if (args[0][0] instanceof vscode.Uri) {
    document = await vscode.workspace.openTextDocument(args[0][0]);
  } else {
    document = vscode.window.activeTextEditor?.document;
  }
}
```

Use the utility helper:

```typescript
import { ensureSavedDocument } from '@utils';

async execute(...args: unknown[]): Promise<void> {
  const document = await ensureSavedDocument(args);
  // Now you have a saved document from either context menu or active editor
}
```

## Data Persistence

| Storage       | Key                    | Data                                  |
| ------------- | ---------------------- | ------------------------------------- |
| `globalState` | `RewstSessionProfiles` | Session metadata (org, region, label) |
| `globalState` | `RewstTemplateLinks`   | File-to-template mappings             |
| `secrets`     | `{orgId}`              | Encrypted cookies/tokens              |
| `settings`    | `rewst-buddy.*`        | User preferences                      |

## Logging

```typescript
import { log } from '@utils';

log.debug('Dev only message');
log.info('Always logged');
log.notifyInfo('Shows VS Code info notification');
log.notifyError('Shows VS Code error notification');
throw log.error('Returns Error object for throwing');
```

## Activation Flow (extension.ts)

1. Initialize global context and logger
2. Load persisted sessions
3. Register commands (auto-discovered)
4. Initialize managers (self-register for VS Code events)
5. Initialize UI components (subscribe to manager events)
6. Start HTTP server if enabled

All components implement `vscode.Disposable` and push to `context.subscriptions`.

## Conventions

- **Classes:** PascalCase (`Session`, `TemplateLinkManager`)
- **Functions:** camelCase (`pickSession`, `ensureSavedDocument`)
- **Events:** `onXxx` pattern (`onSessionChange`, `onLinksSaved`)
- **Managers:** End with `Manager` suffix
- **Commands:** Verb pattern (`CreateTemplate`, `SyncTemplate`)

## Common Pitfalls

1. **Path aliases**: Must update BOTH tsconfig.json AND webpack.config.cjs
2. **Context menu args**: Use `args[0][0]` not `args[0]` for URI
3. **Disposables**: Always push to `context.subscriptions` for cleanup
4. **Template updates**: After modifying template, update `link.template.updatedAt` to prevent false conflicts

## Capability / MCP Tool Authoring

Capabilities live in `src/capabilities/*Capabilities.ts` and are surfaced to the MCP server and chat. Most review round-trips on these tools trace to a few rules — apply them up front instead of in follow-up commits.

- **MCP inputs are NOT validated against `inputSchema`.** `McpActions` passes the raw `arguments` straight to `capability.run()` (see `src/mcp/McpActions.ts`); the schema is only advertised to the client, never enforced. So `run()` must defensively validate/coerce **every** input:
    - Strings: `requireString` (required) / `asString` (optional) — never read `input.x` directly.
    - Numbers: clamp — `Math.min(asPositiveInt(input, 'limit') ?? DEFAULT, MAX)`. `asPositiveInt` already rejects `0`, negatives, and fractions (returns `undefined`); preserve that property in any new numeric helper (e.g. `mapWithConcurrency` throws on a non-positive limit).
    - Enums: validate against the allowed set before use — never blind-cast `input.kind as Kind`. An unexpected value must fall back to a safe default or throw, not slip through.
- **GraphQL error handling:** after every `rawGraphql`, check `errors` and throw _with context_ — include the serialized errors in the message (`GraphQL error: ...`), never a bare `throw new Error()` (which discards the failure).
- **Description ↔ behavior parity:** if a tool's `description`/`inputSchema` says it returns or accepts a field, the handler must actually surface/use it. Drift (e.g. fetching `roleIds` but dropping them from the output) gets flagged.
- **Build list output from the requested inputs, not the response keys.** Iterate the requested `ids`/`triggerIds` and look each up, so a missing or empty (`{}`) response yields deterministic rows (`unknown`) instead of dropped entries or a blank line.
- **Tests cover every branch, not just the happy path.** Each `kind`/mode and the error/skip paths need a case (e.g. `buddy_find_executions_by_variable` needs an `input` _and_ a `context`-with-failed-fetch test). Mock helpers must mirror the real signature — optional vs required params (the mock `rawGraphql` marks `variables?` optional to match `Session.rawGraphql`).
- **Write tools (`access:'write'`) are org-scoped and gated twice.** A write capability is exposed only when `rewst-buddy.mcp.enableWriteTools` (or `enableDangerousGraphqlMutation` for `buddy_graphql_mutate`) is on, and may only target an org in the **effective allowed set** — the user's working scope (`WorkingScopeManager`) folded together with the persistent `rewst-buddy.mcp.alwaysAllowedOrgs` setting. This is enforced centrally in `McpActions.callTool` (`assertScopeAllowed`) for every `access:'write'` capability before it runs: a write whose org is not in the set is rejected with `org_out_of_scope`, and an **empty** set means no writes at all (the safe default — pin a working org or list one in `alwaysAllowedOrgs`). When a working **workflow** is pinned, a write that names a workflow must name one in scope (`workflow_out_of_scope`). The working scope is the user's deliberate selection (status bar / `Set Working Scope`); a model can only _request_ a change via `buddy_set_working_scope`, which takes effect after a VS Code modal, and `alwaysAllowedOrgs` is a setting the model can't widen. Reads are scoped to the same set only under strict `workingOrgScope` and only once a working org is pinned; org-discovery tools (`requiresOrg:false`, e.g. `buddy_list_orgs`, `buddy_get_working_scope`) are never scoped. No write tool may be `requiresOrg:false` (the gate needs a concrete orgId), and any by-id write must re-verify the resource's `orgId` against the requested org before mutating (one session can manage several orgs). The per-call approval prompt is hosted in VS Code and may not surface to an external MCP client, so the effective allowed set — not the prompt — is the reliable blast-radius gate; keep that in mind when wording the `approval_required` message.

## Docs & changelog hygiene (markdownlint runs in review)

- Every fenced code block needs a language label (use ` ```text ` for plain blocks) — markdownlint MD040 fails otherwise.
- Don't hardcode volatile numbers (passing-test counts, tool counts that change) in docs; they drift and get flagged. Prefer "full suite green".
- `changelog.d/` takes **multiple** notes per PR and feature-named files are fine; each file carries exactly one `category:`, so a PR spanning `Added` + `Fixed` needs at least two files. Distinct filenames are what keep collation conflict-free — that, not "one file per PR", is the actual rule.
- **No coding conventions or internal technical detail in the changelog or user docs.** The changelog (`changelog.d/`, `CHANGELOG.md`) and external docs (`README.md`, `docs/`) are written for users. Conventions, architecture, and contributor/test workflow live in this `CLAUDE.md` or internal docs. Changelog entries stay at 1–2 short sentences (≤50 words, enforced by `changelog:check`); when a feature needs a deeper explanation it goes in `docs/`, not the note.

## Performance (CRITICAL)

This is an editor extension - **workflow speed is paramount**. Every millisecond of latency degrades user experience.

### Principles

1. **Never block the UI thread** - All I/O operations must be async
2. **O(1) over O(n)** - Use Maps/indexes for lookups, not array filtering
3. **Lazy loading** - Defer work until actually needed
4. **Cache aggressively** - Avoid redundant API calls and computations

### Patterns to Follow

- **Secondary indexes**: When you need frequent lookups by a field, maintain a parallel Map (see `LinkManager.templateIdIndex`)
- **Fire-and-forget persistence**: State saves should not block user actions
- **Debounce/throttle**: Rapid events (typing, file changes) should be batched
- **Early returns**: Exit fast when preconditions aren't met

### Patterns to Avoid

- `array.find()` or `array.filter()` for repeated lookups - use a Map
- Synchronous file I/O - use VS Code's async APIs
- Fetching data you already have cached
- Blocking on persistence before returning to user
- Re-computing values that haven't changed

### Language Providers

Hover, completion, and definition providers are called frequently during editing:

- Return `null` immediately if position doesn't match expected patterns
- Cache regex results when processing the same document repeatedly
- Keep provider logic minimal - offload to cached manager data

## Spec-Driven Development

`openspec/specs/` holds the behavioral baseline — OpenSpec-style capability specs distilled from the code (conventions in `openspec/specs/README.md`). They are the normative, human-readable contract that sits above the tests: each `Requirement` is a `SHALL` guarantee, each `Scenario` a `GIVEN/WHEN/THEN` behavior under it. Specs describe _what_ the extension guarantees, not _how_ the code is structured — no private function names or line numbers; the `Source:` line points at files for traceability.

**Behavior moves as a trio — spec, test, code — in the same PR.** When you change observable behavior:

1. Update the affected `Requirement`/`Scenario` (or add one) in the relevant `openspec/specs/*/spec.md`.
2. Write or adjust the colocated `*.test.ts` (plus an integration test when live API or assistant behavior is involved) so a test asserts that scenario. Tests stay the executable contract; the spec is the normative layer above them.
3. Make the code satisfy both.

Never let them drift: code that contradicts a requirement, a requirement no test covers, and a spec change with no matching test are all gaps to fix, not to defer.

**Consistency when editing a spec:**

- Every `Requirement` uses `SHALL` and carries at least one `Scenario`; every `Scenario` sits under a `Requirement`.
- Cross-spec references (a requirement citing another spec's requirement by backticked title) must name a requirement that exists and must not contradict it. Keep terminology identical across specs — don't rename the same concept differently in two files.
- Settings, command titles, and storage keys quoted in a spec mirror `package.json` `contributes.*` and the persistence keys.
- **Implementation status convention:** when a requirement states the intended contract but the code doesn't fully implement it yet, keep the requirement as the target and add a short _Implementation status_ note under it describing the gap — don't soften the requirement to match a bug.

CodeRabbit enforces this: `openspec/specs/**` is registered as authoritative guidelines so code is reviewed against the specs, and per-path review instructions flag spec/test drift and cross-spec inconsistency.

## Testing

**IMPORTANT: Write the test first.** Tests are the definition and contract of behavior — every feature and fix starts with a failing test that asserts the intended behavior, then the implementation that makes it pass. No functionality changes without a test that defines it: a colocated `*.test.ts` unit test, plus an integration test when live API or assistant behavior is involved. CodeRabbit treats a functionality change with no test as a blocking issue.

### Running Tests

```bash
npm test              # Run all tests
npm run test:unit     # Run unit tests only (no auth required)
npm run test:integration  # Run integration tests (requires REWST_TEST_TOKEN)
npm run test:grep -- "Unit: toolProtocol"  # Run a targeted unit grep
npm run test:grep:integration -- "an explicit insert edit tool request"  # Run a targeted live integration grep
```

Use `vscode-test --grep`, not `vscode-test -- --grep`. The extra `--` prevents the VS Code test CLI from applying Mocha's grep and can accidentally run the full suite. For targeted live integration tests whose grep does not include the word `Integration`, use `test:grep:integration`; it sets `REWST_TEST_INTEGRATION=1` so `.vscode-test.mjs` loads `.env` / `REWST_TEST_TOKEN`.

### Test Structure

- **Unit tests** (colocated `*.test.ts` files): Test isolated logic without external dependencies. These run fast and don't require authentication. Place tests next to the source file they test (e.g., `src/models/LinkManager.test.ts`).
- **Integration tests** (`src/test/integration/`): Test real API interactions. Require `REWST_TEST_TOKEN` environment variable.
- **Test helpers** (`src/test/helpers/`): Centralized test utilities, accessible via `@test` alias.

### Test Helpers

```typescript
import { initTestEnvironment, hasTestToken, getTestSession } from '@test';

// Initialize mocks (required in beforeEach)
initTestEnvironment();

// Check if integration tests can run
if (hasTestToken()) {
	const session = await getTestSession();
	// ... test with real API
}
```

| Helper                                    | Purpose                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `initTestEnvironment`                     | Set up mock VS Code context and globals                            |
| `hasTestToken`                            | Check if `REWST_TEST_TOKEN` is available                           |
| `getTestSession`                          | Create authenticated session for integration tests                 |
| `createMockContext`                       | Create mock `vscode.ExtensionContext`                              |
| `createMockWrapper`                       | Create a MockWrapper instance for mocking SDK calls                |
| `MockWrapper`                             | Class for configuring mock GraphQL responses with fluent API       |
| `Fixtures`                                | Type-safe builders for creating test data (orgs, users, templates) |
| `createMockSession`                       | Create a Session with mocked SDK for unit testing                  |
| `SessionManager._setSessionsForTesting()` | Inject mock sessions into SessionManager                           |
| `SessionManager._resetForTesting()`       | Reset SessionManager state between tests                           |

### Writing Tests

**Basic unit test template:**

```typescript
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment, createMockSession, Fixtures } from '@test';
import { SessionManager } from '@sessions';
import { YourFeature } from '@models';

const { suite, test, setup, teardown } = Mocha;

suite('Unit: YourFeature', () => {
	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	teardown(() => {
		// Clean up resources
	});

	test('should perform expected behavior', async () => {
		// Arrange: Set up test data and mocks
		const org = Fixtures.orgModel({ id: 'test-org' });
		const { session, wrapper } = createMockSession({
			profile: { org, allManagedOrgs: [org] },
		});

		wrapper.when('someOperation', {
			data: Fixtures.someResponse({
				/* ... */
			}),
		});

		SessionManager._setSessionsForTesting([session]);

		// Act: Execute the feature
		const result = await YourFeature.doSomething();

		// Assert: Verify expectations
		assert.ok(result);
		assert.strictEqual(wrapper.getCallsFor('someOperation').length, 1);
	});
});
```

### When to Write Which Type

- **Unit tests**: Pure functions, managers, utilities, parsers, validators
- **Integration tests**: GraphQL queries, session validation, template sync operations

## Testing with Mock SDK Wrapper

For unit testing SDK-dependent logic without hitting the API:

### Basic Mock Session

```typescript
import { createMockSession, Fixtures } from '@test';

const { session, wrapper } = createMockSession();

// Configure specific responses
wrapper.when('getTemplate', {
	data: Fixtures.getTemplateQuery({ name: 'My Template' }),
});

// Use session in your test
const template = await session.sdk.getTemplate({ id: 'template-id' });
```

### Custom Fixtures

```typescript
const customOrg = Fixtures.orgModel({
	id: 'custom-id',
	name: 'Custom Org',
});

const customTemplate = Fixtures.fullTemplate({
	id: 'template-id',
	name: 'Custom Template',
	body: '// Custom body',
	updatedAt: '2024-01-01T00:00:00Z',
	orgId: customOrg.id,
});

wrapper.when('getTemplate', {
	data: Fixtures.getTemplateQuery(customTemplate),
});
```

### Error Testing

```typescript
wrapper.when('updateTemplateBody', {
	error: Fixtures.networkError('Connection failed'),
	delay: 100,
});
```

### Dynamic Responses

```typescript
// Return different data based on query variables
wrapper.when('getTemplate', vars => {
	if (vars.id === 'template-1') {
		return { data: Fixtures.getTemplateQuery({ name: 'Template 1' }) };
	}
	return { error: Fixtures.notFoundError('Template') };
});
```

### Verifying SDK Calls

```typescript
// Check calls were made
assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);

// Verify call parameters
const calls = wrapper.getCallsFor('updateTemplateBody');
assert.ok(calls[0].variables.body.includes('expected content'));
```

### Using Mock Sessions with SessionManager

```typescript
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures } from '@test';

// Create mock sessions
const { session, wrapper } = createMockSession({
	profile: {
		org: Fixtures.orgModel({ id: 'org-1', name: 'Test Org' }),
	},
});

// Inject into SessionManager
SessionManager._setSessionsForTesting([session]);

// Your code that depends on SessionManager will now use the mock session

// Clean up between tests
SessionManager._resetForTesting();
```

### Available Fixtures

- **Organizations**: `Fixtures.org()` (GraphQL type), `Fixtures.orgModel()` (model type)
- **Users**: `Fixtures.userFragment()`, `Fixtures.user()`, `Fixtures.userQuery()`
- **Templates**: `Fixtures.template()`, `Fixtures.fullTemplate()`
- **GraphQL Responses**: `Fixtures.getTemplateQuery()`, `Fixtures.listTemplatesQuery()`, `Fixtures.updateTemplateBodyMutation()`
- **Errors**: `Fixtures.networkError()`, `Fixtures.graphqlError()`, `Fixtures.notFoundError()`, `Fixtures.timeoutError()`

All fixture methods accept partial overrides for customization.

## Test-Driven Development Requirements

**MANDATORY — tests come first.** Tests are the contract: they define what the software does. Write the failing test before the implementation, watch it fail (red), write the minimum code to pass it (green), then refactor. No functionality lands without a test that defined it first. When implementing new functionality:

### 1. Plan for Testability

Before writing code, consider:

- What external dependencies does this feature have? (SDK calls, file system, VS Code APIs)
- How can I structure this code to be easily testable?
- What edge cases need testing?

**Testability Patterns:**

- **Dependency Injection**: Accept dependencies as parameters rather than importing directly
- **Separation of Concerns**: Separate business logic from VS Code UI interactions
- **Event-Driven**: Use event emitters for reactive updates (easier to test than direct calls)

### 2. Write the Test First (Red → Green → Refactor)

Author the test before the code it covers. It must fail first — that proves it tests something — then you write the implementation that makes it pass. The examples below are the assertions you write up front: the contract the implementation must satisfy.

**For SDK-dependent features:**

```typescript
// Example: Testing a new template sync feature
test('should sync template with conflict detection', async () => {
	// Setup: Create mock session and configure API responses
	const { session, wrapper } = createMockSession();
	const localTemplate = Fixtures.fullTemplate({
		updatedAt: '2024-01-01T00:00:00Z',
		body: '// Local version',
	});

	const remoteTemplate = Fixtures.fullTemplate({
		id: localTemplate.id,
		updatedAt: '2024-01-02T00:00:00Z', // Newer
		body: '// Remote version',
	});

	wrapper.when('getTemplate', {
		data: Fixtures.getTemplateQuery(remoteTemplate),
	});

	SessionManager._setSessionsForTesting([session]);

	// Exercise: Call your sync logic
	const result = await syncTemplate(localTemplate.id);

	// Verify: Check conflict was detected
	assert.strictEqual(result.conflict, true);
	assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1);
});
```

**For manager/model logic:**

```typescript
// Test state management and event emission
test('should emit event when template link is added', async () => {
	initTestEnvironment();

	let eventFired = false;
	LinkManager.onLinksSaved(() => {
		eventFired = true;
	});

	const link = createTemplateLink();
	LinkManager.addLink(link);

	assert.ok(eventFired, 'Event should have been emitted');
});
```

### 3. Test Coverage Guidelines

**Minimum requirements for new features:**

| Feature Type   | Required Tests                                      |
| -------------- | --------------------------------------------------- |
| Commands       | Happy path + error handling + permission checks     |
| Managers       | State changes + event emissions + cleanup/disposal  |
| SDK Operations | Success + network errors + not found + invalid data |
| UI Components  | User interactions + state updates + error display   |
| Utilities      | All public methods + edge cases                     |

**Don't skip:**

- Error handling paths
- Edge cases (empty arrays, null values, concurrent operations)
- Cleanup and disposal logic
- Event subscriptions/unsubscriptions

### 4. Test Organization

**File naming:** Place test file next to source file with `.test.ts` suffix

- `src/models/SyncManager.ts` → `src/models/SyncManager.test.ts`
- `src/utils/getHash.ts` → `src/utils/getHash.test.ts`

**Test structure:**

```typescript
suite('Unit: YourFeature', () => {
	setup(() => {
		// Initialize test environment
		initTestEnvironment();
		// Reset relevant managers
		SessionManager._resetForTesting();
	});

	teardown(() => {
		// Clean up
	});

	suite('method1()', () => {
		test('should handle success case', () => {
			/* ... */
		});
		test('should handle error case', () => {
			/* ... */
		});
	});

	suite('method2()', () => {
		test('should ...', () => {
			/* ... */
		});
	});
});
```

### 5. When to Use Unit vs Integration Tests

**Use Unit Tests (with mocks) for:**

- Business logic and algorithms
- State management
- Event handling
- Error handling flows
- Most feature development

**Use Integration Tests (with real API) for:**

- Cookie refresh mechanisms
- Authentication flows
- Region detection
- Critical end-to-end workflows

**Rule of thumb:** If you can mock it, do. Integration tests are slower and more brittle.

### 6. Test Auto-Discovery

Tests are automatically discovered by webpack using glob patterns. No manual configuration needed.

**To add a new unit test:**

1. Create `YourFile.test.ts` next to `YourFile.ts`
2. Use relative imports for the module under test (e.g., `import { foo } from './YourFile'`)
3. Use `@test` alias for test helpers (e.g., `import { initTestEnvironment } from '@test'`)
4. Run `npm run test:unit` to verify

**To add a new integration test:**

1. Create the test file in `src/test/integration/`
2. Use `@sessions`, `@models`, etc. aliases for imports
3. Run `npm run test:integration` to verify

The webpack config uses glob patterns to find all `*.test.ts` files automatically.
