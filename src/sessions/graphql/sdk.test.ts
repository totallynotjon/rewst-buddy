/**
 * Characterization test: pins the exact operationName/operationType strings
 * that getSdk() passes to withWrapper for each of the 15 operations.
 *
 * This is NOT a red-then-green TDD test — no behavior is changing. It is
 * written against the current (still-generated) sdk.ts as a "before" baseline,
 * then rerun unchanged after the client-preset migration as proof of behavioral
 * equivalence. See spec C1 §Test Plan for rationale.
 */
import { GraphQLClient } from 'graphql-request';
import { setup, suite, test } from '../../test/tdd';
import type { SdkFunctionWrapper } from './sdk';
import { getSdk } from './sdk';

interface RecordedCall {
	operationName: string;
	operationType?: string;
}

type Sdk = ReturnType<typeof getSdk>;
type OperationName = keyof Sdk & string;

interface WiringCase {
	operationType: 'query' | 'mutation';
	invoke: (sdk: Sdk) => Promise<unknown>;
}

const wiringCases = {
	getConversations: {
		operationType: 'query',
		invoke: sdk => sdk.getConversations(),
	},
	getConversation: {
		operationType: 'query',
		invoke: sdk => sdk.getConversation({ id: 'x' }),
	},
	deleteConversation: {
		operationType: 'mutation',
		invoke: sdk => sdk.deleteConversation({ id: 'x' }),
	},
	createConversationMessageVote: {
		operationType: 'mutation',
		invoke: sdk => sdk.createConversationMessageVote({ vote: {} as any }),
	},
	myRoboRewstyPreferences: {
		operationType: 'query',
		invoke: sdk => sdk.myRoboRewstyPreferences(),
	},
	addAllowedTool: {
		operationType: 'mutation',
		invoke: sdk => sdk.addAllowedTool({ toolName: 't' }),
	},
	removeAllowedTool: {
		operationType: 'mutation',
		invoke: sdk => sdk.removeAllowedTool({ toolName: 't' }),
	},
	listTemplates: {
		operationType: 'query',
		invoke: sdk => sdk.listTemplates({ orgId: 'o' }),
	},
	createTemplateMinimal: {
		operationType: 'mutation',
		invoke: sdk => sdk.createTemplateMinimal({ name: 'n', orgId: 'o', body: 'b' }),
	},
	updateTemplate: {
		operationType: 'mutation',
		invoke: sdk => sdk.updateTemplate({ template: { id: 't' } as any }),
	},
	updateTemplateBody: {
		operationType: 'mutation',
		invoke: sdk => sdk.updateTemplateBody({ id: 't', body: 'b' }),
	},
	updateTemplateName: {
		operationType: 'mutation',
		invoke: sdk => sdk.updateTemplateName({ id: 't', name: 'n' }),
	},
	getTemplate: {
		operationType: 'query',
		invoke: sdk => sdk.getTemplate({ id: 't' }),
	},
	deleteTemplate: {
		operationType: 'mutation',
		invoke: sdk => sdk.deleteTemplate({ id: 't' }),
	},
	User: {
		operationType: 'query',
		invoke: sdk => sdk.User(),
	},
} satisfies Record<OperationName, WiringCase>;

suite('sdk operation wiring', () => {
	let calls: RecordedCall[];
	let sdk: Sdk;

	setup(() => {
		calls = [];
		const recordingWrapper: SdkFunctionWrapper = (_action, operationName, operationType) => {
			calls.push({ operationName, operationType });
			// Do NOT invoke _action — avoids any network dependency
			return Promise.resolve(undefined as any);
		};
		sdk = getSdk(new GraphQLClient('http://localhost:9999/graphql'), recordingWrapper);
	});

	function assertRecordedCall(expectedOperationName: string, expectedOperationType: string) {
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}

		const [call] = calls;
		if (!call) {
			throw new Error('Expected 1 call, got none');
		}

		if (call.operationName !== expectedOperationName) {
			throw new Error(`Expected operationName '${expectedOperationName}', got '${call.operationName}'`);
		}
		if (call.operationType !== expectedOperationType) {
			throw new Error(`Expected operationType '${expectedOperationType}', got '${call.operationType}'`);
		}
	}

	for (const [operationName, { operationType, invoke }] of Object.entries(wiringCases)) {
		test(`${operationName} wires to operationName=${operationName}, operationType=${operationType}`, async () => {
			await invoke(sdk);
			assertRecordedCall(operationName, operationType);
		});
	}
});
