# Plan: GraphQL Playground (Notebook-Based)

## Context

The extension currently uses `graphql-request` with a typed SDK exposing only 8 pre-generated methods, but the Rewst API has 175+ queries, 160+ mutations, 140+ input types, and 45+ enums. Users want to explore the full API using their authenticated sessions.

The approach: a VS Code Notebook-based playground opened from the sidebar. Notebooks provide real editor buffers (AI assistants can write queries/variables), built-in run buttons, and an all-in-one tab experience. Notebooks are **transient by default** (untitled) — users can optionally save as `.rewst-playground` files.

A schema file generated via introspection gives GraphQL language extensions and AI assistants full context about available types and fields.

## Architecture

```
Sidebar "Open Playground" button
  → OpenPlayground command
    → Creates untitled notebook with query + variables cells
    → Triggers schema generation (async, fire-and-forget)

User clicks ▶ Run on query cell
  → PlaygroundController reads query cell + adjacent JSON variables cell
  → Picks session (cached after first pick)
  → Calls session.executeRawQuery(query, variables)
  → Renders JSON result as cell output
```

## Implementation

### Step 1: Expose raw GraphQL execution from Session

**`src/sessions/Session.ts`** — Modify

1. Change `newSdkAtRegion()` (private static, line 22) to return `{ sdk: Sdk; client: GraphQLClient }` instead of just `Sdk`. The client is currently created as a local variable (line 25) and discarded — capture it alongside the SDK.
2. Add public `client` field: `public client: GraphQLClient | undefined`
3. Update constructor to accept client: `constructor(sdk, profile, client?: GraphQLClient)`
4. Update `newSdk()` return type from `[Sdk, RegionConfig, CookieString]` to `[Sdk, RegionConfig, CookieString, GraphQLClient]`. Inside the region iteration loop (line 71), destructure `{ sdk, client }` from `newSdkAtRegion()` and return the client as the 4th tuple element at line 75.
5. Update `refreshToken()` (line 153): destructure `{ sdk, client }` from `newSdkAtRegion()`, store both `this.sdk = sdk` and `this.client = client`.
6. Add public method:

```typescript
public async executeRawQuery(
  document: string,
  variables?: Record<string, unknown>,
): Promise<{ data?: unknown; errors?: unknown[] }>
```

Uses `this.client.rawRequest(document, variables)` — returns the full response envelope including errors, which a playground needs to display. Throws if `this.client` is undefined.

**`src/sessions/SessionManager.ts`** — Modify

Update `createSession()` to destructure the 4th element (client) from `Session.newSdk()` at lines 86 and 89:

```typescript
[sdk, regionConfig, cookieString, client] = await Session.newSdk(token);
```

Pass client to constructor: `new Session(sdk, profile, client)`.

**`src/test/helpers/mockSession.ts`** — Modify

Extend `createMockSession()` to also store the mock client on the session:

```typescript
const dummyClient = new GraphQLClient('http://localhost:9999/graphql');
// ... existing SDK creation ...
const session = new Session(sdk, sessionProfile, dummyClient);
```

This enables tests to stub `rawRequest` on `session.client` directly. The existing MockWrapper still handles typed SDK calls; `rawRequest` is mocked separately via the injected client.

**`src/sessions/Session.test.ts`** — Create

- Success: create Session with a mock client (stub `rawRequest` to return `{ data: {...} }`), call `executeRawQuery`, verify response
- No client: create Session without client arg, call `executeRawQuery`, verify it throws
- Error propagation: stub `rawRequest` to return `{ errors: [...] }`, verify errors passed through
- Note: These tests mock the `GraphQLClient` directly (not via MockWrapper) since `rawRequest` bypasses the SDK wrapper chain

### Step 2: Notebook Serializer

**`src/notebook/PlaygroundSerializer.ts`** — Create

Implements `vscode.NotebookSerializer`. The `.rewst-playground` file format is simple JSON:

```typescript
interface PlaygroundNotebookData {
	version: 1;
	cells: Array<{ kind: 'code' | 'markup'; language: string; value: string }>;
}
```

