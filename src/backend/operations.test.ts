import { getBackendServerDelegate } from '../server/backendDelegate';
import { beforeEach as vitestBeforeEach, expect, vi } from 'vitest';
import { setup as beforeEach, suite as describe, test as it } from '../test/tdd';
import { cachedResources, cachedTools, initializeBackend, invoke } from './operations';

type AsyncMock = ReturnType<typeof vi.fn> & ((...args: unknown[]) => Promise<unknown>);

const mocks = vi.hoisted(() => {
	const servers: { close: ReturnType<typeof vi.fn>; notification: ReturnType<typeof vi.fn> }[] = [];
	const pairs: { clientClosed: number; serverClosed: number }[] = [];
	const order: string[] = [];
	const refreshDefinition = vi.fn();
	const runtime = {
		start: vi.fn(async () => {
			order.push('runtime.start');
		}),
		stop: vi.fn(async () => {
			order.push('runtime.stop');
		}),
	};
	const activeProfiles: unknown[] = [];
	const knownProfiles: unknown[] = [];
	const clients: { close: AsyncMock; callTool: AsyncMock }[] = [];
	const transports: {
		close: ReturnType<typeof vi.fn>;
		terminateSession: ReturnType<typeof vi.fn>;
		onclose?: () => void;
		onerror?: (error: Error) => void;
	}[] = [];
	const shared = {
		discover: vi.fn(async () => undefined as SharedDescriptor | undefined),
		start: vi.fn(async () => {
			order.push('shared.start');
			const handle = {
				descriptor: shared.descriptor,
				close: vi.fn(async () => {
					order.push('shared.close');
				}),
				setPublicToken: vi.fn(async () => {}),
			};
			shared.handles.push(handle);
			return handle;
		}),
		descriptor: {
			identity: 'rewst-buddy',
			protocol: 1,
			version: 'test',
			instanceId: 'owner-1',
			port: 27121,
			publicToken: 'public-token',
			editorToken: 'editor-token',
		} as SharedDescriptor,
		handles: [] as { close: ReturnType<typeof vi.fn> }[],
		listeners: 0,
		config: { serverEnabled: true, mcpEnabled: true, port: 27121 },
	};
	let sharedConnection: unknown;
	let connectGate: Promise<void> | undefined;
	return {
		refreshDefinition,
		servers,
		pairs,
		clients,
		transports,
		order,
		runtime,
		activeProfiles,
		knownProfiles,
		shared,
		get sharedConnection() {
			return sharedConnection;
		},
		set sharedConnection(value: unknown) {
			sharedConnection = value;
		},
		get connectGate() {
			return connectGate;
		},
		set connectGate(value: Promise<void> | undefined) {
			connectGate = value;
		},
	};
});

interface SharedDescriptor {
	identity: string;
	protocol: number;
	version: string;
	instanceId: string;
	port: number;
	publicToken: string;
	editorToken: string;
}

vi.mock('vscode', () => {
	class EventEmitter<T> {
		readonly event = () => ({ dispose() {} });
		fire(_event: T): void {}
	}
	const configuration = { get: <T>(_key: string, fallback: T): T => fallback };
	const disposable = () => ({ dispose() {} });
	const value = {
		EventEmitter,
		workspace: {
			getConfiguration: (section = '') => ({
				get: <T>(key: string, fallback: T): T => {
					if (section === 'rewst-buddy.server' && key === 'enabled')
						return mocks.shared.config.serverEnabled as T;
					if (section === 'rewst-buddy.server' && key === 'port') return mocks.shared.config.port as T;
					if (section === 'rewst-buddy.server' && key === 'host') return '127.0.0.1' as T;
					if (section === 'rewst-buddy.mcp' && key === 'enable') return mocks.shared.config.mcpEnabled as T;
					return fallback;
				},
			}),
			onDidChangeConfiguration: disposable,
		},
		window: {
			showInputBox: async () => undefined,
			showErrorMessage: async () => undefined,
			showWarningMessage: async () => undefined,
			showInformationMessage: async () => undefined,
		},
		commands: { executeCommand: async () => undefined },
	};
	return { default: value, ...value };
});

vi.mock('../mcp/McpDefinitionProvider', () => ({ McpDefinitionProvider: { refresh: mocks.refreshDefinition } }));

