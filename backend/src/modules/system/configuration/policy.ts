import { libraryConstraints } from "../../../contracts/defaults.js";
import {
	type DeepReadonly,
	freeze,
	validateNumericPolicy,
} from "../../../shared/policy.js";
export interface ConfigurationPolicy {
	library: {
		defaultScanIntervalMinutes: number;
		maximumScanIntervalMinutes: number;
	};
}
export const configurationPolicy = freeze<ConfigurationPolicy>({
	library: {
		defaultScanIntervalMinutes: libraryConstraints.defaultScanIntervalMinutes,
		maximumScanIntervalMinutes: libraryConstraints.maximumScanIntervalMinutes,
	},
});
export function validateConfigurationPolicy(
	policy: DeepReadonly<ConfigurationPolicy>,
): void {
	validateNumericPolicy(
		"configuration",
		policy.library,
		configurationPolicy.library,
	);
}
