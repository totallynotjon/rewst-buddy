# Rewst Buddy VS Code Extension

VS Code extension for managing Rewst templates locally. Users link local files to Rewst templates, edit in VS Code, and sync changes back to Rewst with conflict detection.

## Directory Structure

```
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
├── mcp/               # MCP server for AI assistant integration
│   ├── McpServer.ts           # MCP server singleton + tool registration
│   ├── McpTransport.ts        # Streamable HTTP transport handler
│   └── tools/                 # Tool implementations
│       ├── resolveSession.ts  # Session resolution helper
│       ├── schemas.ts         # Zod input schemas
│       ├── sessionTools.ts    # rewst_list_sessions
│       ├── templateTools.ts   # Template CRUD tools
│       ├── userTools.ts       # rewst_get_current_user
│       └── graphqlTools.ts    # rewst_introspect_schema, rewst_execute_graphql
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
| `@mcp`      | `src/mcp/index.ts`         | MCP server         |

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

## Testing

**IMPORTANT: All new features must include tests.** When implementing new functionality, add corresponding unit tests (and integration tests if the feature involves API calls).

### Running Tests

```bash
npm test              # Run all tests
npm run test:unit     # Run unit tests only (no auth required)
npm run test:integration  # Run integration tests (requires REWST_TEST_TOKEN)
```

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

**MANDATORY:** All new features must include tests. When implementing new functionality:

### 1. Plan for Testability

Before writing code, consider:

- What external dependencies does this feature have? (SDK calls, file system, VS Code APIs)
- How can I structure this code to be easily testable?
- What edge cases need testing?

**Testability Patterns:**

- **Dependency Injection**: Accept dependencies as parameters rather than importing directly
- **Separation of Concerns**: Separate business logic from VS Code UI interactions
- **Event-Driven**: Use event emitters for reactive updates (easier to test than direct calls)

### 2. Write Tests Alongside Implementation

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