vi.mock('@global', () => ({
	context: {
		globalState: { get: <T>(_key: string, fallback: T): T => fallback, update: async () => {} },
		secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
	},
	extPrefix: 'rewst-buddy',
}));

vi.mock('@utils', () => ({
	log: {
		trace() {},
		debug() {},
		info() {},
		warn() {},
		error() {},
		notifyError() {},
		notifyInfo() {},
		notifyWarn() {},
	},
}));
vi.mock('../../packages/mcp-server/src/runtime', () => ({
	startRuntime: mocks.runtime.start,
	stopRuntime: mocks.runtime.stop,
}));
vi.mock('../../packages/mcp-server/src/sessions/SessionManager', () => ({
	SessionManager: {
		onSessionChange: () => {
			mocks.shared.listeners++;
			return { dispose: () => mocks.shared.listeners-- };
		},
		getActiveSessions: () => mocks.activeProfiles.map(profile => ({ profile })),
		getAllKnownProfiles: () => mocks.knownProfiles,
	},
}));
vi.mock('../../packages/mcp-server/src/models/WorkingScopeManager', () => ({
	WorkingScopeManager: {
		onDidChangeScope: () => {
			mocks.shared.listeners++;
			return { dispose: () => mocks.shared.listeners-- };
		},
	},
}));
vi.mock('../../packages/mcp-server/src/sharedDiscovery', () => ({
	discoverSharedServer: mocks.shared.discover,
}));
vi.mock('../../packages/mcp-server/src/sharedHttp', () => ({
	startSharedHttpServer: mocks.shared.start,
}));
vi.mock('../../packages/mcp-server/src/editorBridge', () => ({
	broadcastEditorEvent: vi.fn(),
	hasRequestingEditor: () => false,
	requestAttachedEditor: vi.fn(),
	createSharedEditorServer: vi.fn(),
	handleSharedBrowserAction: vi.fn(),
}));
vi.mock('./sharedConnection', () => ({
	setSharedConnection: (value: unknown) => {
		mocks.sharedConnection = value;
	},
	getSharedConnection: () => mocks.sharedConnection,
	assertCanRotateSharedToken: vi.fn(),
	updateSharedToken: vi.fn(),
}));
vi.mock('./editorHost', () => ({
	installEditorHost: vi.fn(),
	getEditorCapabilities: vi.fn(() => []),
}));
vi.mock('../../packages/mcp-server/src/editorOperations', () => ({
	createEditorTool: () => ({}),
	scopeSnapshot: () => ({}),
}));
vi.mock('../../packages/mcp-server/src/mcpServer', () => ({
	createMcpServer: () => {
		const server = {
			connect: vi.fn(async () => {}),
			close: vi.fn(async () => {}),
			notification: vi.fn(async () => {}),
		};
		mocks.servers.push(server);
		return server;
	},
}));
vi.mock('@modelcontextprotocol/sdk/inMemory.js', () => ({
	InMemoryTransport: {
		createLinkedPair: () => {
			const pair = { clientClosed: 0, serverClosed: 0 };
			mocks.pairs.push(pair);
			return [
				{
					close: async () => {
						pair.clientClosed++;
					},
					start: async () => {},
				},
				{
					close: async () => {
						pair.serverClosed++;
					},
					start: async () => {},
				},
			];
		},
	},
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
	Client: class {
		private readonly state: { close: AsyncMock; callTool: AsyncMock };
		constructor() {
			this.state = {
				close: vi.fn(async () => {}) as AsyncMock,
				callTool: vi.fn(async () => ({ structuredContent: { result: [] } })) as AsyncMock,
			};
			mocks.clients.push(this.state);
		}
		setNotificationHandler(): void {}
		async connect(): Promise<void> {
			if (mocks.connectGate) await mocks.connectGate;
		}
		async close(): Promise<void> {
			await this.state.close();
		}
		async callTool(...args: unknown[]): Promise<unknown> {
			return this.state.callTool(...args);
		}
	},
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
	StreamableHTTPClientTransport: class {
		readonly close = vi.fn(async () => {});
		readonly terminateSession = vi.fn(async () => {});
		onclose?: () => void;
		onerror?: (error: Error) => void;
		constructor() {
			mocks.transports.push(this);
		}
	},
}));

