import { LinkManager, SyncManager, TemplateLink } from '@models';
import { SessionManager } from '@sessions';
import { createMockSession, Fixtures, initTestEnvironment } from '@test';
import * as assert from 'assert';
import { ServerResponse } from 'http';
import * as Mocha from 'mocha';
import vscode from 'vscode';
import { handleAddSession, handleOpenTemplate, validateRequest } from './handlers';
import { AddSessionRequest, OpenTemplateRequest, Response } from './types';

const { suite, test, setup, teardown } = Mocha;

interface Restore {
	restore(): void;
}

/** Replaces one method on a (real) object/singleton and returns a restore handle. */
function stub<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]): Restore {
	const original = obj[key];
	Object.defineProperty(obj, key, { value: impl, configurable: true, writable: true });
	return {
		restore() {
			Object.defineProperty(obj, key, { value: original, configurable: true, writable: true });
		},
	};
}

/** Records every sendResponse call so handler tests can assert on status/body without a real socket. */
function createSendResponseSpy() {
	const calls: { statusCode: number; body: Response }[] = [];
	const sendResponse = (_res: ServerResponse, statusCode: number, body: Response) => {
		calls.push({ statusCode, body });
	};
	return { calls, sendResponse };
}

const fakeRes = {} as ServerResponse;

suite('Unit: validateRequest', () => {
	setup(() => {
		initTestEnvironment();
	});

	test('rejects a non-object request', () => {
		assert.ok(validateRequest(null));
		assert.ok(validateRequest('not json'));
		assert.ok(validateRequest(42));
	});

	test('rejects a request missing action', () => {
		const error = validateRequest({});
		assert.ok(error);
		assert.match(error!, /action/);
	});

	test('rejects addSession missing cookies', () => {
		const error = validateRequest({ action: 'addSession' });
		assert.ok(error);
		assert.match(error!, /cookies/);
	});

	test('rejects addSession with empty cookies', () => {
		const error = validateRequest({ action: 'addSession', cookies: '' });
		assert.ok(error);
		assert.match(error!, /[Cc]ookies/);
	});

	test('rejects openTemplate missing orgId', () => {
		const error = validateRequest({ action: 'openTemplate', templateId: 'tpl-1' });
		assert.ok(error);
		assert.match(error!, /orgId/);
	});

	test('rejects openTemplate missing templateId', () => {
		const error = validateRequest({ action: 'openTemplate', orgId: 'org-1' });
		assert.ok(error);
		assert.match(error!, /templateId/);
	});

	test('accepts a valid addSession request', () => {
		assert.strictEqual(validateRequest({ action: 'addSession', cookies: 'cookie=value' }), null);
	});

	test('accepts a valid openTemplate request', () => {
		assert.strictEqual(validateRequest({ action: 'openTemplate', orgId: 'org-1', templateId: 'tpl-1' }), null);
	});
});

suite('Unit: handleAddSession', () => {
	const restores: Restore[] = [];

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
	});

	teardown(() => {
		while (restores.length) restores.pop()!.restore();
		SessionManager._resetForTesting();
	});

	function request(cookies = 'cookie=value'): AddSessionRequest {
		return { action: 'addSession', cookies };
	}

	test('reports success with the session label when the session validates', async () => {
		const fakeSession = { validate: async () => true, profile: { label: 'My Session' } };
		restores.push(
			stub(SessionManager, 'createSession', (async () => fakeSession) as typeof SessionManager.createSession),
		);

		const { calls, sendResponse } = createSendResponseSpy();
		await handleAddSession(request(), fakeRes, sendResponse);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].statusCode, 200);
		assert.strictEqual(calls[0].body.success, true);
		assert.strictEqual((calls[0].body as { sessionLabel?: string }).sessionLabel, 'My Session');
	});

	test('reports a validation failure as 400 when the session created but did not validate', async () => {
		const fakeSession = { validate: async () => false, profile: { label: 'My Session' } };
		restores.push(
			stub(SessionManager, 'createSession', (async () => fakeSession) as typeof SessionManager.createSession),
		);

		const { calls, sendResponse } = createSendResponseSpy();
		await handleAddSession(request(), fakeRes, sendResponse);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].statusCode, 400);
		assert.strictEqual(calls[0].body.success, false);
	});

	test('reports a thrown error as 500 with the error message', async () => {
		restores.push(
			stub(SessionManager, 'createSession', (async () => {
				throw new Error('boom');
			}) as typeof SessionManager.createSession),
		);

		const { calls, sendResponse } = createSendResponseSpy();
		await handleAddSession(request(), fakeRes, sendResponse);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].statusCode, 500);
		assert.strictEqual(calls[0].body.success, false);
		assert.match((calls[0].body as { error: string }).error, /boom/);
	});
});

