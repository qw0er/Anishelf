import {
	defaultLanguage,
	libraryConstraints,
} from "../../../contracts/defaults.js";
import { DomainError } from "../../../shared/errors.js";
import {
	type DeepReadonly,
	freeze,
	requirePolicy,
	validateNumericPolicy,
} from "../../../shared/policy.js";

const defaults = {
	...libraryConstraints,
	concurrency: 8,
	warningMessageLimit: 5,
	sortLocale: defaultLanguage,
	sortNumeric: true,
	sortSensitivity: "base" as NonNullable<Intl.CollatorOptions["sensitivity"]>,
	directoriesFirst: true,
};
export type LibraryPolicy = typeof defaults;
export const libraryPolicy = freeze(defaults);
export function validateLibraryPolicy(
	policy: DeepReadonly<LibraryPolicy>,
): void {
	validateNumericPolicy("library", policy, defaults);
	requirePolicy(
		policy.defaultScanIntervalMinutes <= policy.maximumScanIntervalMinutes &&
			policy.maximumScanIntervalMinutes * 60000 <= 2147483647,
		"library.scanInterval",
	);
	requirePolicy(
		typeof policy.sortNumeric === "boolean" &&
			typeof policy.directoriesFirst === "boolean" &&
			typeof policy.sortLocale === "string",
		"library.sorting",
	);
	try {
		new Intl.Collator(policy.sortLocale, {
			numeric: policy.sortNumeric,
			sensitivity: policy.sortSensitivity,
		});
	} catch (cause) {
		throw new DomainError(
			"CONFIG_INVALID",
			"policy.library sorting is invalid.",
			{ cause },
		);
	}
}

import {
	type ResourceAccessRuntimePolicy,
	resourceAccessRuntimePolicy,
} from "../../resource-access/public.js";
/** Capabilities injected into scanning; no dependency on configuration composition. */
export interface LibraryRuntimePolicy extends ResourceAccessRuntimePolicy {
	library: LibraryPolicy;
}
export const libraryRuntimePolicy = freeze({
	library: libraryPolicy,
	...resourceAccessRuntimePolicy,
});