function resetMocks(): void {
	mocks.refreshDefinition.mockClear();
	mocks.shared.config.port = 27121;
	mocks.runtime.start.mockClear();
	mocks.runtime.stop.mockClear();
	mocks.order.length = 0;
	mocks.servers.length = 0;
	mocks.pairs.length = 0;
	mocks.clients.length = 0;
	mocks.transports.length = 0;
	mocks.shared.handles.length = 0;
	mocks.shared.listeners = 0;
	mocks.sharedConnection = undefined;
	mocks.shared.config.serverEnabled = true;
	mocks.shared.config.mcpEnabled = true;
	mocks.shared.discover.mockReset();
	mocks.shared.discover.mockResolvedValue(undefined);
	mocks.shared.start.mockReset();
	mocks.shared.start.mockImplementation(async () => {
		mocks.order.push('shared.start');
		const handle = {
			descriptor: mocks.shared.descriptor,
			close: vi.fn(async () => {
				mocks.order.push('shared.close');
			}),
			setPublicToken: vi.fn(async () => {}),
		};
		mocks.shared.handles.push(handle);
		return handle;
	});
	mocks.activeProfiles.length = 0;
	mocks.knownProfiles.length = 0;
	mocks.connectGate = undefined;
}

describe('embedded backend lifecycle', () => {
	beforeEach(() => {
		resetMocks();
	});

	it('closes both linked transports when disposal races connection setup', async () => {
		let release!: () => void;
		mocks.connectGate = new Promise<void>(resolve => {
			release = resolve;
		});
		const disposable = initializeBackend({ shared: false });
		disposable.dispose();
		release();
		await new Promise(resolve => setImmediate(resolve));
		await new Promise(resolve => setImmediate(resolve));
		mocks.connectGate = undefined;
		expect(mocks.pairs.at(-1)?.clientClosed).toBeGreaterThan(0);
		expect(mocks.pairs.at(-1)?.serverClosed).toBeGreaterThan(0);
		expect(mocks.runtime.stop).toHaveBeenCalled();
	});

	it('clears catalogs on dispose and starts a replacement after shutdown', async () => {
		const first = initializeBackend({ shared: false });
		await new Promise(resolve => setImmediate(resolve));
		first.dispose();
		const second = initializeBackend({ shared: false });
		await new Promise(resolve => setImmediate(resolve));
		expect(mocks.runtime.start).toHaveBeenCalledTimes(2);
		expect(mocks.runtime.stop).toHaveBeenCalled();
		expect(cachedTools()).toEqual([]);
		expect(cachedResources()).toEqual([]);
		second.dispose();
		await new Promise(resolve => setImmediate(resolve));
	});

	it('publishes restored sessions after the connection is installed', async () => {
		const profile = { user: { id: 'user-1' } };
		mocks.activeProfiles.push(profile);
		mocks.knownProfiles.push(profile);
		const disposable = initializeBackend({ shared: false });
		await new Promise(resolve => setImmediate(resolve));
		await new Promise(resolve => setImmediate(resolve));
		const notification = mocks.servers
			.at(-1)
			?.notification.mock.calls.map(
				([value]) => value as { params?: { event?: { type?: string; snapshot?: unknown } } },
			)
			.find(value => value.params?.event?.type === 'sessions');
		expect(notification?.params?.event?.snapshot).toMatchObject({
			sessions: [{ sessionId: 'user-1', profile }],
			knownProfiles: [profile],
		});
		disposable.dispose();
		await new Promise(resolve => setImmediate(resolve));
	});
});