- `deserializeNotebook(content)` — Parse JSON → `NotebookData` with `NotebookCellData` array
- `serializeNotebook(data)` — Convert cells → JSON → `Uint8Array`
- Malformed JSON fallback: return notebook with empty query cell

**`src/notebook/PlaygroundSerializer.test.ts`** — Create

Round-trip serialization, empty cells, malformed JSON fallback.

### Step 3: Notebook Controller

**`src/notebook/PlaygroundController.ts`** — Create

- `id`: `'rewst-playground-executor'`
- `notebookType`: `'rewst-playground'`
- `label`: `'Rewst GraphQL'`
- `supportedLanguages`: `['graphql']` (only query cells are executable, not variables cells)

Execute handler flow:

1. Read the executed cell's text as the GraphQL query
2. Look at the **immediately next cell** — if its language is `json`, parse as variables. If it's not JSON or doesn't exist, use `{}`. Only checks the directly adjacent cell (index + 1), never searches further.
3. Resolve session (see **Multi-Session Handling** below)
4. Call `session.executeRawQuery(query, variables)`
5. Render output:
    - Success: `NotebookCellOutputItem.json(response.data)` + errors if any. Include session label in output header (e.g., "Executed via: user@org")
    - Error: `NotebookCellOutputItem.error(err)`
6. Catch `ClientError` from `graphql-request` and render as structured error output

**Multi-Session Handling:**

The controller must be session-aware since users may have multiple authenticated sessions (different orgs/regions).

- **1 session**: Use it automatically, no prompt (matches existing `pickSession()` behavior at `src/ui/pickers/SessionPicker.ts:13`)
- **Multiple sessions, first execution**: Prompt via `pickSession()`. Cache the selected session's org ID in the notebook document metadata via `WorkspaceEdit` + `NotebookEdit.updateNotebookMetadata()` so subsequent executions reuse it without re-prompting.
- **Cached session becomes invalid**: If the cached session ID no longer exists in `SessionManager.getActiveSessions()`, re-prompt.
- **Changing sessions**: Add a `ChangePlaygroundSession` command that clears the notebook's cached session metadata (via `NotebookEdit.updateNotebookMetadata()`) and re-prompts on next execution. Register it as a notebook toolbar action (see Step 6 `notebook/toolbar` menu entry).
- **Session indicator**: Include the active session label in cell output so the user always knows which session ran the query. On first open before any execution, the notebook header markdown cell can mention "Session will be selected on first run."

**`src/notebook/PlaygroundController.test.ts`** — Create

- Valid query + variables: mock session, verify `executeRawQuery` args, verify output
- Query without variables cell: verify `{}` used
- Invalid JSON variables: verify error output
- No active sessions: verify graceful error
- Session caching in metadata

### Step 4: Schema Manager

**`src/notebook/SchemaManager.ts`** — Create

Singleton manager following existing pattern:

```typescript
export const SchemaManager = new (class SchemaManager implements vscode.Disposable {
  init(): this { /* subscribe to SessionManager.onSessionChange */ }
  dispose(): void { ... }
  async generateSchema(session: Session): Promise<void> { ... }
  async generateGraphQLConfig(): Promise<void> { ... }
})();
```

`generateSchema(session)`:

1. Run introspection via `session.executeRawQuery(getIntrospectionQuery())` — import `getIntrospectionQuery` from `graphql` package. Note: `graphql` is in devDependencies but webpack-bundled at runtime. Verify the import survives tree-shaking after implementation; if not, move to `dependencies`.
2. Write result to `.rewst/schema.json` in workspace root via `vscode.workspace.fs.writeFile`
3. The GraphQL LSP accepts JSON introspection results — no need to convert to SDL

`generateGraphQLConfig()`:

1. Prompt the user: "Generate .graphqlrc.yml for GraphQL editor completions?" (only on first playground open, not on every session change)
2. If user confirms and `.graphqlrc.yml` doesn't exist, create it with `schema: .rewst/schema.json`
3. If it exists, don't overwrite (user may have customized)

Triggers and session selection:

- On first playground open: use the playground's selected session (or the sole active session if only one exists)
- On `SessionManager.onSessionChange`: only regenerate if the changed session matches the one last used for schema generation (tracked via stored org ID). Don't regenerate on unrelated session changes.
- Could add a manual refresh command later

