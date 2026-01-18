import { SdkFunctionWrapper } from '@sessions';

/**
 * Mock response configuration for a GraphQL operation
 */
export interface MockResponse<T> {
	/** The data to return from the operation */
	data?: T;
	/** Error to throw instead of returning data */
	error?: Error;
	/** Delay in milliseconds before resolving/rejecting */
	delay?: number;
}

/**
 * Handler for a mock operation - can be static or dynamic
 */
export type MockOperationHandler<T = any> =
	| MockResponse<T>
	| ((variables: any) => MockResponse<T> | Promise<MockResponse<T>>);

/**
 * Configuration for MockWrapper
 */
export interface MockWrapperConfig {
	/** Operation-specific handlers (map operation name to response) */
	handlers?: Map<string, MockOperationHandler>;
	/** Default handler for unhandled operations */
	defaultHandler?: MockOperationHandler;
	/** Global delay for all operations (simulates network latency) */
	globalDelay?: number;
	/** Track all calls for test assertions */
	trackCalls?: boolean;
}

/**
 * Record of a single SDK operation call
 */
export interface MockWrapperCallRecord {
	operationName: string;
	operationType?: string;
	variables?: any;
	timestamp: number;
}

/**
 * Mock wrapper for SDK operations - allows configurable responses for testing
 *
 * @example
 * ```typescript
 * const wrapper = createMockWrapper();
 * wrapper
 *   .when('getTemplate', { data: Fixtures.getTemplateQuery() })
 *   .when('updateTemplateBody', (vars) => ({
 *     data: Fixtures.updateTemplateBodyMutation({ body: vars.body })
 *   }));
 *
 * const sdk = getSdk(mockClient, wrapper.getWrapper());
 * ```
 */
export class MockWrapper {
	private config: Required<Omit<MockWrapperConfig, 'defaultHandler'>> & {
		defaultHandler: MockOperationHandler | undefined;
	};
	private calls: MockWrapperCallRecord[] = [];

	constructor(config: MockWrapperConfig = {}) {
		this.config = {
			handlers: new Map(),
			defaultHandler: undefined,
			globalDelay: 0,
			trackCalls: true,
			...config,
		};
	}

	/**
	 * Configure a handler for a specific operation
	 * @param operationName - GraphQL operation name (e.g., 'getTemplate', 'User')
	 * @param response - Static response or dynamic function
	 * @returns this for chaining
	 */
	when<T>(operationName: string, response: MockOperationHandler<T>): this {
		this.config.handlers.set(operationName, response);
		return this;
	}

	/**
	 * Set a default handler for all unhandled operations
	 * @param response - Static response or dynamic function
	 * @returns this for chaining
	 */
	default<T>(response: MockOperationHandler<T>): this {
		this.config.defaultHandler = response;
		return this;
	}

	/**
	 * Get the wrapper function to pass to getSdk()
	 */
	getWrapper(): SdkFunctionWrapper {
		return async <T>(
			action: (requestHeaders?: Record<string, string>) => Promise<T>,
			operationName: string,
			operationType?: string,
			variables?: any,
		): Promise<T> => {
			// Track the call
			if (this.config.trackCalls) {
				this.calls.push({
					operationName,
					operationType,
					variables,
					timestamp: Date.now(),
				});
			}

			// Find handler
			const handler = this.config.handlers.get(operationName) ?? this.config.defaultHandler;

			if (!handler) {
				throw new Error(
					`No mock handler configured for operation "${operationName}". ` +
						`Configure with mockWrapper.when('${operationName}', {...})`,
				);
			}

			// Resolve handler (could be static or dynamic)
			const response = typeof handler === 'function' ? await handler(variables) : handler;

			// Apply delays
			const delay = response.delay ?? this.config.globalDelay ?? 0;
			if (delay > 0) {
				await new Promise(resolve => setTimeout(resolve, delay));
			}

			// Return data or throw error
			if (response.error) {
				throw response.error;
			}

			return response.data as T;
		};
	}

	/**
	 * Get all recorded calls
	 */
	getCalls(): MockWrapperCallRecord[] {
		return [...this.calls];
	}

	/**
	 * Get calls for a specific operation
	 */
	getCallsFor(operationName: string): MockWrapperCallRecord[] {
		return this.calls.filter(c => c.operationName === operationName);
	}

	/**
	 * Clear recorded calls
	 */
	clearCalls(): void {
		this.calls = [];
	}

	/**
	 * Reset wrapper to initial state (clears calls and handlers)
	 */
	reset(): void {
		this.calls = [];
		this.config.handlers.clear();
		this.config.defaultHandler = undefined;
	}
}

/**
 * Create a new MockWrapper instance
 * @param config - Optional configuration
 * @returns MockWrapper instance
 */
export function createMockWrapper(config?: MockWrapperConfig): MockWrapper {
	return new MockWrapper(config);
}
