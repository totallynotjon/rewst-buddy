import { LinkManager, SyncOnSaveManager, type TemplateLink } from '@models';
import type { FullTemplateFragment, Session } from '@sessions';
import { findAllTemplateReferences, getHash, uriExists } from '@utils';
import vscode from 'vscode';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { asString, getTemplateFromAnySession, json, requireString } from './inputHelpers';
import { resolveLinkedUri } from './templateSyncCapabilities';

/**
 * Local link-management tools for the MCP surface: associate a local file with a
 * Rewst template, remove that association, and toggle sync-on-save. They mutate
 * only the extension's own link state and never call a Rewst write API, so —
 * per the project's decision that local-only mutations are read-tier — they are
 * exposed as access:'read' (ungated). They reach the LinkManager /
 * SyncOnSaveManager singletons directly, like list_template_links. They derive
 * the org from the link/template, not from ctx.orgId (requiresOrg is false).
 *
 * MCP arguments are not validated against inputSchema, so every input is coerced
 * here (requireString / explicit boolean check).
 */

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
// Posix (/x) or Windows (C:\x, C:/x) absolute path.
const ABSOLUTE_RE = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

/**
 * Resolves a path or file URI to a vscode.Uri WITHOUT requiring it to be linked
 * (buddy_template_link targets a not-yet-linked file, so resolveLinkedUri does
 * not apply). file:// URIs are parsed as-is, absolute paths become file URIs,
 * and a bare relative path is resolved against the first workspace folder.
 * Returns undefined when the input is empty, malformed, or relative with no
 * workspace open.
 */
export function resolvePathToUri(pathOrUri: string): vscode.Uri | undefined {
	const value = pathOrUri.trim();
	if (value === '') return undefined;
	try {
		if (SCHEME_RE.test(value)) return vscode.Uri.parse(value);
		if (ABSOLUTE_RE.test(value)) return vscode.Uri.file(value);
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) return undefined;
		return vscode.Uri.joinPath(folder.uri, value);
	} catch {
		return undefined;
	}
}

/** Seams for unit testing; production uses {@link defaultTemplateLinkDeps}. */
export interface TemplateLinkDeps {
	resolvePathToUri(pathOrUri: string): vscode.Uri | undefined;
	fileExists(uri: vscode.Uri): Promise<boolean>;
	readBody(uri: vscode.Uri): Promise<string>;
	getTemplate(session: Session, templateId: string): Promise<FullTemplateFragment>;
}

export const defaultTemplateLinkDeps: TemplateLinkDeps = {
	resolvePathToUri,
	fileExists: uri => uriExists(uri),
	async readBody(uri) {
		const doc = await vscode.workspace.openTextDocument(uri);
		return doc.getText();
	},
	getTemplate: (session, templateId) => session.getTemplate(templateId),
};

export async function runLink(
	input: Record<string, unknown>,
	ctx: CapabilityContext,
	deps: TemplateLinkDeps = defaultTemplateLinkDeps,
): Promise<string> {
	const templateId = requireString(input, 'templateId');
	const rawUri = requireString(input, 'uri');
	const requestedOrgId = asString(input, 'orgId');
	const overwrite = input.overwrite === true;

	const uri = deps.resolvePathToUri(rawUri);
	if (!uri) {
		return json({
			status: 'invalid_path',
			uri: rawUri,
			message:
				'Could not resolve this to a file. Pass an absolute path, a file:// URI, or a path relative to an open workspace folder.',
		});
	}
	if (!(await deps.fileExists(uri))) {
		return json({
			status: 'file_not_found',
			path: uri.fsPath,
			message: 'No file exists at this path. Create and save the file first, then link it.',
		});
	}
	if (LinkManager.isLinked(uri) && !overwrite) {
		return json({
			status: 'already_linked',
			path: uri.fsPath,
			message:
				'This file is already linked to a template. Pass overwrite:true to replace the link, or unlink it first.',
		});
	}

	const found = await getTemplateFromAnySession(ctx.sessions, deps.getTemplate, templateId);
	if (!found) {
		return json({
			status: 'template_not_found',
			templateId,
			message:
				'No template with this id is reachable in the active session(s). Check the id and that you are signed into its org.',
		});
	}
	const template = found.template;
	if (requestedOrgId && template.orgId !== requestedOrgId) {
		return json({
			status: 'org_mismatch',
			templateId,
			templateOrgId: template.orgId,
			requestedOrgId,
			message: `Template ${templateId} is in org ${template.orgId}, not ${requestedOrgId}.`,
		});
	}

	const body = await deps.readBody(uri);
	const referencedTemplateIds = findAllTemplateReferences(body);
	const bodyHash = getHash(body);
	const orgName = template.organization?.name ?? template.orgId;
	// Mirror LinkTemplateInteractive: store the sentinel updatedAt '0' (not the
	// real remote timestamp) and an empty body so the first sync reconciles
	// instead of appearing already in-sync. The bodyHash is of the LOCAL file.
	template.updatedAt = '0';
	template.body = '';
	const templateLink: TemplateLink = {
		type: 'Template',
		uriString: uri.toString(),
		org: { id: template.orgId, name: orgName },
		template,
		bodyHash,
		referencedTemplateIds,
	};
	LinkManager.addLink(templateLink);
	// addLink only schedules a debounced persist; flush so the link survives
	// before this MCP call returns.
	await LinkManager.flush();

	return json({
		status: 'linked',
		path: uri.fsPath,
		uri: uri.toString(),
		templateId: template.id,
		templateName: template.name,
		orgId: template.orgId,
		orgName,
		referencedTemplateIds,
		message:
			'Linked. The link starts out-of-sync (updatedAt sentinel); call buddy_template_sync_status to compare, or buddy_template_sync with a direction to reconcile.',
	});
}

