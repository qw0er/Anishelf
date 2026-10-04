import {
	type DeepReadonly,
	freeze,
	validateNumericPolicy,
} from "../../shared/policy.js";

const defaults = {
	detectionTimeoutMs: 5000,
	detectionMaximumBytes: 64 * 1024,
	capabilityMaximumBytes: 1024 * 1024,
	capabilityConcurrency: 2,
	executionTimeoutMs: 30000,
	maximumOutputBytes: 10 * 1024 * 1024,
	diagnosticMaximumBytes: 4096,
};
export type MediaToolPolicy = typeof defaults;
export const mediaToolPolicy = freeze(defaults);
export function validateMediaToolPolicy(
	policy: DeepReadonly<MediaToolPolicy>,
): void {
	validateNumericPolicy("mediaTools", policy, defaults);
}
