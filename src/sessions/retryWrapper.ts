import { log } from '@utils';
import { SdkFunctionWrapper } from 'sessions/graphql/sdk';

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
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
			try {
				return await action();
			} catch (error) {
				lastError = error as Error;

				if (attempt === options.maxRetries) {
					log.error(
						`GraphQL operation '${operationName}' failed after ${options.maxRetries} retries: ${lastError.message}`,
					);
					break;
				}

				const shouldRetry = isRetryableError(lastError);
				if (!shouldRetry) {
					log.debug(
						`GraphQL operation '${operationName}' failed with non-retryable error: ${lastError.message}`,
					);
					break;
				}

				const delay = Math.min(options.baseDelay * Math.pow(2, attempt), options.maxDelay);
				log.debug(
					`GraphQL operation '${operationName}' failed (attempt ${attempt + 1}/${options.maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`,
				);

				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		throw lastError;
	};
}
