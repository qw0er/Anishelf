import {
	type DeepReadonly,
	freeze,
	requirePolicy,
} from "../../../shared/policy.js";
/** Configuration retains a frozen caller-owned policy snapshot without owning resource policy. */
export type ConfigurationPolicy = object;
export const configurationPolicy = freeze({});
export function validateConfigurationPolicy(
	policy: DeepReadonly<ConfigurationPolicy>,
): void {
	requirePolicy(typeof policy === "object" && policy !== null, "configuration");
}
