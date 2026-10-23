import {
	type BuiltinPolicy,
	builtinPolicy,
	validatePolicy,
} from "../../src/app/policy.js";
import { ConfigurationService as Service } from "../../src/modules/system/configuration/application/service.js";
import type { DeepReadonly } from "../../src/shared/policy.js";
export const ConfigurationService = {
	load(
		env: Readonly<Record<string, string | undefined>> = process.env,
		policy: DeepReadonly<BuiltinPolicy> = builtinPolicy,
	) {
		validatePolicy(policy);
		return Service.load(env);
	},
};
