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

1. Change `newSdkAtRegion()` return type from `Sdk` to `{ sdk: Sdk; client: GraphQLClient }`
2. Add optional `client` field to constructor: `constructor(sdk, profile, client?: GraphQLClient)`
3. Update `newSdk()` return type to `[Sdk, RegionConfig, CookieString, GraphQLClient]`
4. Update `refreshToken()` to store both `sdk` and `client` on `this`
5. Add public method:

```typescript
public async executeRawQuery(
  document: string,
  variables?: Record<string, unknown>,
): Promise<{ data?: unknown; errors?: unknown[] }>
```

Uses `this.client.rawRequest(document, variables)` — returns the full response envelope including errors, which a playground needs to display.

**`src/sessions/SessionManager.ts`** — Modify

Update `createSession()` (line 134) to destructure client from `Session.newSdk()` and pass it to `new Session(sdk, profile, client)`. Update destructuring at lines 86 and 89 to include the 4th element.

**`src/sessions/Session.test.ts`** — Create

- Success: mock `rawRequest`, verify `{ data, errors }` returned
- No client: verify throws
- Error propagation: verify GraphQL errors passed through

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
2. Look at the **next cell** — if it's JSON, parse as variables. Otherwise use `{}`
3. Resolve session (see **Multi-Session Handling** below)
4. Call `session.executeRawQuery(query, variables)`
5. Render output:
    - Success: `NotebookCellOutputItem.json(response.data)` + errors if any. Include session label in output header (e.g., "Executed via: user@org")
    - Error: `NotebookCellOutputItem.error(err)`
6. Catch `ClientError` from `graphql-request` and render as structured error output

**Multi-Session Handling:**

The controller must be session-aware since users may have multiple authenticated sessions (different orgs/regions).

- **1 session**: Use it automatically, no prompt (matches existing `pickSession()` behavior at `src/ui/pickers/SessionPicker.ts:13`)
- **Multiple sessions, first execution**: Prompt via `pickSession()`. Cache the selected session's user ID in the notebook document metadata so subsequent executions reuse it without re-prompting.
- **Cached session becomes invalid**: If the cached session ID no longer exists in `SessionManager.getActiveSessions()`, re-prompt.
- **Changing sessions**: Add a `ChangePlaygroundSession` command that clears the notebook's cached session and re-prompts on next execution. Register it as a notebook toolbar action so it's accessible from the notebook UI.
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

1. Run introspection via `session.executeRawQuery(getIntrospectionQuery())` — import `getIntrospectionQuery` from `graphql` package (already in devDependencies, webpack-bundled at runtime)
2. Write result to `.rewst/schema.json` in workspace root via `vscode.workspace.fs.writeFile`
3. The GraphQL LSP accepts JSON introspection results — no need to convert to SDL

`generateGraphQLConfig()`:

1. If `.graphqlrc.yml` doesn't exist in workspace root, create it with `schema: .rewst/schema.json`
2. If it exists, don't overwrite (user may have customized)

Triggers:

- On first playground open (if sessions exist)
- On `SessionManager.onSessionChange` events
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

		// Fire-and-forget schema generation
		if (SessionManager.hasActiveSessions()) {
			SchemaManager.generateSchema(SessionManager.getActiveSessions()[0]);
		}
	}
}
```

**`src/commands/notebook/ChangePlaygroundSession.ts`** — Create

Clears the active notebook's cached session metadata and re-prompts via `pickSession()`. Sets the new selection in notebook metadata. Shows notification confirming the switch.

**`src/commands/notebook/index.ts`** — Create barrel export (both commands)

**`src/commands/exportedCommands.ts`** — Add `export * from './notebook/index';`

### Step 6: Registration

**`src/extension.ts`** — Modify

After `CommandInitiater.registerCommands()`, register notebook infrastructure:

```typescript
context.subscriptions.push(vscode.workspace.registerNotebookSerializer('rewst-playground', new PlaygroundSerializer()));
context.subscriptions.push(new PlaygroundController());
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

Add to `commandPalette`:

```json
{
	"command": "rewst-buddy.prefix.OpenPlayground",
	"when": "rewst-buddy.anyActiveSessions"
}
```

### Step 7: Index File

**`src/notebook/index.ts`** — Create

```typescript
export { PlaygroundSerializer } from './PlaygroundSerializer';
export { PlaygroundController } from './PlaygroundController';
export { SchemaManager } from './SchemaManager';
```

## File Summary

| File                                               | Action                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `src/sessions/Session.ts`                          | Modify — add `client` field, `executeRawQuery()`, update return types |
| `src/sessions/SessionManager.ts`                   | Modify — pass `client` through `createSession()`                      |
| `src/sessions/Session.test.ts`                     | Create                                                                |
| `src/notebook/PlaygroundSerializer.ts`             | Create                                                                |
| `src/notebook/PlaygroundSerializer.test.ts`        | Create                                                                |
| `src/notebook/PlaygroundController.ts`             | Create                                                                |
| `src/notebook/PlaygroundController.test.ts`        | Create                                                                |
| `src/notebook/SchemaManager.ts`                    | Create                                                                |
| `src/notebook/SchemaManager.test.ts`               | Create                                                                |
| `src/notebook/index.ts`                            | Create                                                                |
| `src/commands/notebook/OpenPlayground.ts`          | Create                                                                |
| `src/commands/notebook/ChangePlaygroundSession.ts` | Create                                                                |
| `src/commands/notebook/index.ts`                   | Create                                                                |
| `src/commands/exportedCommands.ts`                 | Modify — add notebook export                                          |
| `src/extension.ts`                                 | Modify — register serializer, controller, schema manager              |
| `package.json`                                     | Modify — notebooks, command, menus                                    |

## Key Design Decisions

1. **Variables convention**: Controller reads the next cell after a query cell as variables if it's JSON. Simple, matches mental model from GraphQL tools.
2. **JSON schema over SDL**: Output `.rewst/schema.json` with raw introspection result. Avoids needing `buildClientSchema`/`printSchema` at runtime. GraphQL LSP accepts JSON introspection via `.graphqlrc.yml`.
3. **Transient by default**: `vscode.workspace.openNotebookDocument('rewst-playground', notebookData)` creates an untitled document. No file on disk until user saves.
4. **Session caching**: Stored in notebook metadata after first pick, so user isn't re-prompted on each execution.
5. **Fire-and-forget schema**: Schema generation doesn't block playground opening. If it fails, the playground still works without LSP completions.
6. **`graphql` package**: Already in devDependencies and webpack-bundled. `getIntrospectionQuery()` is available at runtime.

## Verification

1. `npm run compile` — builds without errors
2. `npm run test:unit` — all new and existing tests pass
3. Manual: Click sidebar button → untitled notebook opens with query + variables cells
4. Manual: Write a query, click Run → JSON output appears inline
5. Manual: Verify `.rewst/schema.json` generated, `.graphqlrc.yml` created
6. Manual: Save notebook as `.rewst-playground`, close and reopen, verify cells restore
7. Manual: With a GraphQL VS Code extension installed, verify completions work in query cells