export async function runUnlink(input: Record<string, unknown>, _ctx: CapabilityContext): Promise<string> {
	const rawUri = requireString(input, 'uri');
	const resolved = resolveLinkedUri(rawUri);
	if (!resolved) {
		return json({
			status: 'not_linked',
			uri: rawUri,
			message:
				'No template is linked to this file (or the path matches more than one link). Check list_template_links and pass a fuller path.',
		});
	}
	const { uri, link } = resolved;
	const { id, name } = link.template;
	const orgId = link.org.id;
	// removeLink takes the uriString (not a Uri) and clears the secondary
	// indexes; the fired onLinksSaved prunes any sync-on-save entry for this uri.
	LinkManager.removeLink(link.uriString);
	await LinkManager.flush();
	return json({
		status: 'unlinked',
		path: uri.fsPath,
		templateId: id,
		templateName: name,
		orgId,
		message: 'Link removed. The local file and the remote template are untouched.',
	});
}

export async function runSyncOnSave(input: Record<string, unknown>, _ctx: CapabilityContext): Promise<string> {
	const rawUri = requireString(input, 'uri');
	const enabled = input.enabled;
	if (typeof enabled !== 'boolean') {
		throw new Error('"enabled" must be a boolean (true to enable sync-on-save, false to disable).');
	}
	const resolved = resolveLinkedUri(rawUri);
	if (!resolved) {
		return json({
			status: 'not_linked',
			uri: rawUri,
			message:
				'No template is linked to this file (or the path matches more than one link). Link it first with buddy_template_link.',
		});
	}
	const { uri, link } = resolved;
	if (enabled) {
		SyncOnSaveManager.enableSync(uri);
	} else {
		SyncOnSaveManager.disableSync(uri);
	}
	// Report the effective state — it depends on the rewst-buddy.syncOnSaveByDefault
	// mode, not just raw set membership.
	const syncOnSave = SyncOnSaveManager.isUriSynced(uri);
	return json({
		status: 'updated',
		path: uri.fsPath,
		templateId: link.template.id,
		templateName: link.template.name,
		syncOnSave,
		message: syncOnSave
			? 'Sync-on-save is ON: saving this file uploads it to Rewst.'
			: 'Sync-on-save is OFF: saving this file does not upload it.',
	});
}

const linkSpec: ToolSpec = {
	name: 'buddy_template_link',
	args: '{"templateId": string, "uri": string, "orgId"?: string, "overwrite"?: boolean}',
	description:
		'Associate an existing local file with an existing Rewst template, so it can be synced. Does not create the file or the template. Identify the file by an absolute path, a workspace-relative path, or a file:// URI. The link starts out-of-sync on purpose — afterwards call buddy_template_sync_status to compare, or buddy_template_sync to reconcile. Returns already_linked unless overwrite is true, and invalid_path / file_not_found / template_not_found / org_mismatch on the obvious failures. This changes only local link state (no Rewst write).',
	inputSchema: {
		type: 'object',
		properties: {
			templateId: {
				type: 'string',
				description: 'Id of the existing Rewst template to link the file to (from list_templates).',
			},
			uri: {
				type: 'string',
				description: 'Absolute path, workspace-relative path, or file:// URI of the existing local file to link.',
			},
			orgId: {
				type: 'string',
				description: 'Optional org id to verify the template belongs to. Defaults to the template’s own org.',
			},
			overwrite: {
				type: 'boolean',
				description: 'If the file is already linked, replace the existing link instead of failing. Default false.',
			},
		},
		required: ['templateId', 'uri'],
	},
};

const unlinkSpec: ToolSpec = {
	name: 'buddy_template_unlink',
	args: '{"uri": string}',
	description:
		'Remove the link between a local file and its Rewst template. The local file and the remote template are left untouched; only the local association (and its sync-on-save setting) is removed. Identify the file by the path shown in list_template_links or its file URI. Returns not_linked if no template is linked to it.',
	inputSchema: {
		type: 'object',
		properties: {
			uri: {
				type: 'string',
				description: 'Path or file URI of the linked file, as shown by list_template_links.',
			},
		},
		required: ['uri'],
	},
};

const syncOnSaveSpec: ToolSpec = {
	name: 'buddy_template_sync_on_save',
	args: '{"uri": string, "enabled": boolean}',
	description:
		'Enable or disable sync-on-save for a linked file: when on, saving the file in VS Code uploads it to its Rewst template. The file must already be linked (see buddy_template_link). Returns the effective syncOnSave state, which also depends on the rewst-buddy.syncOnSaveByDefault setting. This changes only local state (no Rewst write).',
	inputSchema: {
		type: 'object',
		properties: {
			uri: { type: 'string', description: 'Path or file URI of the linked file.' },
			enabled: {
				type: 'boolean',
				description: 'true to enable sync-on-save (upload on save), false to disable.',
			},
		},
		required: ['uri', 'enabled'],
	},
};

export const TEMPLATE_LINK_CAPABILITIES: Capability[] = [
	{
		spec: linkSpec,
		group: 'workspace',
		access: 'read',
		chat: false,
		mcp: true,
		requiresOrg: false,
		run: (input, ctx) => runLink(input, ctx),
	},
	{
		spec: unlinkSpec,
		group: 'workspace',
		access: 'read',
		chat: false,
		mcp: true,
		requiresOrg: false,
		run: (input, ctx) => runUnlink(input, ctx),
	},
	{
		spec: syncOnSaveSpec,
		group: 'workspace',
		access: 'read',
		chat: false,
		mcp: true,
		requiresOrg: false,
		run: (input, ctx) => runSyncOnSave(input, ctx),
	},
];
