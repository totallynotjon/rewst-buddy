import type { Session } from '@sessions';
import { createMockSession, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { UnpackCrateInput } from './crateUnpack';
import { runUnpackCrate } from './unpackClient';

const { suite, test, setup, teardown } = Mocha;

const input: UnpackCrateInput = {
	crateId: 'crate-1',
	orgId: 'org-1',
	tokenArguments: [],
	triggers: [],
	workflow: { name: 'Installed Workflow', humanSecondsSaved: 0 },
};

const SUCCESS_EVENT = {
	__typename: 'UnpackCrateStreamSuccessResponse',
	didSucceed: true,
	isFinished: true,
	id: 'workflow-new',
	orgId: 'org-1',
	type: 'workflow',
};

function progressEvent(phase: string): unknown {
	return { __typename: 'CloningImportPhaseStreamMessage', phase, isFinished: false };
}

/** Overrides the session's secret read with a scripted cookie string. */
function stubCookies(session: Session, value: string): void {
	Object.defineProperty(session, 'getCookies', { configurable: true, value: async () => value });
}

/**
 * Controls one active `subscribe` from the client. `progress`/`success` wrap an
 * event as the `data.unpackCrate` payload the client yields; `raw` sends an
 * arbitrary Next payload (used for the partial-errors branch); `complete` ends
 * the stream.
 */
interface SubController {
	variables: unknown;
	progress(phase: string): void;
	success(event?: unknown): void;
	raw(payload: unknown): void;
	complete(): void;
}

interface FakeServer {
	url: string;
	/** Cookie header seen on each websocket upgrade, in connection order. */
	cookies: (string | undefined)[];
	/** Resolves once the server observes the client socket close (teardown). */
	socketClosed: Promise<void>;
}

/**
 * A minimal graphql-ws (`graphql-transport-ws`) server that speaks just enough
 * of the protocol to drive runUnpackCrate's real transport: ack the init, then
 * hand each subscribe to `onSubscribe` for scripting. Avoids a real GraphQL
 * schema while exercising the actual createClient + cookie-websocket path.
 */
function startFakeServer(onSubscribe: (ctrl: SubController) => void): Promise<FakeServer> {
	const wss = new WebSocketServer({ port: 0, handleProtocols: () => 'graphql-transport-ws' });
	const cookies: (string | undefined)[] = [];
	let markClosed: () => void = () => {};
	const socketClosed = new Promise<void>(resolve => {
		markClosed = resolve;
	});

	wss.on('connection', (socket: WsSocket, request) => {
		cookies.push(request.headers.cookie);
		socket.on('close', () => markClosed());
		socket.on('message', raw => {
			const msg = JSON.parse(raw.toString()) as { id?: string; type: string; payload?: { variables?: unknown } };
			const send = (type: string, payload?: unknown) => {
				if (socket.readyState !== socket.OPEN) return;
				socket.send(
					JSON.stringify(payload === undefined ? { id: msg.id, type } : { id: msg.id, type, payload }),
				);
			};
			if (msg.type === 'connection_init') {
				if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'connection_ack' }));
				return;
			}
			if (msg.type === 'ping') {
				if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'pong' }));
				return;
			}
			if (msg.type === 'subscribe') {
				onSubscribe({
					variables: msg.payload?.variables,
					progress: phase => send('next', { data: { unpackCrate: progressEvent(phase) } }),
					success: (event = SUCCESS_EVENT) => send('next', { data: { unpackCrate: event } }),
					raw: payload => send('next', payload),
					complete: () => send('complete'),
				});
			}
		});
	});

	return new Promise(resolve => {
		wss.on('listening', () => {
			openServers.push(wss);
			const { port } = wss.address() as AddressInfo;
			resolve({ url: `ws://127.0.0.1:${port}/subscriptions`, cookies, socketClosed });
		});
	});
}

const openServers: WebSocketServer[] = [];

/** Points a mock session's region at the local fake subscriptions endpoint. */
function pointSessionAt(session: Session, url: string): void {
	session.profile.region.subscriptionsUrl = url;
}

