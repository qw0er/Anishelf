import {
	type DeepReadonly,
	freeze,
	validateNumericPolicy,
} from "../../../shared/policy.js";

const defaults = { probeConcurrency: 2 };
export type MediaInspectionPolicy = typeof defaults;
export const mediaInspectionPolicy = freeze(defaults);
export function validateMediaInspectionPolicy(
	policy: DeepReadonly<MediaInspectionPolicy>,
): void {
	validateNumericPolicy("mediaInspection", policy, defaults);
}
