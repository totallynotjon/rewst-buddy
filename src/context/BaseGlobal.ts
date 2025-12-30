export function createGlobal<T extends object>(): T & { init: (instance: T) => void; isInitialized: boolean } {
	let _instance: T | undefined;
	let initialized = false;

	const globalProxy = new Proxy({} as any, {
		get(target, prop) {
			// Handle special methods
			if (prop === 'init') {
				return (instance: T) => {
					_instance = instance;
					initialized = true;
					// Store the instance - proxy will delegate to it
				};
			}

			if (prop === 'isInitialized') {
				return initialized;
			}

			// Ensure instance is initialized
			if (!initialized || !_instance) {
				throw new Error(`Global object not initialized. Call init() first.`);
			}

			// Return property from the actual instance
			const value = (_instance as any)[prop];

			// If it's a function, bind it to the original instance
			if (typeof value === 'function') {
				return value.bind(_instance);
			}

			return value;
		},

		set(target, prop, value) {
			if (!initialized || !_instance) {
				throw new Error(`Global object not initialized. Call init() first.`);
			}

			// Set on both the instance and the proxy target
			(_instance as any)[prop] = value;
			target[prop] = value;
			return true;
		},
	});

	return globalProxy;
}
