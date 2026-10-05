export const defaultLanguage = "en";

/** Local presentation timing, independent of server policy. */
export const interactionPolicy = Object.freeze({
	pendingDelayMs: 200,
	compatibilityConcurrency: 2,
	compatibilityBusyRetries: 2,
	compatibilityBusyRetryDelayMs: 500,
	compatibilityCacheEntries: 128,
	compatibilityRequestTimeoutMs: 30000,
	scanPollIntervalMs: 1000,
	preparationPollIntervalMs: 1000,
	preparationRequestTimeoutMs: 30000,
	subtitlePollIntervalMs: 500,
	toastTimeoutMs: 6000,
	errorToastTimeoutMs: 10000,
	persistentToastTimeoutMs: 0,
	seekStepSeconds: 5,
	playerLoad: "eager" as const,
	playerPreload: "metadata" as const,
});