describe('shared backend lifecycle', () => {
	vitestBeforeEach(() => {
		resetMocks();
	});

	it('attaches to a verified existing owner without starting local services', async () => {
		mocks.shared.discover.mockResolvedValue(mocks.shared.descriptor);

		const disposable = initializeBackend();
		await new Promise(resolve => setImmediate(resolve));
		await vi.waitFor(() => expect(mocks.transports).toHaveLength(1));

		expect(mocks.refreshDefinition).toHaveBeenCalledTimes(1);
		expect(mocks.sharedConnection).toMatchObject({ descriptor: mocks.shared.descriptor, owned: false });
		expect(mocks.shared.start).not.toHaveBeenCalled();
		expect(mocks.runtime.start).not.toHaveBeenCalled();
		expect(mocks.shared.listeners).toBe(0);

		disposable.dispose();
		await new Promise(resolve => setImmediate(resolve));
		expect(mocks.transports[0]?.terminateSession).toHaveBeenCalled();
		expect(mocks.transports[0]?.close).toHaveBeenCalled();
		expect(mocks.runtime.stop).not.toHaveBeenCalled();
	});

	it('does not promote a remote connection when the owner closes during editor attachment', async () => {
		mocks.shared.discover.mockResolvedValue(mocks.shared.descriptor);
		let releaseConnect!: () => void;
		mocks.connectGate = new Promise<void>(resolve => {
			releaseConnect = resolve;
		});
		const disposable = initializeBackend();
		await vi.waitFor(() => expect(mocks.transports).toHaveLength(1));
		mocks.clients[0]?.callTool.mockImplementation(async () => {
			// The attach request is still pending when the owner transport closes.
			mocks.transports[0]?.onclose?.();
			return { structuredContent: { result: [] } };
		});

		releaseConnect();
		await expect(invoke('tools.list', {})).rejects.toThrow(/disconnected during editor attachment/);
		expect(getBackendServerDelegate()?.getStatus()).toBe(false);
		expect(mocks.sharedConnection).toBeUndefined();

		disposable.dispose();
		await new Promise(resolve => setImmediate(resolve));
	});

	it('clears the attached editor state when the owner transport closes unexpectedly', async () => {
		mocks.shared.discover.mockResolvedValue(mocks.shared.descriptor);
		const disposable = initializeBackend();
		await vi.waitFor(() => expect(mocks.transports).toHaveLength(1));
		await vi.waitFor(() => expect(mocks.sharedConnection).toMatchObject({ owned: false }));

		mocks.transports[0]?.onclose?.();
		expect(cachedTools()).toEqual([]);
		expect(cachedResources()).toEqual([]);
		await expect(invoke('tools.list', {})).rejects.toThrow(/has not been initialized/);

		disposable.dispose();
		await new Promise(resolve => setImmediate(resolve));
	});

	it('clears the attached editor state when owner reconnects are exhausted', async () => {
		mocks.shared.discover.mockResolvedValue(mocks.shared.descriptor);
		const disposable = initializeBackend();
		await vi.waitFor(() => expect(mocks.transports).toHaveLength(1));
		await vi.waitFor(() => expect(mocks.sharedConnection).toMatchObject({ owned: false }));

		mocks.transports[0]?.onerror?.(new Error('Maximum reconnection attempts (0) exceeded.'));
		expect(cachedTools()).toEqual([]);
		expect(cachedResources()).toEqual([]);
		expect(mocks.sharedConnection).toBeUndefined();
		expect(getBackendServerDelegate()?.getStatus()).toBe(false);
		await expect(invoke('tools.list', {})).rejects.toThrow(/has not been initialized/);

		disposable.dispose();
		await new Promise(resolve => setImmediate(resolve));
	});

	it('refuses to bind a replacement listener after the attached owner disconnects', async () => {
		mocks.shared.discover.mockResolvedValue(mocks.shared.descriptor);
		const disposable = initializeBackend();
		await vi.waitFor(() => expect(mocks.transports).toHaveLength(1));
		await vi.waitFor(() => expect(mocks.sharedConnection).toMatchObject({ owned: false }));

		mocks.transports[0]?.onclose?.();
		const started = await getBackendServerDelegate()?.start();
		expect(started).toBe(false);
		expect(mocks.shared.start).not.toHaveBeenCalled();
		expect(mocks.runtime.start).not.toHaveBeenCalled();
		expect(getBackendServerDelegate()?.getStatus()).toBe(false);

		disposable.dispose();
		await new Promise(resolve => setImmediate(resolve));
	});

	it('does not fall back to a local runtime when discovery cannot verify the owner', async () => {
		mocks.shared.discover.mockRejectedValue(new Error('invalid shared-server proof'));

		const disposable = initializeBackend();
		await new Promise(resolve => setImmediate(resolve));
		await new Promise(resolve => setImmediate(resolve));

		expect(mocks.shared.start).not.toHaveBeenCalled();
		expect(mocks.runtime.start).not.toHaveBeenCalled();
		expect(mocks.shared.listeners).toBe(0);
		disposable.dispose();
	});

	it('claims the shared listener before starting the local runtime when no owner exists', async () => {
		const disposable = initializeBackend();
		await vi.waitFor(() => expect(mocks.runtime.start).toHaveBeenCalled());

		expect(mocks.shared.start).toHaveBeenCalledTimes(1);
		expect(mocks.order.indexOf('shared.start')).toBeLessThan(mocks.order.indexOf('runtime.start'));
		expect(mocks.shared.listeners).toBe(2);

		disposable.dispose();
		await new Promise(resolve => setImmediate(resolve));
		expect(mocks.shared.handles[0]?.close).toHaveBeenCalled();
		expect(mocks.runtime.stop).toHaveBeenCalled();
	});

	it('attaches to a verified winner after an EADDRINUSE race without starting local services', async () => {
		let discoveryCount = 0;
		mocks.shared.discover.mockImplementation(async () => {
			discoveryCount++;
			return discoveryCount === 1 ? undefined : mocks.shared.descriptor;
		});
		mocks.shared.start.mockRejectedValueOnce(
			Object.assign(new Error('port already in use'), { code: 'EADDRINUSE' }),
		);

		const disposable = initializeBackend();
		await vi.waitFor(() => expect(mocks.transports).toHaveLength(1), { timeout: 2_000 });

		expect(mocks.shared.start).toHaveBeenCalledTimes(1);
		expect(discoveryCount).toBeGreaterThanOrEqual(2);
		expect(mocks.runtime.start).not.toHaveBeenCalled();
		expect(mocks.shared.listeners).toBe(0);

		disposable.dispose();
		await new Promise(resolve => setImmediate(resolve));
		expect(mocks.transports[0]?.terminateSession).toHaveBeenCalled();
	});

	it('waits for an owned server teardown before claiming a replacement', async () => {
		const first = initializeBackend();
		await vi.waitFor(() => expect(mocks.runtime.start).toHaveBeenCalledTimes(1));
		const firstHandle = mocks.shared.handles[0];
		expect(firstHandle).toBeDefined();

		let releaseClose!: () => void;
		const closeGate = new Promise<void>(resolve => {
			releaseClose = resolve;
		});
		firstHandle!.close.mockImplementation(async () => {
			mocks.order.push('shared.close.begin');
			await closeGate;
			mocks.order.push('shared.close.end');
		});

		first.dispose();
		const second = initializeBackend();
		await new Promise(resolve => setImmediate(resolve));
		await new Promise(resolve => setImmediate(resolve));

		// The first owner still holds the listener, so the replacement must not
		// probe, bind, or start its runtime until that close has completed.
		expect(mocks.shared.discover).toHaveBeenCalledTimes(1);
		expect(mocks.shared.start).toHaveBeenCalledTimes(1);
		expect(mocks.runtime.start).toHaveBeenCalledTimes(1);

		releaseClose();
		await vi.waitFor(() => expect(mocks.runtime.start).toHaveBeenCalledTimes(2));
		expect(mocks.shared.start).toHaveBeenCalledTimes(2);
		expect(await invoke('tools.list', {})).toEqual([]);

		second.dispose();
		await new Promise(resolve => setImmediate(resolve));
	});
});

