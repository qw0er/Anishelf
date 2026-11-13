import {
	type DeepReadonly,
	freeze,
	requirePolicy,
	validateNumericPolicy,
} from "../../../../shared/policy.js";
export interface MediaProcessingPolicy {
	concurrency: number;
	processingTimeoutMs: number;
	durationToleranceSeconds: number;
}
/** Runtime and storage bounds only. Execution targets belong to future adapters. */
export const mediaProcessingPolicy = freeze<MediaProcessingPolicy>({
	concurrency: 1,
	processingTimeoutMs: 6 * 60 * 60 * 1000,
	durationToleranceSeconds: 2,
});
export function validateMediaProcessingPolicy(
	policy: DeepReadonly<MediaProcessingPolicy>,
): void {
	validateNumericPolicy("mediaProcessing", policy, mediaProcessingPolicy);
	requirePolicy(policy.concurrency === 1, "mediaProcessing.concurrency");
}
