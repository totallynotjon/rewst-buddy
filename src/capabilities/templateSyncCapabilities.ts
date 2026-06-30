import {
	LinkManager,
	SyncManager,
	SyncOnSaveManager,
	type SyncDecision,
	type SyncDecisionContext,
	type TemplateLink,
} from '@models';
import vscode from 'vscode';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { ORG_ID_PROP, requireString } from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';

/**
 * Template sync capabilities for the MCP surface. The extension already syncs a
 * linked file to its Rewst template on save, but that flow resolves conflicts
 * with an interactive VS Code modal that an external MCP client can never see.
 * These tools expose the same non-interactive primitives (SyncManager) and
 * replace the modal with an explicit `direction` argument, so a conflict is
 * surfaced as data the model resolves by choosing a direction — never a silent
 * overwrite.
 *
 * buddy_template_sync_status is read-only and ungated; it derives the org from
 * the link. buddy_template_sync is a single org-scoped write capability, so the
 * MCP boundary requires write tools to be enabled and the org to be allowlisted
 * for the whole tool — every direction, including download — before run() is
 * reached. Only the per-call VS Code approval prompt is upload-specific:
 * downloading and metadata refreshes rewrite local state and never prompt.
 */

/** Identifies one linked file by path/URI and carries the sync state for it. */
export interface TemplateSyncTarget {
	uri: vscode.Uri;
	doc: vscode.TextDocument;
	context: SyncDecisionContext;
	dirty: boolean;
}

export type PreparedTarget = { kind: 'unlinked' } | { kind: 'ready'; target: TemplateSyncTarget };

interface UploadResult {
	templateId: string;
	name: string;
	updatedAt: string;
}

/**
 * Seams for unit testing; production uses {@link defaultTemplateSyncDeps}. The
 * capability logic (direction handling, org verification, approval, JSON
 * shaping) is tested against a fake deps object so it needs no live workspace.
 */
export interface TemplateSyncDeps {
	prepare(pathOrUri: string): Promise<PreparedTarget>;
	isSyncOnSaveEnabled(target: TemplateSyncTarget): boolean;
	saveIfDirty(target: TemplateSyncTarget): Promise<void>;
	upload(target: TemplateSyncTarget): Promise<UploadResult>;
	download(target: TemplateSyncTarget): Promise<void>;
	refreshMetadata(target: TemplateSyncTarget): Promise<void>;
}

function safeFsPath(uriString: string): string {
	try {
		return vscode.Uri.parse(uriString).fsPath;
	} catch {
		return '';
	}
}

/**
 * Matches a requested path/URI against the known template links and returns the
 * link's canonical uriString, or undefined if nothing matches. Pure so it can be
 * unit-tested: callers pass the link's uriString and its resolved fsPath. The
 * order matters — an exact link URI or filesystem path wins before the
 * relative-suffix match used for the workspace-relative paths buddy_search_template_links
 * lists.
 */
