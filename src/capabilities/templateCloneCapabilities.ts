import type { FullTemplateFragment, Session } from '@sessions';
import { findAllTemplateReferences } from '@utils';
import { TEMPLATE_PATTERN } from '../providers/templatePatternUtils';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { asPositiveInt, asString, getTemplateFromAnySession, json, ORG_ID_PROP, requireString } from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';

/**
 * buddy_template_bundle_clone — deep-copy a template and the templates it
 * references (transitively, via template('<id>') calls in the body) into NEW
 * templates in a target org, rewriting every reference to the new ids.
 *
 * Why manual create-then-rewrite (not a native Rewst clone): the generated SDK
 * has no clone wrapper, and a native deep clone would not rewrite the
 * template('<id>') references to the new ids — the whole point here. So we
 * create an empty template per node (to mint new ids), build an old→new id map,
 * then for each node rewrite its body and write back its source metadata
 * (contentType/language/context/cloneOverrides/description). Two phases are
 * required because a body can reference a node not yet created (cycles / forward
 * refs). Tags are NOT copied (they are org-scoped tag ids).
 *
 * orgId is the TARGET org (write destination), which the central MCP allowlist
 * gates. The source org is taken from the root and read with whatever session
 * manages it; writes always go to ctx.session (resolved for the target orgId).
 */

const DEFAULT_MAX_TEMPLATES = 50;
const MAX_MAX_TEMPLATES = 200;
const DEFAULT_MAX_DEPTH = 10;
const MAX_MAX_DEPTH = 25;
const DEFAULT_NAME_SUFFIX = ' (copy)';

/** Source fields a clone carries beyond name+body (the create surface takes only name+body). */
interface CloneMetadata {
	contentType: string;
	language: string;
	context: unknown;
	cloneOverrides: unknown;
	description: string | null | undefined;
}

interface CloneUpdate extends CloneMetadata {
	id: string;
	body: string;
}

export interface TemplateCloneDeps {
	getTemplate(session: Session, id: string): Promise<FullTemplateFragment>;
	createTemplate(session: Session, name: string, orgId: string): Promise<{ id: string }>;
	updateTemplate(session: Session, update: CloneUpdate): Promise<void>;
	deleteTemplate(session: Session, id: string): Promise<void>;
}

export const defaultTemplateCloneDeps: TemplateCloneDeps = {
	getTemplate: (session, id) => session.getTemplate(id),
	async createTemplate(session, name, orgId) {
		const response = await session.sdk?.createTemplateMinimal({ name, orgId, body: '' });
		const template = response?.template;
		if (!template?.id) throw new Error('createTemplateMinimal returned no template; the clone failed.');
		return { id: template.id };
	},
	async updateTemplate(session, update) {
		// updateTemplate (full TemplateUpdateInput) carries the rewritten body AND
		// the source metadata, so a python/non-jinja or context-bearing template
		// clones faithfully rather than as a default jinja/text template.
		const response = await session.sdk?.updateTemplate({
			template: {
				id: update.id,
				body: update.body,
				contentType: update.contentType,
				language: update.language,
				context: update.context,
				cloneOverrides: update.cloneOverrides,
				description: update.description,
			},
		});
		if (!response?.template?.id) throw new Error('updateTemplate returned no template; the clone failed.');
	},
	async deleteTemplate(session, id) {
		const response = await session.sdk?.deleteTemplate({ id });
		if (!response?.deleteTemplate) throw new Error('deleteTemplate returned no id; a rollback delete failed.');
	},
};

/** Template ids resolve case-insensitively in Rewst; canonicalize so case-variant refs dedupe. */
function canon(id: string): string {
	return id.toLowerCase();
}

/**
 * Rewrites every template('OLD') call whose id is in the map to template('NEW'),
 * leaving the surrounding Jinja/quotes intact and leaving references not in the
 * map (foreign-org or missing templates) untouched. Lookup is case-insensitive
 * to match the canonicalized node keys. Uses a fresh regex so the shared global
 * pattern's lastIndex is never a shared side effect.
 */
export function rewriteReferences(body: string, oldToNew: ReadonlyMap<string, string>): string {
	const pattern = new RegExp(TEMPLATE_PATTERN.source, 'g');
	return body.replace(pattern, (full: string, oldId: string) => {
		const newId = oldToNew.get(canon(oldId));
		return newId ? full.replace(oldId, newId) : full;
	});
}

interface ClonedNode {
	oldId: string;
	newId: string;
	name: string;
}

/** Best-effort delete of every already-created clone; returns ids that failed. */
async function rollback(deps: TemplateCloneDeps, session: Session, created: readonly ClonedNode[]): Promise<string[]> {
	const failed: string[] = [];
	for (const { newId } of created) {
		try {
			await deps.deleteTemplate(session, newId);
		} catch {
			failed.push(newId);
		}
	}
	return failed;
}

