import { determineSyncAction, SyncDecisionParams } from './syncDecision';
import * as assert from 'assert';
import * as Mocha from 'mocha';

const { suite, test } = Mocha;

/**
 * Helper to create SyncDecisionParams with sensible defaults.
 * Override specific fields as needed for each test.
 */
function createParams(overrides: Partial<SyncDecisionParams> = {}): SyncDecisionParams {
	const localBody = overrides.localBody ?? '// local content';
	return {
		localUpdatedAt: '2024-01-01T00:00:00Z',
		remoteUpdatedAt: '2024-01-01T00:00:00Z', // Default: timestamps match
		localBody,
		remoteBody: '// remote content',
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
		test('should return conflict when remote timestamp is newer', () => {
			const localBody = '// local version';
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-01T00:00:00Z',
					remoteUpdatedAt: '2024-01-02T00:00:00Z', // Remote is newer
					localBody,
					remoteBody: '// remote version',
				}),
			);
			assert.deepStrictEqual(result, { action: 'conflict' });
		});

		test('should return conflict when remote timestamp is older (rollback scenario)', () => {
			const localBody = '// local version';
			const result = determineSyncAction(
				createParams({
					localUpdatedAt: '2024-01-02T00:00:00Z',
					remoteUpdatedAt: '2024-01-01T00:00:00Z', // Remote is older (someone rolled back)
					localBody,
					remoteBody: '// rolled back version',
				}),
			);
			assert.deepStrictEqual(result, { action: 'conflict' });
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
				}),
			);
			// Timestamps don't match exactly, so conflict
			assert.deepStrictEqual(result, { action: 'conflict' });
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
			});
			assert.deepStrictEqual(result, { action: 'download-remote' });
		});
	});
});
