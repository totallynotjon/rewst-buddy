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

suite('sdk operation wiring', () => {
	let calls: RecordedCall[];
	let sdk: ReturnType<typeof getSdk>;

	setup(() => {
		calls = [];
		const recordingWrapper: SdkFunctionWrapper = (_action, operationName, operationType) => {
			calls.push({ operationName, operationType });
			// Do NOT invoke _action — avoids any network dependency
			return Promise.resolve(undefined as any);
		};
		sdk = getSdk(new GraphQLClient('http://localhost:9999/graphql'), recordingWrapper);
	});

	test('getConversations wires to operationName=getConversations, operationType=query', async () => {
		await sdk.getConversations();
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'getConversations') {
			throw new Error(`Expected operationName 'getConversations', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'query') {
			throw new Error(`Expected operationType 'query', got '${calls[0].operationType}'`);
		}
	});

	test('getConversation wires to operationName=getConversation, operationType=query', async () => {
		await sdk.getConversation({ id: 'x' });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'getConversation') {
			throw new Error(`Expected operationName 'getConversation', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'query') {
			throw new Error(`Expected operationType 'query', got '${calls[0].operationType}'`);
		}
	});

	test('deleteConversation wires to operationName=deleteConversation, operationType=mutation', async () => {
		await sdk.deleteConversation({ id: 'x' });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'deleteConversation') {
			throw new Error(`Expected operationName 'deleteConversation', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'mutation') {
			throw new Error(`Expected operationType 'mutation', got '${calls[0].operationType}'`);
		}
	});

	test('createConversationMessageVote wires to operationName=createConversationMessageVote, operationType=mutation', async () => {
		await sdk.createConversationMessageVote({ vote: {} as any });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'createConversationMessageVote') {
			throw new Error(`Expected operationName 'createConversationMessageVote', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'mutation') {
			throw new Error(`Expected operationType 'mutation', got '${calls[0].operationType}'`);
		}
	});

	test('myRoboRewstyPreferences wires to operationName=myRoboRewstyPreferences, operationType=query', async () => {
		await sdk.myRoboRewstyPreferences();
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'myRoboRewstyPreferences') {
			throw new Error(`Expected operationName 'myRoboRewstyPreferences', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'query') {
			throw new Error(`Expected operationType 'query', got '${calls[0].operationType}'`);
		}
	});

	test('addAllowedTool wires to operationName=addAllowedTool, operationType=mutation', async () => {
		await sdk.addAllowedTool({ toolName: 't' });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'addAllowedTool') {
			throw new Error(`Expected operationName 'addAllowedTool', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'mutation') {
			throw new Error(`Expected operationType 'mutation', got '${calls[0].operationType}'`);
		}
	});

	test('removeAllowedTool wires to operationName=removeAllowedTool, operationType=mutation', async () => {
		await sdk.removeAllowedTool({ toolName: 't' });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'removeAllowedTool') {
			throw new Error(`Expected operationName 'removeAllowedTool', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'mutation') {
			throw new Error(`Expected operationType 'mutation', got '${calls[0].operationType}'`);
		}
	});

	test('listTemplates wires to operationName=listTemplates, operationType=query', async () => {
		await sdk.listTemplates({ orgId: 'o' });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'listTemplates') {
			throw new Error(`Expected operationName 'listTemplates', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'query') {
			throw new Error(`Expected operationType 'query', got '${calls[0].operationType}'`);
		}
	});

	test('createTemplateMinimal wires to operationName=createTemplateMinimal, operationType=mutation', async () => {
		await sdk.createTemplateMinimal({ name: 'n', orgId: 'o', body: 'b' });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'createTemplateMinimal') {
			throw new Error(`Expected operationName 'createTemplateMinimal', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'mutation') {
			throw new Error(`Expected operationType 'mutation', got '${calls[0].operationType}'`);
		}
	});

	test('updateTemplate wires to operationName=updateTemplate, operationType=mutation', async () => {
		await sdk.updateTemplate({ template: { id: 't' } as any });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'updateTemplate') {
			throw new Error(`Expected operationName 'updateTemplate', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'mutation') {
			throw new Error(`Expected operationType 'mutation', got '${calls[0].operationType}'`);
		}
	});

	test('updateTemplateBody wires to operationName=updateTemplateBody, operationType=mutation', async () => {
		await sdk.updateTemplateBody({ id: 't', body: 'b' });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'updateTemplateBody') {
			throw new Error(`Expected operationName 'updateTemplateBody', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'mutation') {
			throw new Error(`Expected operationType 'mutation', got '${calls[0].operationType}'`);
		}
	});

	test('updateTemplateName wires to operationName=updateTemplateName, operationType=mutation', async () => {
		await sdk.updateTemplateName({ id: 't', name: 'n' });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'updateTemplateName') {
			throw new Error(`Expected operationName 'updateTemplateName', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'mutation') {
			throw new Error(`Expected operationType 'mutation', got '${calls[0].operationType}'`);
		}
	});

	test('getTemplate wires to operationName=getTemplate, operationType=query', async () => {
		await sdk.getTemplate({ id: 't' });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'getTemplate') {
			throw new Error(`Expected operationName 'getTemplate', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'query') {
			throw new Error(`Expected operationType 'query', got '${calls[0].operationType}'`);
		}
	});

	test('deleteTemplate wires to operationName=deleteTemplate, operationType=mutation', async () => {
		await sdk.deleteTemplate({ id: 't' });
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'deleteTemplate') {
			throw new Error(`Expected operationName 'deleteTemplate', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'mutation') {
			throw new Error(`Expected operationType 'mutation', got '${calls[0].operationType}'`);
		}
	});

	test('User wires to operationName=User, operationType=query', async () => {
		await sdk.User();
		if (calls.length !== 1) {
			throw new Error(`Expected 1 call, got ${calls.length}`);
		}
		if (calls[0].operationName !== 'User') {
			throw new Error(`Expected operationName 'User', got '${calls[0].operationName}'`);
		}
		if (calls[0].operationType !== 'query') {
			throw new Error(`Expected operationType 'query', got '${calls[0].operationType}'`);
		}
	});
});
