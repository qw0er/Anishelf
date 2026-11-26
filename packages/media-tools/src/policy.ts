import { MediaToolError } from "./errors.ts";

export type DeepReadonly<T> = T extends object
	? { readonly [K in keyof T]: DeepReadonly<T[K]> }
	: T;

function freeze<T>(value: T): DeepReadonly<T> {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value as DeepReadonly<T>;
}

const defaults = {
	detectionTimeoutMs: 30000,
	detectionRetryIntervalMs: 10000,
	detectionMaximumBytes: 64 * 1024,
	capabilityMaximumBytes: 1024 * 1024,
	capabilityConcurrency: 2,
	executionTimeoutMs: 30000,
	maximumOutputBytes: 10 * 1024 * 1024,
	diagnosticMaximumBytes: 4096,
	processingStartupTimeoutMs: 30000,
	processingStallTimeoutMs: 90000,
	processingStopGraceMs: 2000,
	progressMaximumBytes: 64 * 1024,
};

export type MediaToolPolicy = typeof defaults;
export const mediaToolPolicy = freeze(defaults);

export function validateMediaToolPolicy(
	policy: DeepReadonly<MediaToolPolicy>,
): void {
	const record = policy as Record<string, unknown>;
	for (const [key, value] of Object.entries(defaults)) {
		if (typeof value === "number" && typeof record[key] !== "number") {
			throw new MediaToolError(
				"CONFIG_INVALID",
				`policy.mediaTools.${key} has an invalid or unsupported value.`,
			);
		}
	}

	for (const [key, value] of Object.entries(policy)) {
		if (typeof value !== "number") continue;
		const valid =
			Number.isSafeInteger(value) &&
			value > 0 &&
			(!key.endsWith("Ms") || value <= 2147483647);
		if (!valid) {
			throw new MediaToolError(
				"CONFIG_INVALID",
				`policy.mediaTools.${key} has an invalid or unsupported value.`,
			);
		}
	}
}
