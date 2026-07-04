import { determineSyncAction, SyncDecisionParams } from './syncDecision';
import * as assert from 'assert';
import { getHash } from '../utils/getHash';

import { suite, test } from '../test/tdd';

/**
 * Helper to create SyncDecisionParams with sensible defaults.
 * Override specific fields as needed for each test.
 */
function createParams(overrides: Partial<SyncDecisionParams> = {}): SyncDecisionParams {
	const localBody = overrides.localBody ?? '// local content';
	const remoteBody = overrides.remoteBody ?? '// remote content';
	return {
		localUpdatedAt: '2024-01-01T00:00:00Z',
		remoteUpdatedAt: '2024-01-01T00:00:00Z', // Default: timestamps match
		localBody,
		remoteBody,
		lastSyncedBodyHash: getHash(remoteBody),
		...overrides,
	};
}

suite('Unit: determineSyncAction()', () => {
	suite('update-metadata (bodies match)', () => {
		test('should return update-metadata when bodies are identical', () => {
			const body = '// same content';
			const result = determineSyncAction(
				createParams({
					localBody: body,
					remoteBody: body,
				}),
			);
			assert.deepStrictEqual(result, { action: 'update-metadata' });
		});

		test('should return update-metadata when both bodies are empty', () => {
			const result = determineSyncAction(
				createParams({
					localBody: '',
					remoteBody: '',
				}),
			);
			assert.deepStrictEqual(result, { action: 'update-metadata' });
		});

		test('should return update-metadata regardless of timestamps when bodies match', () => {
			const body = '// same content';
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-06-15T12:30:00Z', // Different timestamp
					localBody: body,
					remoteBody: body,
				}),
			);
			assert.deepStrictEqual(result, { action: 'update-metadata' });
		});
	});

	suite('download-remote (local empty)', () => {
		test('should return download-remote when local body is empty', () => {
			const result = determineSyncAction(
				createParams({
					localBody: '',
					remoteBody: '// remote has content',
				}),
			);
			assert.deepStrictEqual(result, { action: 'download-remote' });
		});

		test('should return download-remote even when timestamps differ', () => {
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-06-15T12:30:00Z',
					localBody: '',
					remoteBody: '// remote has content',
				}),
			);
			assert.deepStrictEqual(result, { action: 'download-remote' });
		});
	});

	suite('upload-local (timestamps match)', () => {
		test('should return upload-local when timestamps match', () => {
			const localBody = '// local changes';
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-01-01T00:00:00Z', // Same timestamp
					localBody,
					remoteBody: '// original remote',
				}),
			);
			assert.deepStrictEqual(result, { action: 'upload-local' });
		});

		test('should compare timestamps as parsed instants rather than exact strings', () => {
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00.000Z',
					remoteUpdatedAt: '2023-12-31T19:00:00.000-05:00',
					localBody: '// local changed',
					remoteBody: '// remote changed',
					lastSyncedBodyHash: getHash('// original synced body'),
				}),
			);
			assert.deepStrictEqual(result, { action: 'upload-local' });
		});

		test('should return upload-local for whitespace-only local changes', () => {
			const localBody = '// code\n\n\n'; // Has trailing newlines
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-01-01T00:00:00Z',
					localBody,
					remoteBody: '// code', // No trailing newlines
				}),
			);
			assert.deepStrictEqual(result, { action: 'upload-local' });
		});
	});

	suite('conflict: remote changed (timestamps differ)', () => {
		test('should return conflict with changed side when local and remote both changed', () => {
			const localBody = '// local version';
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-01-02T00:00:00Z', // Remote is newer
					localBody,
					remoteBody: '// remote version',
					lastSyncedBodyHash: getHash('// original version'),
				}),
			);
			assert.deepStrictEqual(result, { action: 'conflict', changed: 'both' });
		});

		test('should return conflict with changed side when remote timestamp is older and both bodies changed', () => {
			const localBody = '// local version';
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-02T00:00:00Z',
					remoteUpdatedAt: '2024-01-01T00:00:00Z', // Remote is older (someone rolled back)
					localBody,
					remoteBody: '// rolled back version',
					lastSyncedBodyHash: getHash('// original version'),
				}),
			);
			assert.deepStrictEqual(result, { action: 'conflict', changed: 'both' });
		});
	});

	suite('hash-aware timestamp mismatch matrix', () => {
		const syncedBody = '// last synced body';
		const syncedHash = getHash(syncedBody);

		test('uploads local changes when only remote metadata drifted', () => {
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-01-02T00:00:00Z',
					localBody: '// local changed',
					remoteBody: syncedBody,
					lastSyncedBodyHash: syncedHash,
				}),
			);

			assert.deepStrictEqual(result, { action: 'upload-local' });
		});

		test('downloads remote changes when the local file still matches the last sync', () => {
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-01-02T00:00:00Z',
					localBody: syncedBody,
					remoteBody: '// remote changed',
					lastSyncedBodyHash: syncedHash,
				}),
			);

			assert.deepStrictEqual(result, { action: 'download-remote' });
		});

		test('reports a conflict for sentinel links because the stored local hash is not a last sync', () => {
			const localBody = '// local body present when link was created';
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '0',
					remoteUpdatedAt: '2024-01-02T00:00:00Z',
					localBody,
					remoteBody: '// different remote body',
					lastSyncedBodyHash: getHash(localBody),
				}),
			);

			assert.deepStrictEqual(result, { action: 'conflict', changed: 'both' });
		});

		test('reports a genuine conflict when local and remote bodies both changed', () => {
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-01-02T00:00:00Z',
					localBody: '// local changed',
					remoteBody: '// remote changed',
					lastSyncedBodyHash: syncedHash,
				}),
			);

			assert.deepStrictEqual(result, { action: 'conflict', changed: 'both' });
		});
	});

	suite('edge cases', () => {
		test('should handle unicode content correctly', () => {
			const localBody = '// コメント 🎉';
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-01-01T00:00:00Z',
					localBody,
					remoteBody: '// different content',
				}),
			);
			assert.deepStrictEqual(result, { action: 'upload-local' });
		});

		test('should treat whitespace-only differences as different bodies', () => {
			const localBody = '// code  '; // Trailing spaces
			const remoteBody = '// code'; // No trailing spaces
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-01-01T00:00:00Z',
					localBody,
					remoteBody,
				}),
			);
			// Bodies are different, timestamps match, so upload local
			assert.deepStrictEqual(result, { action: 'upload-local' });
		});

		test('should handle very large content', () => {
			const largeContent = '// line\n'.repeat(10000);
			const result = determineSyncAction(
				createParams({
					localBody: largeContent,
					remoteBody: '// small',
				}),
			);
			assert.deepStrictEqual(result, { action: 'upload-local' });
		});

		test('should handle ISO timestamp edge cases', () => {
			const localBody = '// content';

			// Milliseconds precision difference
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00.000Z',
					remoteUpdatedAt: '2024-01-01T00:00:00.001Z', // 1ms difference
					localBody,
					remoteBody: '// remote',
					lastSyncedBodyHash: getHash('// original'),
				}),
			);
			// Timestamps represent different instants and both bodies changed, so conflict
			assert.deepStrictEqual(result, { action: 'conflict', changed: 'both' });
		});
	});

	suite('priority order verification', () => {
		test('bodySame takes priority over everything else', () => {
			const body = '// same';
			// Even with timestamp mismatch and mismatch, bodySame should win
			const result = determineSyncAction({
				localUpdatedAt: '2024-01-01T00:00:00Z',
				remoteUpdatedAt: '2024-06-15T00:00:00Z', // Different
				localBody: body,
				remoteBody: body, // Same!
				lastSyncedBodyHash: getHash('// previous'),
			});
			assert.deepStrictEqual(result, { action: 'update-metadata' });
		});

		test('bodyEmpty takes priority over isInSync check', () => {
			// Even if somehow in sync, empty body should download
			const result = determineSyncAction({
				localUpdatedAt: '2024-01-01T00:00:00Z',
				remoteUpdatedAt: '2024-01-01T00:00:00Z', // Same timestamp
				localBody: '',
				remoteBody: '// content',
				lastSyncedBodyHash: getHash('// previous'),
			});
			assert.deepStrictEqual(result, { action: 'download-remote' });
		});
	});
});
