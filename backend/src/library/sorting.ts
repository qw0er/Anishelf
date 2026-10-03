import type { BuiltinPolicy, DeepReadonly } from "../public/policy.js";
export function nameCollator(
	policy: DeepReadonly<BuiltinPolicy>["library"],
): Intl.Collator {
	return new Intl.Collator(policy.sortLocale, {
		numeric: policy.sortNumeric,
		sensitivity: policy.sortSensitivity,
	});
}
