import type { DeploymentConfig, PersistentSettings } from "../domain/model.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
	freeze,
	validatePolicy,
} from "../domain/policy.js";
import {
	captureRuntimeEnvironment,
	loadDeploymentConfig,
} from "../infrastructure/deployment.js";
import { PersistentConfiguration } from "../infrastructure/persistent.js";

export interface EffectiveConfiguration {
	deployment: DeploymentConfig;
	policy: BuiltinPolicy;
	settings: PersistentSettings & { scanIntervalMinutes: number };
}
/** The composition root owns one service; consumers receive immutable snapshots. */
export class ConfigurationService {
	private current: DeepReadonly<EffectiveConfiguration>;
	private constructor(
		readonly deployment: DeepReadonly<DeploymentConfig>,
		private readonly persistent: PersistentConfiguration,
		readonly environment: ReturnType<typeof captureRuntimeEnvironment>,
		readonly policy: DeepReadonly<BuiltinPolicy>,
	) {
		this.current = this.resolve();
	}
	static async load(
		env: Readonly<Record<string, string | undefined>> = process.env,
		policy: DeepReadonly<BuiltinPolicy> = builtinPolicy,
	): Promise<ConfigurationService> {
		validatePolicy(policy);
		const deployment = freeze(await loadDeploymentConfig(env));
		const ownedPolicy = freeze(structuredClone(policy));
		const persistent = await PersistentConfiguration.load(
			deployment.dataDir,
			ownedPolicy.library.maximumScanIntervalMinutes,
		);
		return new ConfigurationService(
			deployment,
			persistent,
			captureRuntimeEnvironment(env),
			ownedPolicy,
		);
	}
	get settings(): Readonly<PersistentSettings> {
		return this.persistent.settings;
	}
	get snapshot(): DeepReadonly<EffectiveConfiguration> {
		return this.current;
	}
	async update(
		settings: PersistentSettings,
	): Promise<Readonly<PersistentSettings>> {
		const saved = await this.persistent.update(settings);
		this.current = this.resolve();
		return saved;
	}
	private resolve(): DeepReadonly<EffectiveConfiguration> {
		return freeze({
			deployment: this.deployment,
			policy: this.policy,
			settings: {
				...this.settings,
				scanIntervalMinutes:
					this.settings.scanIntervalMinutes ??
					this.policy.library.defaultScanIntervalMinutes,
			},
		});
	}
}
