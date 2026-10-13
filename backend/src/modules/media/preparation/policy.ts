import { preparationConstraints } from "../../../contracts/defaults.js";
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
	initialListLimit: number;
	progressSaveMs: number;
}
export const preparationPolicy = freeze<PreparationPolicy>({
	maximumCacheBytes: preparationConstraints.defaultCacheBudgetGiB * 1024 ** 3,
	minimumFreeBytes: 64 * 1024 * 1024,
	maximumQueuedTasks: 100,
	listLimit: preparationConstraints.listLimit,
	initialListLimit: preparationConstraints.initialListLimit,
	progressSaveMs: 1000,
});
export function validatePreparationPolicy(
	policy: DeepReadonly<PreparationPolicy>,
): void {
	validateNumericPolicy("preparation", policy, preparationPolicy);
}
