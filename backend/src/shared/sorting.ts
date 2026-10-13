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

export interface SortingPolicy {
	sortLocale: string;
	sortNumeric: boolean;
	sortSensitivity: NonNullable<Intl.CollatorOptions["sensitivity"]>;
}
export const defaultSortingPolicy = Object.freeze({
	sortLocale: "en",
	sortNumeric: true,
	sortSensitivity: "base" as const,
});
