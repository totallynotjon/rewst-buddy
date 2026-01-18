/**
 * Sync decision types and pure decision function for template synchronization.
 *
 * This module extracts the decision logic from SyncManager to enable
 * thorough unit testing without VS Code dependencies.
 */

/**
 * Represents the action to take after comparing local and remote template states.
 */
export type SyncDecision =
	| { action: 'update-metadata' }
	| { action: 'download-remote' }
	| { action: 'upload-local' }
	| { action: 'conflict' };

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
}

/**
 * Determines the appropriate sync action based on local and remote template states.
 *
 * Decision matrix:
 * 1. Bodies match → update-metadata (just refresh link metadata, no content change needed)
 * 2. Local empty → download-remote (initial download or file was cleared)
 * 3. In sync (timestamps match AND hash matches) → upload-local (safe to push changes)
 * 4. Otherwise → conflict (remote changed OR file was edited externally)
 *
 * @param params - The current state of local and remote templates
 * @returns The action to take
 */
export function determineSyncAction(params: SyncDecisionParams): SyncDecision {
	const { localUpdatedAt, remoteUpdatedAt, localBody, remoteBody } = params;

	// Check if timestamps match (remote hasn't changed since last sync)
	const timestampsMatch = localUpdatedAt === remoteUpdatedAt;

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

	// Conflict: either remote changed (timestamp mismatch) or local was edited externally (hash mismatch)
	return { action: 'conflict' };
}
