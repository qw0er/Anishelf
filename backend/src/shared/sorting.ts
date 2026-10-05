import type { LibraryPolicy } from "../modules/library/policy.js";
import type { DeepReadonly } from "./policy.js";
export function nameCollator(
	policy: DeepReadonly<LibraryPolicy>,
): Intl.Collator {
	return new Intl.Collator(policy.sortLocale, {
		numeric: policy.sortNumeric,
		sensitivity: policy.sortSensitivity,
	});
}