**`src/notebook/SchemaManager.test.ts`** — Create

- Mock session introspection response, verify file written
- Config file creation, verify no overwrite if exists
- Graceful failure on introspection error

### Step 5: OpenPlayground Command + Sidebar Button

**`src/commands/notebook/OpenPlayground.ts`** — Create

```typescript
export class OpenPlayground extends GenericCommand {
	commandName = 'OpenPlayground';

	async execute(): Promise<void> {
		const cells = [
			new vscode.NotebookCellData(
				NotebookCellKind.Markup,
				'# GraphQL Playground\nWrite queries below and press ▶ to execute.',
				'markdown',
			),
			new vscode.NotebookCellData(NotebookCellKind.Code, '{\n  user {\n    id\n    username\n  }\n}', 'graphql'),
			new vscode.NotebookCellData(NotebookCellKind.Code, '{}', 'json'),
		];

		const doc = await vscode.workspace.openNotebookDocument('rewst-playground', new vscode.NotebookData(cells));
		await vscode.window.showNotebookDocument(doc);

		// Fire-and-forget schema generation using session selection logic
		const sessions = SessionManager.getActiveSessions();
		if (sessions.length === 1) {
			SchemaManager.generateSchema(sessions[0]);
		}
		// If multiple sessions, schema generation deferred to first execution
		// (when the user picks a session via the controller)
	}
}
```

**`src/commands/notebook/ChangePlaygroundSession.ts`** — Create

Clears the active notebook's cached session metadata and re-prompts via `pickSession()`. Sets the new selection in notebook metadata. Shows notification confirming the switch.

**`src/commands/notebook/index.ts`** — Create barrel export (both commands)

**`src/commands/exportedCommands.ts`** — Add `export * from './notebook/index';`

### Step 6: Registration

**`src/extension.ts`** — Modify

Register notebook infrastructure **before** `CommandInitiater.registerCommands()` (the serializer must exist before the OpenPlayground command fires). SchemaManager registers alongside other managers; serializer and controller register alongside UI providers:

```typescript
// After UI providers, before managers:
context.subscriptions.push(vscode.workspace.registerNotebookSerializer('rewst-playground', new PlaygroundSerializer()));
context.subscriptions.push(new PlaygroundController());

// With other managers (after SessionManager.init()):
context.subscriptions.push(SchemaManager.init());
```

**`package.json`** — Modify

Add to `contributes`:

```json
"notebooks": [{
  "type": "rewst-playground",
  "displayName": "Rewst GraphQL Playground",
  "selector": [{ "filenamePattern": "*.rewst-playground" }]
}]
```

Add to `contributes.commands`:

```json
{
  "command": "rewst-buddy.prefix.OpenPlayground",
  "title": "Rewst Buddy: Open GraphQL Playground",
  "icon": "$(symbol-event)"
},
{
  "command": "rewst-buddy.prefix.ChangePlaygroundSession",
  "title": "Rewst Buddy: Change Playground Session",
  "icon": "$(account)"
}
```

Add sidebar button via `contributes.menus`:

```json
"view/title": [{
  "command": "rewst-buddy.prefix.OpenPlayground",
  "when": "view == rewst-buddy.sessionTree && rewst-buddy.anyActiveSessions",
  "group": "navigation"
}]
```

Add notebook toolbar button for session switching:

```json
"notebook/toolbar": [{
  "command": "rewst-buddy.prefix.ChangePlaygroundSession",
  "when": "notebookType == 'rewst-playground'"
}]
```

Add to `commandPalette`:

```json
{
  "command": "rewst-buddy.prefix.OpenPlayground",
  "when": "rewst-buddy.anyActiveSessions"
},
{
  "command": "rewst-buddy.prefix.ChangePlaygroundSession",
  "when": "notebookType == 'rewst-playground'"
}
```

### Step 7: Index File + Path Alias

**`src/notebook/index.ts`** — Create

```typescript
export { PlaygroundSerializer } from './PlaygroundSerializer';
export { PlaygroundController } from './PlaygroundController';
export { SchemaManager } from './SchemaManager';
```

