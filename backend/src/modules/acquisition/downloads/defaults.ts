export const downloadDefaults = {
	activeIntervalMs: 5_000,
	idleIntervalMs: 60_000,
	maximumConcurrent: 2,
	pageSize: 20,
	maximumTorrentBytes: 10 * 1024 * 1024,
	historyMs: 90 * 24 * 60 * 60_000,
	retryMaximumMs: 60 * 60_000,
} as const;
