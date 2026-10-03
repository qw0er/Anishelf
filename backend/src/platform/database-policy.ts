import {
	type DeepReadonly,
	freeze,
	validateNumericPolicy,
} from "../shared/policy.js";

const defaults = { databaseBusyTimeoutMs: 5000 };
export type DatabasePolicy = typeof defaults;
export const databasePolicy = freeze(defaults);
export function validateDatabasePolicy(
	policy: DeepReadonly<DatabasePolicy>,
): void {
	validateNumericPolicy("database", policy, defaults);
}
