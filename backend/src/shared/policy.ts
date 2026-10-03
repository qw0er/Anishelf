import { DomainError } from "./errors.js";
export type DeepReadonly<T> = T extends object
	? { readonly [K in keyof T]: DeepReadonly<T[K]> }
	: T;
export function freeze<T>(value: T): DeepReadonly<T> {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value as DeepReadonly<T>;
}
export function requirePolicy(condition: boolean, path: string): void {
	if (!condition)
		throw new DomainError(
			"CONFIG_INVALID",
			`policy.${path} has an invalid or unsupported value.`,
		);
}
/** Numeric limits shared by module validators; semantic checks stay with their owner. */
export function validateNumericPolicy(
	section: string,
	values: object,
	defaults: object = values,
): void {
	for (const [key, value] of Object.entries(defaults)) {
		if (typeof value === "number")
			requirePolicy(
				typeof (values as Record<string, unknown>)[key] === "number",
				`${section}.${key}`,
			);
	}

	for (const [key, value] of Object.entries(values)) {
		if (typeof value !== "number") continue;
		const valid =
			key === "nearEndRatio"
				? Number.isFinite(value) && value > 0 && value <= 1
				: Number.isSafeInteger(value) &&
					(key === "defaultScanIntervalMinutes" || key === "crf"
						? value >= 0
						: value > 0);
		requirePolicy(
			valid && (!key.endsWith("Ms") || value <= 2147483647),
			`${section}.${key}`,
		);
	}
}
