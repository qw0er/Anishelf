import {
	type DeepReadonly,
	freeze,
	validateNumericPolicy,
} from "../../../shared/policy.js";

const defaults = { targetSegmentDurationMs: 6000 };
export type HlsPolicy = typeof defaults;
export const hlsPolicy = freeze(defaults);
export function validateHlsPolicy(policy: DeepReadonly<HlsPolicy>): void {
	validateNumericPolicy("hls", policy, defaults);
}
