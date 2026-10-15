import { join } from "node:path";
import type { Logger } from "pino";
import { storageRules } from "../../platform/storage.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type { HttpInstance } from "../../transport/instance.js";
import { AuthenticationService } from "./authentication/application.js";
import { authenticationCommand } from "./authentication/cli.js";
import { authenticationFailure } from "./authentication/diagnostics.js";
import {
	type MediaLinkSources,
	registerAuthentication,
} from "./authentication/http/authentication.js";
import { loadCredentials } from "./authentication/infrastructure/credentials.js";
import { ConfigurationService } from "./configuration/application/service.js";
import { parseDeploymentConfig } from "./configuration/infrastructure/deployment.js";
import {
	type ConfigurationPolicy,
	configurationPolicy,
} from "./configuration/policy.js";
import { registerSystemHttp } from "./http.js";
import type {
	AuthenticationStore,
	ResourceSettingsCoordinator,
	SystemApi,
} from "./public.js";
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
		registerHttp: (app: HttpInstance, resources: ResourceSettingsCoordinator) =>
			registerSystemHttp(
				app,
				api,
				resources,
				policy.library.maximumScanIntervalMinutes,
			),
	};
}

export async function createAuthenticationModule(options: {
	logger: Logger;
	dataDir: string;
	store: AuthenticationStore;
	secure: boolean;
	sources: MediaLinkSources;
}) {
	const logger = options.logger.child({ module: "system.authentication" });
	let credentials: Awaited<ReturnType<typeof loadCredentials>>;
	try {
		credentials = await loadCredentials(options.dataDir);
	} catch (error) {
		logger.error(
			{
				event: "auth.credentials_load_failed",
				operation: "load_credentials",
				credentialPath: join(options.dataDir, "auth.json"),
				sessionKeyPath: join(options.dataDir, "auth-session.key"),
				...authenticationFailure(error),
			},
			"Could not load authentication credentials.",
		);
		throw error;
	}
	if (credentials.initialPassword)
		logger.info(
			{
				event: "auth.credentials_initialized",
				path: join(options.dataDir, "auth.json"),
			},
			"Authentication credentials initialized.",
		);
	const service = new AuthenticationService(
		options.dataDir,
		credentials.credential,
		logger,
	);
	async function registerHttp(app: HttpInstance) {
		await registerAuthentication(app, {
			...options,
			logger,
			secret: credentials.secret,
			sessionPath: join(options.dataDir, storageRules.databaseFile),
			service,
		});
	}
	return { registerHttp, initialPassword: credentials.initialPassword };
}

export async function runAuthenticationCommand(
	command: string,
	env: Readonly<Record<string, string | undefined>>,
) {
	await authenticationCommand(command, parseDeploymentConfig(env).dataDir);
}
