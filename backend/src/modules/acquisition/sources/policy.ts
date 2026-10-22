export const sourcePolicy = {
	retryMaximumMs: 60 * 60_000,
	tickMs: 30_000,
	maximumItems: 1000,
	maximumRetainedItems: 2000,
	maximumBodyBytes: 5 * 1024 * 1024,
	timeoutMs: 30_000,
} as const;
