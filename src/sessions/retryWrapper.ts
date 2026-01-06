import { SdkFunctionWrapper } from '@sessions';
import { log } from '@utils';

export interface RetryOptions {
	maxRetries: number;
	baseDelay: number;
	maxDelay: number;
}

function isRetryableError(error: Error): boolean {
	const message = error.message.toLowerCase();

	return (
		message.includes('connect etimedout') ||
		message.includes('timeout') ||
		message.includes('network') ||
		message.includes('econnreset') ||
		message.includes('enotfound') ||
		message.includes('socket hang up') ||
		message.includes('500') ||
		message.includes('502') ||
		message.includes('503') ||
		message.includes('504')
	);
}

export function createRetryWrapper(
	options: RetryOptions = { maxRetries: 3, baseDelay: 1000, maxDelay: 10000 },
): SdkFunctionWrapper {
	return async <T>(
		action: (requestHeaders?: Record<string, string>) => Promise<T>,
		operationName: string,
	): Promise<T> => {
		log.trace('retryWrapper: starting operation', operationName);
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
			try {
				if (attempt > 0) {
					log.trace('retryWrapper: retry attempt', { operation: operationName, attempt: attempt + 1 });
				}
				const result = await action();
				if (attempt > 0) {
					log.debug('retryWrapper: succeeded after retry', {
						operation: operationName,
						attempt: attempt + 1,
					});
				} else {
					log.trace('retryWrapper: succeeded', operationName);
				}
				return result;
			} catch (error) {
				lastError = error as Error;

				if (attempt === options.maxRetries) {
					log.error(
						`retryWrapper: '${operationName}' failed after ${options.maxRetries} retries: ${lastError.message}`,
					);
					break;
				}

				const shouldRetry = isRetryableError(lastError);
				if (!shouldRetry) {
					log.debug('retryWrapper: non-retryable error', {
						operation: operationName,
						error: lastError.message,
					});
					break;
				}

				const delay = Math.min(options.baseDelay * Math.pow(2, attempt), options.maxDelay);
				log.debug('retryWrapper: retrying', {
					operation: operationName,
					attempt: attempt + 1,
					maxAttempts: options.maxRetries + 1,
					delayMs: delay,
					error: lastError.message,
				});

				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		throw lastError;
	};
}
