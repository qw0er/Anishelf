export const discoveryPolicy = {
	intervalMs: 10 * 60_000,
	retryMaximumMs: 60 * 60_000,
	tickMs: 30_000,
	maximumSubscriptions: 64,
	maximumItems: 1000,
	maximumRetainedItems: 2000,
	maximumBodyBytes: 5 * 1024 * 1024,
	timeoutMs: 30_000,
	previewLifetimeMs: 5 * 60_000,
	maximumPreviews: 32,
	pageSize: 20,
} as const;