export function matchLinkByPath(
	pathOrUri: string,
	links: readonly { uriString: string; fsPath: string }[],
): string | undefined {
	const norm = (value: string): string => value.replace(/\\/g, '/').trim();
	const wanted = norm(pathOrUri);
	if (wanted === '') return undefined;

	const exactUri = links.find(link => link.uriString === pathOrUri || norm(link.uriString) === wanted);
	if (exactUri) return exactUri.uriString;

	const exactPath = links.find(link => link.fsPath !== '' && norm(link.fsPath) === wanted);
	if (exactPath) return exactPath.uriString;

	const relative = wanted.replace(/^\.?\//, '');
	if (relative === '') return undefined;
	const suffixMatches = links.filter(link => {
		const path = norm(link.fsPath);
		return path !== '' && (path === relative || path.endsWith(`/${relative}`));
	});
	// A bare/relative path that matches more than one linked file is ambiguous;
	// refuse rather than silently pick an arbitrary one — this resolves a write
	// target. The caller should pass the full URI or absolute path to disambiguate.
	if (suffixMatches.length !== 1) return undefined;
	return suffixMatches[0].uriString;
}

export function resolveLinkedUri(pathOrUri: string): { uri: vscode.Uri; link: TemplateLink } | undefined {
	const links = LinkManager.getAllTemplateLinks();
	const matched = matchLinkByPath(
		pathOrUri,
		links.map(link => ({ uriString: link.uriString, fsPath: safeFsPath(link.uriString) })),
	);
	if (!matched) return undefined;
	const link = links.find(candidate => candidate.uriString === matched);
	if (!link) return undefined;
	return { uri: vscode.Uri.parse(matched), link };
}

export const defaultTemplateSyncDeps: TemplateSyncDeps = {
	async prepare(pathOrUri) {
		const resolved = resolveLinkedUri(pathOrUri);
		if (!resolved) return { kind: 'unlinked' };
		const doc = await vscode.workspace.openTextDocument(resolved.uri);
		const context = await SyncManager.computeSyncDecision(doc);
		return { kind: 'ready', target: { uri: resolved.uri, doc, context, dirty: doc.isDirty } };
	},
	isSyncOnSaveEnabled: target => SyncOnSaveManager.isUriSynced(target.uri),
	async saveIfDirty(target) {
		if (target.doc.isDirty && !(await target.doc.save())) {
			throw new Error('Failed to save the document before uploading.');
		}
	},
	async upload(target) {
		await SyncManager.updateTemplateBody(target.doc);
		const link = LinkManager.getTemplateLink(target.uri);
		return { templateId: link.template.id, name: link.template.name, updatedAt: link.template.updatedAt };
	},
	download: target =>
		SyncManager.applyTemplateToDocument(target.doc, target.context.session, target.context.remoteTemplate),
	async refreshMetadata(target) {
		SyncManager.refreshLinkMetadata(
			target.doc,
			target.context.session,
			target.context.remoteTemplate,
			target.context.localBody,
		);
	},
};

type SyncStatusLabel = 'in-sync' | 'remote-only' | 'local-ahead' | 'conflict';
type RecommendedDirection = 'none' | 'upload' | 'download' | 'resolve';

function statusLabel(action: SyncDecision['action']): SyncStatusLabel {
	switch (action) {
		case 'update-metadata':
			return 'in-sync';
		case 'download-remote':
			return 'remote-only';
		case 'upload-local':
			return 'local-ahead';
		case 'conflict':
			return 'conflict';
	}
}

function recommendedDirection(action: SyncDecision['action']): RecommendedDirection {
	switch (action) {
		case 'update-metadata':
			return 'none';
		case 'download-remote':
			return 'download';
		case 'upload-local':
			return 'upload';
		case 'conflict':
			return 'resolve';
	}
}

type SyncDirection = 'auto' | 'upload' | 'download';

function parseDirection(value: unknown): SyncDirection {
	if (value === undefined || value === null) return 'auto';
	if (value === 'auto' || value === 'upload' || value === 'download') return value;
	throw new Error('"direction" must be one of "auto", "upload", or "download".');
}

type EffectiveAction = 'metadata' | 'download' | 'upload' | 'conflict';

function resolveEffectiveAction(direction: SyncDirection, action: SyncDecision['action']): EffectiveAction {
	// Bodies already match: there is nothing to push or pull regardless of the
	// requested direction, so just refresh metadata.
	if (action === 'update-metadata') return 'metadata';
	if (direction === 'upload') return 'upload';
	if (direction === 'download') return 'download';
	// direction === 'auto'; action is download-remote | upload-local | conflict.
	if (action === 'download-remote') return 'download';
	if (action === 'upload-local') return 'upload';
	return 'conflict';
}

export async function runSyncStatus(
	input: Record<string, unknown>,
	_ctx: CapabilityContext,
	deps: TemplateSyncDeps = defaultTemplateSyncDeps,
): Promise<string> {
	const uri = requireString(input, 'uri');
	const prepared = await deps.prepare(uri);
	if (prepared.kind === 'unlinked') {
		return JSON.stringify(
			{
				linked: false,
				uri,
				message:
					'No Rewst template is linked to this file. Use buddy_template_link_status to check one file, or buddy_search_template_links to find linked files.',
			},
			null,
			2,
		);
	}
	const { target } = prepared;
	const { link, remoteTemplate, localBody, decision } = target.context;
	return JSON.stringify(
		{
			linked: true,
			path: target.uri.fsPath,
			orgId: link.org.id,
			orgName: link.org.name,
			templateId: link.template.id,
			templateName: link.template.name,
			syncOnSave: deps.isSyncOnSaveEnabled(target),
			status: statusLabel(decision.action),
			recommendedDirection: recommendedDirection(decision.action),
			localUpdatedAt: link.template.updatedAt,
			remoteUpdatedAt: remoteTemplate.updatedAt,
			bodiesMatch: localBody === remoteTemplate.body,
			localEmpty: localBody === '',
			unsavedEdits: target.dirty,
		},
		null,
		2,
	);
}

export async function runSync(
	input: Record<string, unknown>,
	ctx: CapabilityContext,
	deps: TemplateSyncDeps = defaultTemplateSyncDeps,
): Promise<string> {
	const orgId = requireString(input, 'orgId');
	const uri = requireString(input, 'uri');
	const direction = parseDirection(input.direction);

	const prepared = await deps.prepare(uri);
	if (prepared.kind === 'unlinked') {
		return JSON.stringify(
			{
				status: 'not_linked',
				message: `No Rewst template is linked to "${uri}". Link it in VS Code first, or check buddy_search_template_links.`,
			},
			null,
			2,
		);
	}
	const { target } = prepared;
	const { link, remoteTemplate, decision } = target.context;

	// A session can manage several orgs, so confirm the linked file AND the remote
	// template belong to the requested org before any upload — otherwise a file
	// linked to a sibling org could be reached by path.
	if (link.org.id !== orgId) {
		throw new Error(`"${uri}" is linked to org ${link.org.id}, not ${orgId}.`);
	}
	// Fail closed: a write tool must re-verify the resource's org, so reject an
	// absent/non-string remote orgId as well as a mismatch.
	const remoteOrgId = (remoteTemplate as { orgId?: unknown }).orgId;
	if (typeof remoteOrgId !== 'string' || remoteOrgId !== orgId) {
		throw new Error(`Template ${link.template.id} is not in org ${orgId}.`);
	}

	const effective = resolveEffectiveAction(direction, decision.action);

	if (effective === 'conflict') {
		return JSON.stringify(
			{
				status: 'conflict',
				templateId: link.template.id,
				templateName: link.template.name,
				localUpdatedAt: link.template.updatedAt,
				remoteUpdatedAt: remoteTemplate.updatedAt,
				message:
					'Local and remote both changed since the last sync. Re-call with direction:"upload" to overwrite Rewst with the local file, or direction:"download" to overwrite the local file with Rewst.',
			},
			null,
			2,
		);
	}

	if (effective === 'metadata') {
		await deps.refreshMetadata(target);
		return JSON.stringify(
			{
				status: 'in-sync',
				templateId: link.template.id,
				name: remoteTemplate.name,
				message: 'Bodies already match; refreshed the local link metadata. Nothing was uploaded or downloaded.',
			},
			null,
			2,
		);
	}

	if (effective === 'download') {
		await deps.download(target);
		return JSON.stringify(
			{
				status: 'downloaded',
				templateId: link.template.id,
				name: remoteTemplate.name,
				remoteUpdatedAt: remoteTemplate.updatedAt,
				message: 'Local file overwritten with the latest Rewst template body.',
			},
			null,
			2,
		);
	}

	// effective === 'upload' — this changes Rewst, so gate it behind the shared
	// per-call approval flow (the same one the other write tools use).
	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: link.template.id, scopeName: link.template.name, orgId, orgName };
	// 'download-remote' is only produced when the local file is empty, so an
	// explicit upload then CLEARS the remote template body. Surface that in the
	// approval prompt rather than the generic "upload local edits" wording.
	const clearsRemote = decision.action === 'download-remote';
	const summary = clearsRemote
		? `Upload an EMPTY local file to template "${link.template.name}" (${link.template.id}) in org "${orgName}" (${orgId}) — this CLEARS the remote template body`
		: `Upload local edits to template "${link.template.name}" (${link.template.id}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(scope, summary, async () => {
		await deps.saveIfDirty(target);
		const result = await deps.upload(target);
		return JSON.stringify(
			{
				status: 'uploaded',
				templateId: result.templateId,
				name: result.name,
				updatedAt: result.updatedAt,
				message: clearsRemote
					? 'Empty local file uploaded; the remote template body was cleared.'
					: 'Local file body uploaded to Rewst.',
			},
			null,
			2,
		);
	});
}

const syncStatusSpec: ToolSpec = {
	name: 'buddy_template_sync_status',
	args: '{"uri": string}',
	description:
		'Report whether a local file is linked to a Rewst template and how it compares to the remote template, without changing anything. Identify the file by the path shown in buddy_search_template_links (workspace-relative or absolute) or its file URI. Returns linked:false when no template is linked. When linked, returns the org id and template id to pass to buddy_template_sync, whether sync-on-save is on, and a status of "in-sync", "remote-only" (the local file is empty), "local-ahead" (safe to upload), or "conflict" (both changed since the last sync), plus a recommended direction.',
	inputSchema: {
		type: 'object',
		properties: {
			uri: {
				type: 'string',
				description: 'Path or file URI of the local file, as shown by buddy_search_template_links.',
			},
		},
		required: ['uri'],
	},
};

const syncSpec: ToolSpec = {
	name: 'buddy_template_sync',
	args: '{"orgId": string, "uri": string, "direction"?: "auto" | "upload" | "download"}',
	description:
		'Synchronize one linked local file with its Rewst template. Identify the file by the path from buddy_search_template_links or its file URI; orgId must be the org the file is linked to (buddy_template_sync_status returns it). direction defaults to "auto": it uploads when only the local file changed, downloads when the local file is empty, refreshes metadata when the bodies already match, and on a conflict (both changed since the last sync) it changes nothing and asks you to choose. Pass direction:"upload" to overwrite the Rewst template with the local file, or direction:"download" to overwrite the local file with the Rewst template. This is a write tool: every direction (including download) requires write tools to be enabled in VS Code and the org to be on the write allowlist. Only uploading additionally needs per-call approval and changes Rewst; downloading and metadata refreshes rewrite local state only.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			uri: {
				type: 'string',
				description: 'Path or file URI of the linked local file, as shown by buddy_search_template_links.',
			},
			direction: {
				type: 'string',
				enum: ['auto', 'upload', 'download'],
				description:
					'auto (default) resolves the safe direction and stops on a conflict; upload overwrites Rewst with the local file; download overwrites the local file with Rewst.',
			},
		},
		required: ['orgId', 'uri'],
	},
};

export const TEMPLATE_SYNC_CAPABILITIES: Capability[] = [
	{
		spec: syncStatusSpec,
		group: 'workspace',
		access: 'read',
		chat: false,
		mcp: true,
		requiresOrg: false,
		run: (input, ctx) => runSyncStatus(input, ctx),
	},
	{ spec: syncSpec, access: 'write', chat: false, mcp: true, run: (input, ctx) => runSync(input, ctx) },
];
