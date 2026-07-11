import { initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import CookieString from './CookieString';
import { getRegionConfigs, getSubscriptionsUrl, type RegionConfig } from './RegionConfig';

const { suite, test, setup, teardown } = Mocha;

interface Restore {
	restore(): void;
}

function stub<T extends object, K extends keyof T>(object: T, key: K, value: T[K]): Restore {
	const original = object[key];
	Object.defineProperty(object, key, { configurable: true, writable: true, value });
	return {
		restore() {
			Object.defineProperty(object, key, { configurable: true, writable: true, value: original });
		},
	};
}

function region(overrides: Partial<RegionConfig> = {}): RegionConfig {
	return {
		name: 'Test',
		cookieName: 'appSession',
		graphqlUrl: 'https://api.example.test/graphql',
		loginUrl: 'https://app.example.test',
		...overrides,
	};
}

suite('Unit: session configuration boundaries', () => {
	const restores: Restore[] = [];

	setup(() => {
		initTestEnvironment();
	});

	teardown(() => {
		while (restores.length) restores.pop()!.restore();
	});

	suite('CookieString', () => {
		test('retains the exact cookie string supplied by a browser flow', () => {
			const cookie = new CookieString('appSession=header.payload=signature; Path=/');
			assert.strictEqual(cookie.value, 'appSession=header.payload=signature; Path=/');
		});

		test('builds a cookie using the configured regional cookie name', () => {
			assert.strictEqual(
				CookieString.fromToken('token-value', region({ cookieName: 'euSession' })).value,
				'euSession=token-value',
			);
		});

		test('does not trim or transform opaque token bytes', () => {
			assert.strictEqual(CookieString.fromToken('  abc=def  ', region()).value, 'appSession=  abc=def  ');
		});

		test('allows an empty token to remain distinguishable from a missing cookie object', () => {
			assert.strictEqual(CookieString.fromToken('', region()).value, 'appSession=');
		});
	});

	suite('getSubscriptionsUrl()', () => {
		test('derives secure and insecure websocket schemes from GraphQL URLs', () => {
			assert.strictEqual(getSubscriptionsUrl(region()), 'wss://api.example.test/subscriptions');
			assert.strictEqual(
				getSubscriptionsUrl(region({ graphqlUrl: 'http://localhost:4000/graphql' })),
				'ws://localhost:4000/subscriptions',
			);
		});

		test('honors an explicitly configured subscriptions endpoint verbatim', () => {
			assert.strictEqual(
				getSubscriptionsUrl(region({ subscriptionsUrl: 'wss://events.example.test/custom' })),
				'wss://events.example.test/custom',
			);
		});

		test('tolerates a trailing slash on a configured GraphQL endpoint', () => {
			assert.strictEqual(
				getSubscriptionsUrl(region({ graphqlUrl: 'https://api.example.test/graphql/' })),
				'wss://api.example.test/subscriptions',
			);
		});

		test('replaces the GraphQL path without leaking its query string to the websocket endpoint', () => {
			// Decision: the websocket subscriptions endpoint is derived structurally
			// from the GraphQL host and must NOT inherit the GraphQL HTTP query string
			// — a tenant/session selector meant for the HTTP resolver has no defined
			// meaning on the WS upgrade and could mis-route the subscription. No shipped
			// region config relies on a graphqlUrl query param: the built-in North
			// America default (RegionConfig.ts and the package.json `rewst-buddy.regions`
			// default) uses a bare `https://api.rewst.io/graphql`, so dropping any query
			// string can never discard configuration a real region depends on.
			assert.strictEqual(
				getSubscriptionsUrl(region({ graphqlUrl: 'https://api.example.test/graphql?tenant=one' })),
				'wss://api.example.test/subscriptions',
			);
		});
	});

	suite('getRegionConfigs()', () => {
		test('returns every configured region in configured order', () => {
			const configured = [region({ name: 'North America' }), region({ name: 'Europe', cookieName: 'euSession' })];
			restores.push(
				stub(vscode.workspace, 'getConfiguration', ((section: string) => {
					assert.strictEqual(section, 'rewst-buddy');
					return { get: () => configured };
				}) as unknown as typeof vscode.workspace.getConfiguration),
			);

			assert.deepStrictEqual(getRegionConfigs(), configured);
		});

		test('uses the built-in North America region when the setting is absent', () => {
			restores.push(
				stub(vscode.workspace, 'getConfiguration', (() => ({
					get: (_key: string, fallback: RegionConfig[]) => fallback,
				})) as unknown as typeof vscode.workspace.getConfiguration),
			);

			assert.deepStrictEqual(getRegionConfigs(), [
				{
					name: 'North America',
					cookieName: 'appSession',
					graphqlUrl: 'https://api.rewst.io/graphql',
					loginUrl: 'https://app.rewst.io',
				},
			]);
		});

		test('rejects an explicitly empty region list before session creation can begin', () => {
			restores.push(
				stub(vscode.workspace, 'getConfiguration', (() => ({
					get: () => [],
				})) as unknown as typeof vscode.workspace.getConfiguration),
			);

			assert.throws(() => getRegionConfigs(), /No regions were found/);
		});
	});
});
