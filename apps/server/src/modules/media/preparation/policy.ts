import {
	type DeepReadonly,
	freeze,
	validateNumericPolicy,
} from "../../../shared/policy.js";
export interface PreparationPolicy {
	cleanupIntervalMs: number;
	minimumFreeBytes: number;
	maximumQueuedTasks: number;
	progressSaveMs: number;
}
export const preparationPolicy = freeze<PreparationPolicy>({
	cleanupIntervalMs: 2 * 60 * 60 * 1000,
	minimumFreeBytes: 1024 ** 3,
	maximumQueuedTasks: 100,
	progressSaveMs: 1000,
});
export function validatePreparationPolicy(
	policy: DeepReadonly<PreparationPolicy>,
): void {
	validateNumericPolicy("preparation", policy, preparationPolicy);
}
