import {
	type DeepReadonly,
	freeze,
	validateNumericPolicy,
} from "../shared/policy.js";

const defaults = { httpBodyMaximumBytes: 64 * 1024 };
export type HttpPolicy = typeof defaults;
export const httpPolicy = freeze(defaults);
export function validateHttpPolicy(policy: DeepReadonly<HttpPolicy>): void {
	validateNumericPolicy("http", policy, defaults);
}