suite('Unit: handleOpenTemplate', () => {
	const restores: Restore[] = [];

	setup(() => {
		initTestEnvironment();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
	});

	teardown(async () => {
		while (restores.length) restores.pop()!.restore();
		SessionManager._resetForTesting();
		LinkManager._resetForTesting();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	function request(orgId: string, templateId: string): OpenTemplateRequest {
		return { action: 'openTemplate', orgId, templateId };
	}

	test('refreshes and syncs an already-linked template', async () => {
		const org = Fixtures.orgModel({ id: 'org-1', name: 'Test Org' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		const remoteTemplate = Fixtures.fullTemplate({
			id: 'tpl-1',
			orgId: 'org-1',
			organization: Fixtures.org({ id: 'org-1', name: 'Test Org' }),
		});
		wrapper.when('getTemplate', { data: Fixtures.getTemplateQuery(remoteTemplate) });
		SessionManager._setSessionsForTesting([session]);

		const uri = vscode.Uri.file('/ws/existing.j2');
		const existingTemplateLink: TemplateLink = {
			type: 'Template',
			uriString: uri.toString(),
			org,
			template: { id: 'tpl-1', name: 'Existing Template', updatedAt: '2024-01-01T00:00:00Z' } as any,
			bodyHash: 'hash',
		};
		LinkManager.addLink(existingTemplateLink);

		const fakeDoc = { uri, getText: () => 'old content' } as unknown as vscode.TextDocument;
		restores.push(
			stub(
				vscode.workspace,
				'openTextDocument',
				(async () => fakeDoc) as typeof vscode.workspace.openTextDocument,
			),
		);

		const applyCalls: unknown[][] = [];
		restores.push(
			stub(SyncManager, 'applyTemplateToDocument', (async (...args: unknown[]) => {
				applyCalls.push(args);
			}) as typeof SyncManager.applyTemplateToDocument),
		);

		const { calls, sendResponse } = createSendResponseSpy();
		await handleOpenTemplate(request('org-1', 'tpl-1'), fakeRes, sendResponse);

		assert.strictEqual(wrapper.getCallsFor('getTemplate').length, 1, 'fetches the remote template to sync');
		assert.strictEqual(applyCalls.length, 1, 'applies the remote template to the linked document');
		assert.strictEqual(applyCalls[0][0], fakeDoc);
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].statusCode, 200);
		assert.strictEqual(calls[0].body.success, true);
	});

	test('fetches and links a brand-new template when no link exists', async () => {
		const org = Fixtures.orgModel({ id: 'org-2', name: 'Org Two' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		const remoteTemplate = Fixtures.fullTemplate({
			id: 'tpl-2',
			orgId: 'org-2',
			organization: Fixtures.org({ id: 'org-2', name: 'Org Two' }),
		});
		wrapper.when('getTemplate', { data: Fixtures.getTemplateQuery(remoteTemplate) });
		SessionManager._setSessionsForTesting([session]);

		const fixedUri = vscode.Uri.file('/ws/new-template.j2');
		restores.push(stub(vscode.workspace, 'saveAs', (async () => fixedUri) as typeof vscode.workspace.saveAs));

		const { calls, sendResponse } = createSendResponseSpy();
		await handleOpenTemplate(request('org-2', 'tpl-2'), fakeRes, sendResponse);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].statusCode, 200);
		assert.strictEqual(calls[0].body.success, true);

		const links = LinkManager.getTemplateLinkFromId('tpl-2');
		assert.strictEqual(links.length, 1);
		assert.strictEqual(links[0].uriString, fixedUri.toString());
	});

	test('reports success:false when the user cancels the save dialog', async () => {
		const org = Fixtures.orgModel({ id: 'org-3', name: 'Org Three' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		const remoteTemplate = Fixtures.fullTemplate({
			id: 'tpl-3',
			orgId: 'org-3',
			organization: Fixtures.org({ id: 'org-3', name: 'Org Three' }),
		});
		wrapper.when('getTemplate', { data: Fixtures.getTemplateQuery(remoteTemplate) });
		SessionManager._setSessionsForTesting([session]);

		restores.push(stub(vscode.workspace, 'saveAs', (async () => undefined) as typeof vscode.workspace.saveAs));

		const { calls, sendResponse } = createSendResponseSpy();
		await handleOpenTemplate(request('org-3', 'tpl-3'), fakeRes, sendResponse);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].statusCode, 200);
		assert.strictEqual(calls[0].body.success, false);
		assert.strictEqual((calls[0].body as { error: string }).error, 'User cancelled save operation');
		assert.deepStrictEqual(LinkManager.getTemplateLinkFromId('tpl-3'), []);
	});

	test('reports a thrown error as 500', async () => {
		const org = Fixtures.orgModel({ id: 'org-4', name: 'Org Four' });
		const { session, wrapper } = createMockSession({ profile: { org, allManagedOrgs: [org] } });
		wrapper.when('getTemplate', { error: Fixtures.networkError('boom') });
		SessionManager._setSessionsForTesting([session]);

		const { calls, sendResponse } = createSendResponseSpy();
		await handleOpenTemplate(request('org-4', 'tpl-4'), fakeRes, sendResponse);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].statusCode, 500);
		assert.strictEqual(calls[0].body.success, false);
		assert.match((calls[0].body as { error: string }).error, /boom/);
	});
});
