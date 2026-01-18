import vscode from 'vscode';
import { log } from '@utils';

/**
 * Creates a mock VS Code ExtensionContext for testing.
 * Uses in-memory storage for globalState and secrets.
 */
export function createMockContext(): vscode.ExtensionContext {
	const globalStateMap = new Map<string, unknown>();
	const secretsMap = new Map<string, string>();

	const globalState: vscode.Memento & { setKeysForSync: (keys: readonly string[]) => void } = {
		keys: () => Array.from(globalStateMap.keys()),
		get<T>(key: string, defaultValue?: T): T | undefined {
			const value = globalStateMap.get(key);
			return value !== undefined ? (value as T) : defaultValue;
		},
		async update(key: string, value: unknown): Promise<void> {
			if (value === undefined) {
				globalStateMap.delete(key);
			} else {
				globalStateMap.set(key, value);
			}
		},
		setKeysForSync: () => {},
	};

	const secrets: vscode.SecretStorage = {
		keys: async () => Array.from(secretsMap.keys()),
		get: async (key: string) => secretsMap.get(key),
		store: async (key: string, value: string) => {
			secretsMap.set(key, value);
		},
		delete: async (key: string) => {
			secretsMap.delete(key);
		},
		onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
	};

	const subscriptions: vscode.Disposable[] = [];

	return {
		subscriptions,
		workspaceState: globalState,
		globalState,
		secrets,
		extensionUri: vscode.Uri.file('/mock/extension'),
		extensionPath: '/mock/extension',
		environmentVariableCollection: {} as vscode.GlobalEnvironmentVariableCollection,
		storagePath: '/mock/storage',
		storageUri: vscode.Uri.file('/mock/storage'),
		globalStoragePath: '/mock/globalStorage',
		globalStorageUri: vscode.Uri.file('/mock/globalStorage'),
		logPath: '/mock/logs',
		logUri: vscode.Uri.file('/mock/logs'),
		extensionMode: vscode.ExtensionMode.Test,
		extension: {} as vscode.Extension<unknown>,
		languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
		asAbsolutePath: (relativePath: string) => `/mock/extension/${relativePath}`,
	};
}

/**
 * Helper to get the underlying map from a mock globalState for assertions.
 */
export function getMockGlobalStateMap(context: vscode.ExtensionContext): Map<string, unknown> {
	const entries: [string, unknown][] = context.globalState.keys().map(key => [key, context.globalState.get(key)]);
	return new Map(entries);
}

/**
 * Clears all data from the mock context's storage.
 */
export function clearMockContext(context: vscode.ExtensionContext): void {
	for (const key of context.globalState.keys()) {
		context.globalState.update(key, undefined);
	}
}

/**
 * Initialize the test environment with mock context and logger.
 * Call this in test setup (before/beforeEach).
 */
export function initTestEnvironment(): vscode.ExtensionContext {
	const mockContext = createMockContext();
	// Use dynamic import pattern that works at runtime after context proxy is created
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { context } = require('@global');
	context.init(mockContext);
	log.init();
	return mockContext;
}
