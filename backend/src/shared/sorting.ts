import type { DeepReadonly } from "./policy.js";
export function nameCollator(
	policy: DeepReadonly<{
		sortLocale: string;
		sortNumeric: boolean;
		sortSensitivity: NonNullable<Intl.CollatorOptions["sensitivity"]>;
	}>,
): Intl.Collator {
	return new Intl.Collator(policy.sortLocale, {
		numeric: policy.sortNumeric,
		sensitivity: policy.sortSensitivity,
	});
}
