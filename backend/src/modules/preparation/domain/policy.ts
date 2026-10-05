import {
	type DeepReadonly,
	freeze,
	validateNumericPolicy,
} from "../../../shared/policy.js";
export interface PreparationPolicy {
	maximumCacheBytes: number;
	minimumFreeBytes: number;
	maximumQueuedTasks: number;
	listLimit: number;
	progressSaveMs: number;
}
export const preparationPolicy = freeze<PreparationPolicy>({
	maximumCacheBytes: 10 * 1024 * 1024 * 1024,
	minimumFreeBytes: 64 * 1024 * 1024,
	maximumQueuedTasks: 100,
	listLimit: 200,
	progressSaveMs: 1000,
});
export function validatePreparationPolicy(
	policy: DeepReadonly<PreparationPolicy>,
): void {
	validateNumericPolicy("preparation", policy, preparationPolicy);
}
