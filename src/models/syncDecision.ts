/**
 * Sync decision types and pure decision function for template synchronization.
 *
 * This module extracts the decision logic from SyncManager to enable
 * thorough unit testing without VS Code dependencies.
 */

import { getHash } from '../utils/getHash';

/**
 * Represents the action to take after comparing local and remote template states.
 */
export type SyncDecision =
	| { action: 'update-metadata' }
	| { action: 'download-remote' }
	| { action: 'upload-local' }
	| { action: 'conflict'; changed: 'local' | 'remote' | 'both' };

/**
 * Input parameters for determining sync action.
 */
export interface SyncDecisionParams {
	/** Timestamp from link.template.updatedAt (last known remote state) */
	localUpdatedAt: string;
	/** Timestamp from remoteTemplate.updatedAt (current remote state) */
	remoteUpdatedAt: string;
	/** Current content of the local file (doc.getText()) */
	localBody: string;
	/** Current content from the remote template */
	remoteBody: string;
	/** Hash of the body stored when the link last synced successfully */
	lastSyncedBodyHash: string;
}

/**
 * Determines the appropriate sync action based on local and remote template states.
 *
 * Decision matrix:
 * 1. Bodies match → update-metadata (just refresh link metadata, no content change needed)
 * 2. Local empty → download-remote (initial download or file was cleared)
 * 3. Timestamps represent the same instant → upload-local (remote unchanged)
 * 4. Remote hash matches the last synced hash → upload-local (remote metadata drift only)
 * 5. Local hash matches the last synced hash → download-remote (only remote body changed)
 * 6. Otherwise → conflict (local and remote bodies both changed)
 *
 * @param params - The current state of local and remote templates
 * @returns The action to take
 */
export function determineSyncAction(params: SyncDecisionParams): SyncDecision {
	const { localUpdatedAt, remoteUpdatedAt, localBody, remoteBody, lastSyncedBodyHash } = params;

	const timestampsMatch = timestampsRepresentSameInstant(localUpdatedAt, remoteUpdatedAt);

	// Check if bodies are identical (no actual content change)
	const bodySame = remoteBody === localBody;

	// Check if local file is empty (initial download scenario)
	const bodyEmpty = localBody === '';

	// Decision logic (order matters!)
	if (bodySame) {
		// Bodies match - just update link metadata with latest remote info
		return { action: 'update-metadata' };
	}

	if (bodyEmpty) {
		// Local file is empty - download the remote content
		return { action: 'download-remote' };
	}

	if (timestampsMatch) {
		// Remote hasn't changed - safe to upload
		return { action: 'upload-local' };
	}

	const localMatchesLastSync = getHash(localBody) === lastSyncedBodyHash;
	const remoteMatchesLastSync = getHash(remoteBody) === lastSyncedBodyHash;

	if (remoteMatchesLastSync) {
		return { action: 'upload-local' };
	}

	if (localMatchesLastSync) {
		return { action: 'download-remote' };
	}

	return { action: 'conflict', changed: 'both' };
}

function timestampsRepresentSameInstant(localUpdatedAt: string, remoteUpdatedAt: string): boolean {
	const localInstant = Date.parse(localUpdatedAt);
	const remoteInstant = Date.parse(remoteUpdatedAt);
	if (!Number.isNaN(localInstant) && !Number.isNaN(remoteInstant)) {
		return localInstant === remoteInstant;
	}
	return localUpdatedAt === remoteUpdatedAt;
}