export async function runBundleClone(
	input: Record<string, unknown>,
	ctx: CapabilityContext,
	deps: TemplateCloneDeps = defaultTemplateCloneDeps,
): Promise<string> {
	const targetOrgId = requireString(input, 'orgId');
	const rootId = requireString(input, 'rootTemplateId');
	const sourceOrgIdArg = asString(input, 'sourceOrgId');

	let namePrefix = '';
	if (input.namePrefix !== undefined) {
		if (typeof input.namePrefix !== 'string') throw new Error('"namePrefix" must be a string.');
		namePrefix = input.namePrefix;
	}
	let nameSuffix = DEFAULT_NAME_SUFFIX;
	if (input.nameSuffix !== undefined) {
		if (typeof input.nameSuffix !== 'string') throw new Error('"nameSuffix" must be a string.');
		nameSuffix = input.nameSuffix;
	}
	const maxTemplates = Math.min(asPositiveInt(input, 'maxTemplates') ?? DEFAULT_MAX_TEMPLATES, MAX_MAX_TEMPLATES);
	const maxDepth = Math.min(asPositiveInt(input, 'maxDepth') ?? DEFAULT_MAX_DEPTH, MAX_MAX_DEPTH);

	// Phase 0 — fetch the root (from any session that can read it) and pin the source org.
	const fetched = await getTemplateFromAnySession(ctx.sessions, deps.getTemplate, rootId);
	if (!fetched) {
		throw new Error(`Root template ${rootId} is not reachable in any active session.`);
	}
	const { template: root, session: sourceSession } = fetched;
	const sourceOrgId = root.orgId;
	if (sourceOrgIdArg && sourceOrgId !== sourceOrgIdArg) {
		throw new Error(`Root template ${rootId} is in org ${sourceOrgId}, not ${sourceOrgIdArg}.`);
	}

	// Phase 1 — walk the transitive template() graph by RE-FETCHING each remote
	// template (local link refs are unreliable). Cycle-safe via `visited`; keys
	// are canonicalized so case-variant references resolve to one clone.
	const rootKey = canon(rootId);
	const nodes = new Map<string, { template: FullTemplateFragment; body: string }>();
	nodes.set(rootKey, { template: root, body: root.body });
	const visited = new Set<string>([rootKey]);
	const queue: { id: string; depth: number }[] = [{ id: rootKey, depth: 0 }];
	const missingReferences: string[] = [];
	const foreignReferences: { refId: string; orgId: string }[] = [];
	const skippedDepth: string[] = [];
	const skippedCap: string[] = [];

	while (queue.length > 0) {
		const { id, depth } = queue.shift()!;
		const { body } = nodes.get(id)!;
		if (depth >= maxDepth) {
			// Record the children actually dropped by the depth cap (not this node,
			// which was already cloned), mirroring the other skip lists.
			for (const rawRef of findAllTemplateReferences(body)) {
				const refKey = canon(rawRef);
				if (!visited.has(refKey)) {
					visited.add(refKey);
					skippedDepth.push(refKey);
				}
			}
			continue;
		}
		for (const rawRef of findAllTemplateReferences(body)) {
			const refKey = canon(rawRef);
			if (visited.has(refKey)) continue;
			visited.add(refKey);
			if (nodes.size >= maxTemplates) {
				skippedCap.push(refKey);
				continue;
			}
			let referenced: FullTemplateFragment;
			try {
				referenced = await deps.getTemplate(sourceSession, refKey);
			} catch (error) {
				// Only a genuine "not found" is a missing reference. A transient
				// auth/network/SDK failure must abort (before any writes) rather than
				// silently producing a partial clone with stale references.
				const message = error instanceof Error ? error.message : String(error);
				if (!/not found/i.test(message)) throw error;
				missingReferences.push(refKey);
				continue;
			}
			if (referenced.orgId !== sourceOrgId) {
				foreignReferences.push({ refId: refKey, orgId: referenced.orgId });
				continue;
			}
			nodes.set(refKey, { template: referenced, body: referenced.body });
			queue.push({ id: refKey, depth: depth + 1 });
		}
	}

	// Phase 2 — one approval scoped to (target org, root): a re-clone of the same
	// root reuses it, but a different root (or a different write tool) re-prompts.
	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = {
		scopeId: `clone:${rootId}`,
		scopeName: `clone of "${root.name}" (${nodes.size} templates)`,
		orgId: targetOrgId,
		orgName,
	};
	const summary = `Clone template "${root.name}" (${rootId}) and ${nodes.size - 1} referenced template(s) into org "${orgName}" (${targetOrgId})`;

	return withMutationApproval(scope, summary, async () => {
		const oldToNew = new Map<string, string>();
		const created: ClonedNode[] = [];
		try {
			// Phase 3a — create an empty template per node to mint new ids first, so
			// a body referencing a not-yet-created sibling never lands un-rewritten.
			for (const [oldKey, { template }] of nodes) {
				const name = `${namePrefix}${template.name}${nameSuffix}`;
				const { id: newId } = await deps.createTemplate(ctx.session, name, targetOrgId);
				oldToNew.set(oldKey, newId);
				created.push({ oldId: oldKey, newId, name });
			}
			// Phase 3b — rewrite each body to the new ids and write back source metadata.
			for (const [oldKey, { template, body }] of nodes) {
				const newId = oldToNew.get(oldKey)!;
				await deps.updateTemplate(ctx.session, {
					id: newId,
					body: rewriteReferences(body, oldToNew),
					contentType: template.contentType,
					language: template.language,
					context: template.context,
					cloneOverrides: template.cloneOverrides,
					description: template.description,
				});
			}
		} catch (error) {
			const rollbackFailures = await rollback(deps, ctx.session, created);
			const reason = error instanceof Error ? error.message : String(error);
			const detail = rollbackFailures.length
				? ` Rolled back ${created.length - rollbackFailures.length}/${created.length} created template(s); could not delete: ${rollbackFailures.join(', ')}.`
				: ` Rolled back all ${created.length} created template(s).`;
			throw new Error(`Clone failed: ${reason}${detail}`);
		}

		return json({
			status: 'cloned',
			targetOrgId,
			targetOrgName: orgName,
			sourceOrgId,
			rootTemplateId: rootId,
			newRootTemplateId: oldToNew.get(rootKey),
			count: created.length,
			idMap: created.map(node => ({ oldId: node.oldId, newId: node.newId, name: node.name })),
			foreignReferences,
			missingReferences,
			skipped: { depth: skippedDepth, cap: skippedCap },
			message: `Cloned ${created.length} template(s) into org "${orgName}". template() references were rewritten to the new ids, and each clone's contentType/language/context/cloneOverrides were copied (tags were not). Foreign-org and missing references were left unchanged — review foreignReferences and missingReferences.`,
		});
	});
}