**`tsconfig.json`** — Modify: Add `"@notebook": ["src/notebook/index.ts"]` to `compilerOptions.paths`

**`webpack.config.cjs`** — Modify: Add `'@notebook': path.resolve(__dirname, 'src/notebook/index.ts')` to `resolve.alias`

Both files must be updated (per CLAUDE.md). Once aliased, imports in `extension.ts` and commands use `@notebook` instead of relative paths.

## File Summary

| File                                               | Action                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/sessions/Session.ts`                          | Modify — add `client` field, `executeRawQuery()`, update return types                  |
| `src/sessions/SessionManager.ts`                   | Modify — pass `client` through `createSession()`                                       |
| `src/sessions/Session.test.ts`                     | Create — tests mock GraphQLClient directly (not via MockWrapper)                       |
| `src/test/helpers/mockSession.ts`                  | Modify — pass dummyClient to Session constructor                                       |
| `src/notebook/PlaygroundSerializer.ts`             | Create                                                                                 |
| `src/notebook/PlaygroundSerializer.test.ts`        | Create                                                                                 |
| `src/notebook/PlaygroundController.ts`             | Create                                                                                 |
| `src/notebook/PlaygroundController.test.ts`        | Create                                                                                 |
| `src/notebook/SchemaManager.ts`                    | Create                                                                                 |
| `src/notebook/SchemaManager.test.ts`               | Create                                                                                 |
| `src/notebook/index.ts`                            | Create                                                                                 |
| `src/commands/notebook/OpenPlayground.ts`          | Create                                                                                 |
| `src/commands/notebook/ChangePlaygroundSession.ts` | Create                                                                                 |
| `src/commands/notebook/index.ts`                   | Create                                                                                 |
| `src/commands/exportedCommands.ts`                 | Modify — add notebook export                                                           |
| `src/extension.ts`                                 | Modify — register serializer + controller before commands, SchemaManager with managers |
| `package.json`                                     | Modify — notebooks, commands, menus (incl. notebook/toolbar + commandPalette)          |
| `tsconfig.json`                                    | Modify — add `@notebook` path alias                                                    |
| `webpack.config.cjs`                               | Modify — add `@notebook` path alias                                                    |

## Key Design Decisions

1. **Variables convention**: Controller reads the immediately next cell (index + 1) as variables if its language is `json`. Simple, matches mental model from GraphQL tools. If not JSON or missing, variables default to `{}`.
2. **JSON schema over SDL**: Output `.rewst/schema.json` with raw introspection result. Avoids needing `buildClientSchema`/`printSchema` at runtime. GraphQL LSP accepts JSON introspection via `.graphqlrc.yml`.
3. **Transient by default**: `vscode.workspace.openNotebookDocument('rewst-playground', notebookData)` creates an untitled document. No file on disk until user saves.
4. **Session caching**: Stored in notebook metadata (via `NotebookEdit.updateNotebookMetadata()`) after first pick, keyed by org ID. User isn't re-prompted on each execution.
5. **Fire-and-forget schema**: Schema generation doesn't block playground opening. If it fails, the playground still works without LSP completions. With multiple sessions, schema generation defers to first execution when user picks a session.
6. **`graphql` package**: In devDependencies and webpack-bundled. `getIntrospectionQuery()` should be available at runtime — verify after implementation; move to `dependencies` if tree-shaken.
7. **Client injection for testability**: `GraphQLClient` stored on Session alongside SDK. `createMockSession()` passes a dummy client, enabling direct `rawRequest` stubbing in tests. Typed SDK calls continue to use MockWrapper as before.
8. **`.graphqlrc.yml` opt-in**: Prompt user on first playground open rather than silently creating workspace config files.

## Verification

1. `npm run compile` — builds without errors
2. `npm run test:unit` — all new and existing tests pass
3. Manual: Click sidebar button → untitled notebook opens with query + variables cells
4. Manual: Write a query, click Run → JSON output appears inline
5. Manual: Verify `.rewst/schema.json` generated, `.graphqlrc.yml` created
6. Manual: Save notebook as `.rewst-playground`, close and reopen, verify cells restore
7. Manual: With a GraphQL VS Code extension installed, verify completions work in query cells