describe('configured listener port', () => {
	vitestBeforeEach(resetMocks);
	it('reads the current port on delayed start and restart', async () => {
		mocks.shared.config.serverEnabled = false;
		mocks.shared.config.mcpEnabled = false;
		const backend = initializeBackend();
		try {
			await invoke('tools.list', {});
			expect(mocks.shared.start).not.toHaveBeenCalled();
			mocks.shared.config.port = 28121;
			await getBackendServerDelegate()!.start();
			expect(mocks.shared.start).toHaveBeenLastCalledWith(expect.objectContaining({ port: 28121 }));
			await getBackendServerDelegate()!.stop();
			mocks.shared.config.port = 29121;
			await getBackendServerDelegate()!.start();
			expect(mocks.shared.start).toHaveBeenLastCalledWith(expect.objectContaining({ port: 29121 }));
		} finally {
			backend.dispose();
			await new Promise(resolve => setImmediate(resolve));
		}
	});
	it('preserves an explicit port override', async () => {
		const backend = initializeBackend({ port: 30121 });
		try {
			await invoke('tools.list', {});
			await getBackendServerDelegate()!.stop();
			mocks.shared.config.port = 29121;
			await getBackendServerDelegate()!.start();
			expect(mocks.shared.start).toHaveBeenLastCalledWith(expect.objectContaining({ port: 30121 }));
		} finally {
			backend.dispose();
			await new Promise(resolve => setImmediate(resolve));
		}
	});
});
