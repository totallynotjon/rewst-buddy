import { getSubscriptionsUrl, type RegionConfig, type Session } from '@sessions';
import { log } from '@utils';
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import {
	collectUnpackOutcome,
	UNPACK_CRATE_SUBSCRIPTION,
	type UnpackCrateInput,
	type UnpackSuccess,
} from './crateUnpack';

/**
 * Transport wiring for the unpackCrate subscription. Unpacking a crate is a
 * GraphQL *subscription*, not a mutation — the server streams export/import
 * progress and finishes with a success or failure event — so this rides the
 * same graphql-ws + cookie websocket stack as the Rewst AI conversation client.
 * All decision logic lives in crateUnpack.ts; this file only moves bytes.
 */

// Secrets hold whatever cookie string validated at session creation — either a
// full "name=value" cookie or a bare token (same convention as ConversationClient).
function toCookieHeader(stored: string, region: RegionConfig): string {
	return stored.includes('=') ? stored : `${region.cookieName}=${stored}`;
}

interface SubscriptionResult {
	data?: { unpackCrate?: unknown } | null;
	errors?: readonly { message: string }[];
}

async function* payloadsOf(results: AsyncIterable<SubscriptionResult>): AsyncIterable<unknown> {
	for await (const result of results) {
		if (result.errors?.length) {
			throw new Error(`GraphQL error: ${result.errors.map(e => e.message).join('; ')}`);
		}
		yield result.data?.unpackCrate;
	}
}

export interface UnpackTransportOptions {
	session: Session;
	input: UnpackCrateInput;
	onProgress?: (label: string) => void;
	inactivityTimeoutMs?: number;
}

/**
 * Runs one unpackCrate subscription to completion: resolves with the unpacked
 * object (its id is the new workflow) or throws with the server's failure.
 */
export async function runUnpackCrate(options: UnpackTransportOptions): Promise<UnpackSuccess> {
	const { session } = options;
	const cookie = toCookieHeader(await session.getCookies(), session.profile.region);
	const url = getSubscriptionsUrl(session.profile.region);

	class CookieWebSocket extends WebSocket {
		constructor(address: string | URL, protocols?: string | string[]) {
			super(address, protocols, { headers: { cookie } });
		}
	}

	const client = createClient({
		url,
		webSocketImpl: CookieWebSocket,
		retryAttempts: 0,
		lazy: true,
		on: {
			connected: () => log.debug('unpackCrate: ws connected', { url }),
			closed: () => log.debug('unpackCrate: ws closed'),
			error: err => log.debug('unpackCrate: ws error', err),
		},
	});

	const dispose = () => {
		Promise.resolve(client.dispose()).catch(() => {});
	};

	log.debug('unpackCrate: starting subscription', {
		crateId: options.input.crateId,
		orgId: options.input.orgId,
		workflowName: options.input.workflow.name,
	});

	try {
		const results = client.iterate<SubscriptionResult['data']>({
			query: UNPACK_CRATE_SUBSCRIPTION,
			variables: { unpackingArguments: options.input },
		});
		return await collectUnpackOutcome(payloadsOf(results), {
			inactivityTimeoutMs: options.inactivityTimeoutMs,
			abort: dispose,
			onProgress: options.onProgress,
		});
	} finally {
		dispose();
	}
}
