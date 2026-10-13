import type { DeepReadonly } from "../../shared/policy.js";
import { ConfigurationService } from "./configuration/application/service.js";
import {
	type ConfigurationPolicy,
	configurationPolicy,
} from "./configuration/policy.js";
import type { SystemApi } from "./public.js";
export async function createSystemModule(
	env: Readonly<Record<string, string | undefined>> = process.env,
	policy: DeepReadonly<ConfigurationPolicy> = configurationPolicy,
) {
	const service = await ConfigurationService.load(env, {
		library: {
			defaultScanIntervalMinutes: policy.library.defaultScanIntervalMinutes,
			maximumScanIntervalMinutes: policy.library.maximumScanIntervalMinutes,
		},
	});
	const api: SystemApi = {
		get settings() {
			return service.settings;
		},
		get deployment() {
			return service.deployment;
		},
		get environment() {
			return service.environment;
		},
		get transcodeProfiles() {
			return service.transcodeProfiles;
		},
		get snapshot() {
			return { settings: service.snapshot.settings };
		},
		update: (input) => service.update(input),
		patchSettings: (input) => service.patchSettings(input),
		selectTranscodeProfile: (id, mode) =>
			service.selectTranscodeProfile(id, mode),
	};
	return {
		api,
		registerHttp: (
			app: import("../../transport/instance.js").HttpInstance,
			resources: import("./public.js").ResourceSettingsCoordinator,
		) =>
			registerSystemHttp(
				app,
				api,
				resources,
				policy.library.maximumScanIntervalMinutes,
			),
	};
}

import { registerSystemHttp } from "./http.js";
