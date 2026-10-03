import {
	type DeepReadonly,
	freeze,
	validateNumericPolicy,
} from "../shared/policy.js";

const defaults = { shutdownTimeoutMs: 5000 };
export type RuntimePolicy = typeof defaults;
export const runtimePolicy = freeze(defaults);
export function validateRuntimePolicy(
	policy: DeepReadonly<RuntimePolicy>,
): void {
	validateNumericPolicy("runtime", policy, defaults);
}