const bundleCloneSpec: ToolSpec = {
	name: 'buddy_template_bundle_clone',
	args: '{"orgId": string, "rootTemplateId": string, "sourceOrgId"?: string, "namePrefix"?: string, "nameSuffix"?: string, "maxTemplates"?: number, "maxDepth"?: number}',
	description:
		"Deep-copy a Rewst template and the templates it references (transitively, via template('<id>') calls in the body) into NEW templates in a target org, rewriting every reference to the new template ids. Each clone copies the source name, body, contentType, language, JSON context and cloneOverrides; tags are NOT copied (they are org-scoped) and references inside context/cloneOverrides are not followed. orgId is the TARGET org the clones are created in — it must have write tools enabled, be on the write allowlist, and pass per-call approval. The source org is taken from the root template (verify it with sourceOrgId). References to templates in a different org, or that no longer exist, are left pointing at the original id and reported as foreignReferences / missingReferences. Nodes beyond maxTemplates (default 50, max 200) or maxDepth (default 10, max 25) are not cloned and are reported under skipped.cap / skipped.depth. On any failure mid-clone the templates created so far are deleted (rollback). Returns the old→new id map and the new root id; it does not create a local file link — use buddy_template_link for that.",
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			rootTemplateId: { type: 'string', description: 'Id of the root template to deep-clone.' },
			sourceOrgId: {
				type: 'string',
				description:
					'Optional id of the org the root and its references live in. Verified against the root; defaults to the root’s org.',
			},
			namePrefix: { type: 'string', description: 'Optional prefix for cloned template names.' },
			nameSuffix: {
				type: 'string',
				description: 'Optional suffix for cloned template names. Defaults to " (copy)".',
			},
			maxTemplates: {
				type: 'number',
				description: 'Max total templates to clone (root + references). Default 50, capped at 200.',
			},
			maxDepth: { type: 'number', description: 'Max reference depth to walk. Default 10, capped at 25.' },
		},
		required: ['orgId', 'rootTemplateId'],
	},
};

export const TEMPLATE_CLONE_CAPABILITIES: Capability[] = [
	{
		spec: bundleCloneSpec,
		access: 'write',
		chat: false,
		mcp: true,
		// Explicit: a write tool is org-scoped (the allowlist needs a concrete orgId).
		requiresOrg: true,
		run: (input, ctx) => runBundleClone(input, ctx),
	},
];
