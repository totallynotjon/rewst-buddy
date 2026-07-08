import { context } from '@global';
import { log } from '@utils';

export const WORKFLOW_INPUT_PROFILES_KEY = 'RewstWorkflowInputProfiles';

export interface WorkflowInputProfile {
	orgId: string;
	workflowId: string;
	name: string;
	input: Record<string, unknown>;
	updatedAt: string;
}

type ProfileMap = Record<string, WorkflowInputProfile>;

function profileKey(orgId: string, workflowId: string, name: string): string {
	return `${orgId}::${workflowId}::${name}`;
}

function loadAll(): ProfileMap {
	return context.globalState.get<ProfileMap>(WORKFLOW_INPUT_PROFILES_KEY) ?? {};
}

function saveAll(map: ProfileMap): void {
	Promise.resolve(context.globalState.update(WORKFLOW_INPUT_PROFILES_KEY, map)).catch(error =>
		log.error('WorkflowInputProfileStore: failed to persist profiles', error),
	);
}

export const WorkflowInputProfileStore = {
	/**
	 * Save (create or overwrite) a named profile for a workflow.
	 * Rejects blank names.
	 */
	save(orgId: string, workflowId: string, name: string, input: Record<string, unknown>): WorkflowInputProfile {
		name = name.trim();
		if (!name) throw new Error('Profile name must not be blank.');
		const map = loadAll();
		const key = profileKey(orgId, workflowId, name);
		const profile: WorkflowInputProfile = {
			orgId,
			workflowId,
			name,
			input,
			updatedAt: new Date().toISOString(),
		};
		map[key] = profile;
		saveAll(map);
		return profile;
	},

	/**
	 * List all profiles for a workflow, sorted by name.
	 */
	list(orgId: string, workflowId: string): WorkflowInputProfile[] {
		const map = loadAll();
		return Object.values(map)
			.filter(p => p.orgId === orgId && p.workflowId === workflowId)
			.sort((a, b) => a.name.localeCompare(b.name));
	},

	/**
	 * Get a single profile by name. Returns undefined if not found.
	 */
	get(orgId: string, workflowId: string, name: string): WorkflowInputProfile | undefined {
		const map = loadAll();
		return map[profileKey(orgId, workflowId, name)];
	},

	/**
	 * Delete a profile. Returns true if it existed, false if not found.
	 */
	delete(orgId: string, workflowId: string, name: string): boolean {
		const map = loadAll();
		const key = profileKey(orgId, workflowId, name);
		if (!(key in map)) return false;
		delete map[key];
		saveAll(map);
		return true;
	},
};