suite('Unit: runUnpackCrate transport boundaries', () => {
	setup(() => {
		initTestEnvironment();
	});

	teardown(async () => {
		await Promise.all(openServers.splice(0).map(wss => new Promise<void>(resolve => wss.close(() => resolve()))));
	});

	test('rejects an already-aborted install with a stable cancellation error and no progress', async () => {
		const { session } = createMockSession();
		stubCookies(session, 'cookie=value');
		const controller = new AbortController();
		controller.abort();
		const progress: string[] = [];

		await assert.rejects(
			() =>
				runUnpackCrate({
					session,
					input,
					signal: controller.signal,
					onProgress: label => progress.push(label),
				}),
			/Crate unpack was cancelled before it started/,
		);
		assert.deepStrictEqual(progress, []);
	});

	test('does not read secrets when the install is already aborted', async () => {
		const { session } = createMockSession();
		let cookieReads = 0;
		Object.defineProperty(session, 'getCookies', {
			configurable: true,
			value: async () => {
				cookieReads++;
				return 'cookie=value';
			},
		});
		const controller = new AbortController();
		controller.abort();

		// The assertions are deliberately DECOUPLED: the original test coupled the
		// secret-read count to the cancellation-message regex in one assert.rejects,
		// so a regression that read secrets early failed on a misleading message
		// mismatch instead of the real fault. We capture the rejection, then assert
		// the cancellation message and the secret-read count independently.
		//
		// Contract: a pre-aborted install must reject WITHOUT consulting secret
		// storage or constructing transport state — cancellation is cheap and must
		// not touch credentials.
		//
		// runUnpackCrate checks signal.aborted at the top of the function, before
		// getCookies and client creation, so a pre-aborted signal is caught before
		// any credentials are read or transport state is constructed.
		let error: unknown;
		try {
			await runUnpackCrate({ session, input, signal: controller.signal });
			assert.fail('runUnpackCrate should reject for an already-aborted signal');
		} catch (e) {
			error = e;
		}

		assert.match(
			(error as Error).message,
			/Crate unpack was cancelled before it started/,
			'a pre-aborted run rejects with the stable cancellation message',
		);
		assert.strictEqual(cookieReads, 0, 'a pre-aborted install must not consult secret storage');
	});

	suite('operational path', () => {
		test('streams progress, returns the unpacked outcome, and tears down the socket', async () => {
			const server = await startFakeServer(ctrl => {
				ctrl.progress('exporting');
				ctrl.progress('importing');
				ctrl.success();
				ctrl.complete();
			});
			const { session } = createMockSession();
			stubCookies(session, 'appSession=abc');
			pointSessionAt(session, server.url);
			const progress: string[] = [];

			const outcome = await runUnpackCrate({ session, input, onProgress: label => progress.push(label) });

			assert.deepStrictEqual(outcome, { id: 'workflow-new', orgId: 'org-1', type: 'workflow' });
			assert.deepStrictEqual(progress, ['exporting', 'importing']);
			await server.socketClosed; // finally teardown disposes the client on success
		});

		test('forwards a name=value cookie string verbatim in the websocket header', async () => {
			const server = await startFakeServer(ctrl => {
				ctrl.success();
				ctrl.complete();
			});
			const { session } = createMockSession();
			stubCookies(session, 'appSession=session-token');
			pointSessionAt(session, server.url);

			await runUnpackCrate({ session, input });

			assert.strictEqual(server.cookies[0], 'appSession=session-token');
		});

		test('wraps a bare token in the region cookie name for the websocket header', async () => {
			const server = await startFakeServer(ctrl => {
				ctrl.success();
				ctrl.complete();
			});
			const { session } = createMockSession();
			// mock region cookieName is 'test_cookie'; a bare token has no '='.
			stubCookies(session, 'bare-token-123');
			pointSessionAt(session, server.url);

			await runUnpackCrate({ session, input });

			assert.strictEqual(server.cookies[0], 'test_cookie=bare-token-123');
		});

		test('throws with the GraphQL errors and tears down when a payload carries errors', async () => {
			const server = await startFakeServer(ctrl => {
				ctrl.raw({ errors: [{ message: 'crate not found' }, { message: 'access denied' }] });
			});
			const { session } = createMockSession();
			stubCookies(session, 'appSession=abc');
			pointSessionAt(session, server.url);

			await assert.rejects(
				() => runUnpackCrate({ session, input }),
				/GraphQL error: crate not found; access denied/,
			);
			await server.socketClosed; // teardown also runs on the failure path
		});

		test('throws the server failure and tears down when the stream reports a failure event', async () => {
			const server = await startFakeServer(ctrl => {
				ctrl.progress('exporting');
				ctrl.success({
					__typename: 'ExportDownloadPhaseStreamFailureResponse',
					didSucceed: false,
					isFinished: true,
					error: 'export archive missing',
					phase: 'export',
				});
			});
			const { session } = createMockSession();
			stubCookies(session, 'appSession=abc');
			pointSessionAt(session, server.url);

			await assert.rejects(
				() => runUnpackCrate({ session, input }),
				/Crate unpack failed: export archive missing/,
			);
			await server.socketClosed;
		});

		test('aborting mid-stream stops the run, rejects, and disposes the transport', async () => {
			const server = await startFakeServer(ctrl => {
				// One progress event, then the server intentionally never terminates;
				// the client-side abort is what ends the stream.
				ctrl.progress('exporting');
			});
			const { session } = createMockSession();
			stubCookies(session, 'appSession=abc');
			pointSessionAt(session, server.url);

			const controller = new AbortController();
			const progress: string[] = [];

			await assert.rejects(() =>
				runUnpackCrate({
					session,
					input,
					signal: controller.signal,
					onProgress: label => {
						progress.push(label);
						controller.abort();
					},
				}),
			);

			assert.deepStrictEqual(progress, ['exporting'], 'abort stops the stream after the first payload');
			await server.socketClosed; // aborting tore down the websocket
		});

		test('passes the unpack input through as the subscription variables', async () => {
			let seen: unknown;
			const server = await startFakeServer(ctrl => {
				seen = ctrl.variables;
				ctrl.success();
				ctrl.complete();
			});
			const { session } = createMockSession();
			stubCookies(session, 'appSession=abc');
			pointSessionAt(session, server.url);

			await runUnpackCrate({ session, input });

			assert.deepStrictEqual(seen, { unpackingArguments: input });
		});
	});
});
