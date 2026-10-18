import {
	captureRuntimeEnvironment,
	type RuntimeEnvironment,
} from "../../../../platform/environment.js";
import { DomainError } from "../../../../shared/errors.js";
import { type DeepReadonly, freeze } from "../../../../shared/policy.js";
import type { DeploymentConfig, PersistentSettings } from "../domain/model.js";
import {
	defaultTranscodeProfileId,
	type TranscodeProfile,
} from "../domain/transcode-profiles.js";
import { loadDeploymentConfig } from "../infrastructure/deployment.js";
import { PersistentConfiguration } from "../infrastructure/persistent.js";
import { loadTranscodeProfiles } from "../infrastructure/transcode-profiles.js";
import {
	type ConfigurationPolicy,
	configurationPolicy,
	validateConfigurationPolicy,
} from "../policy.js";
import type { PreparationMode } from "../settings.js";

export interface EffectiveConfiguration<
	TPolicy extends ConfigurationPolicy = ConfigurationPolicy,
> {
	deployment: DeploymentConfig;
	policy: TPolicy;
	settings: PersistentSettings & {
		defaultTranscodeProfileId: string;
		preparationMode: PreparationMode;
	};
}
/** The composition root owns one service; consumers receive immutable snapshots. */
export class ConfigurationService<
	TPolicy extends ConfigurationPolicy = ConfigurationPolicy,
> {
	private current: DeepReadonly<EffectiveConfiguration<TPolicy>>;
	private pendingChange: Promise<void> = Promise.resolve();
	private constructor(
		readonly deployment: DeepReadonly<DeploymentConfig>,
		private readonly persistent: PersistentConfiguration,
		readonly environment: RuntimeEnvironment,
		readonly policy: DeepReadonly<TPolicy>,
		readonly transcodeProfiles: DeepReadonly<TranscodeProfile[]>,
	) {
		this.current = this.resolve();
	}
	static load(
		env?: Readonly<Record<string, string | undefined>>,
	): Promise<ConfigurationService>;
	static load<TPolicy extends ConfigurationPolicy>(
		env: Readonly<Record<string, string | undefined>>,
		policy: DeepReadonly<TPolicy>,
	): Promise<ConfigurationService<TPolicy>>;
	static async load(
		env: Readonly<Record<string, string | undefined>> = process.env,
		policy: DeepReadonly<ConfigurationPolicy> = configurationPolicy,
	): Promise<ConfigurationService> {
		validateConfigurationPolicy(policy);
		const deployment = freeze(await loadDeploymentConfig(env));
		const ownedPolicy = freeze(structuredClone(policy));
		const persistent = await PersistentConfiguration.load(
			deployment.dataDir,
			deployment.initialResourceRoots ?? deployment.initialResourceRoot,
		);
		return new ConfigurationService(
			deployment,
			persistent,
			captureRuntimeEnvironment(env),
			ownedPolicy,
			await loadTranscodeProfiles(deployment.dataDir),
		);
	}
	get settings(): Readonly<PersistentSettings> {
		return this.persistent.settings;
	}
	get snapshot(): DeepReadonly<EffectiveConfiguration<TPolicy>> {
		return this.current;
	}
	patchSettings(
		input: Partial<PersistentSettings>,
	): Promise<Readonly<PersistentSettings>> {
		const patch = structuredClone(input);
		return this.change((current) =>
			this.validatedSettings({ ...current, ...patch }, current),
		);
	}

	selectTranscodeProfile(
		profileId: string | null,
		preparationMode?: PreparationMode,
	): Promise<Readonly<PersistentSettings>> {
		return this.change((current) => {
			if (
				profileId !== null &&
				!this.transcodeProfiles.some((profile) => profile.id === profileId)
			)
				throw new DomainError(
					"INVALID_REQUEST",
					"Select an existing transcode profile.",
				);
			const next = { ...current };
			if (preparationMode !== undefined) next.preparationMode = preparationMode;
			if (profileId === null) delete next.defaultTranscodeProfileId;
			else next.defaultTranscodeProfileId = profileId;
			return next;
		});
	}
	update(settings: PersistentSettings): Promise<Readonly<PersistentSettings>> {
		const next = structuredClone(settings);
		return this.change((current) => this.validatedSettings(next, current));
	}
	private validatedSettings(
		next: PersistentSettings,
		current: Readonly<PersistentSettings>,
	) {
		if (
			next.defaultTranscodeProfileId !== undefined &&
			next.defaultTranscodeProfileId !== current.defaultTranscodeProfileId &&
			!this.transcodeProfiles.some(
				(profile) => profile.id === next.defaultTranscodeProfileId,
			)
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Select an existing transcode profile.",
			);
		return next;
	}

	private change(
		transform: (current: Readonly<PersistentSettings>) => PersistentSettings,
	): Promise<Readonly<PersistentSettings>> {
		const result = this.pendingChange.then(async () => {
			const saved = await this.persistent.update(transform(this.settings));
			this.current = this.resolve();
			return saved;
		});
		this.pendingChange = result.then(
			() => {},
			() => {},
		);
		return result;
	}
	private resolve(): DeepReadonly<EffectiveConfiguration<TPolicy>> {
		return Object.freeze({
			deployment: this.deployment,
			policy: this.policy,
			settings: freeze({
				...this.settings,
				preparationMode: this.settings.preparationMode ?? "compatible",
				defaultTranscodeProfileId:
					this.settings.defaultTranscodeProfileId ?? defaultTranscodeProfileId,
			}),
		});
	}
}
