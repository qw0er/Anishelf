import type { TranscodeProfileCatalog } from "../../../contracts/http.js";
import {
	captureRuntimeEnvironment,
	type RuntimeEnvironment,
} from "../../../platform/environment.js";
import { DomainError } from "../../../shared/errors.js";
import type { PreparationMode } from "../../../shared/settings.js";
import type { DeploymentConfig, PersistentSettings } from "../domain/model.js";
import {
	defaultTranscodeProfileId,
	type TranscodeProfile,
} from "../domain/transcode-profiles.js";
import { loadDeploymentConfig } from "../infrastructure/deployment.js";
import { PersistentConfiguration } from "../infrastructure/persistent.js";
import { loadTranscodeProfiles } from "../infrastructure/transcode-profiles.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
	freeze,
	validatePolicy,
} from "../policy.js";

export interface EffectiveConfiguration {
	deployment: DeploymentConfig;
	policy: BuiltinPolicy;
	settings: PersistentSettings & {
		scanIntervalMinutes: number;
		defaultTranscodeProfileId: string;
		preparationMode: PreparationMode;
	};
}
/** The composition root owns one service; consumers receive immutable snapshots. */
export class ConfigurationService {
	private current: DeepReadonly<EffectiveConfiguration>;
	private pendingChange: Promise<void> = Promise.resolve();
	private constructor(
		readonly deployment: DeepReadonly<DeploymentConfig>,
		private readonly persistent: PersistentConfiguration,
		readonly environment: RuntimeEnvironment,
		readonly policy: DeepReadonly<BuiltinPolicy>,
		readonly transcodeProfiles: DeepReadonly<TranscodeProfile[]>,
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
			deployment.initialResourceRoot,
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
	get snapshot(): DeepReadonly<EffectiveConfiguration> {
		return this.current;
	}
	getTranscodeProfileCatalog(): TranscodeProfileCatalog {
		const selectedProfileId = this.snapshot.settings.defaultTranscodeProfileId;
		return {
			profiles: this.transcodeProfiles.map(
				({ id, name, description, usage, container, video, audio }) => ({
					id,
					name,
					description,
					container,
					videoEncoder: video.encoder,
					audioEncoder: audio.encoder,
					usage,
					source: id.startsWith("builtin:") ? "builtin" : "custom",
				}),
			),
			selectedProfileId,
			preparationMode: this.snapshot.settings.preparationMode,
			selectionAvailable: this.transcodeProfiles.some(
				(profile) => profile.id === selectedProfileId,
			),
		};
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
		const next = { ...settings };
		return this.change((current) => {
			// Preserve an unavailable saved choice during unrelated settings changes.
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
		});
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
	private resolve(): DeepReadonly<EffectiveConfiguration> {
		return freeze({
			deployment: this.deployment,
			policy: this.policy,
			settings: {
				...this.settings,
				preparationMode: this.settings.preparationMode ?? "compatible",
				defaultTranscodeProfileId:
					this.settings.defaultTranscodeProfileId ?? defaultTranscodeProfileId,
				scanIntervalMinutes:
					this.settings.scanIntervalMinutes ??
					this.policy.library.defaultScanIntervalMinutes,
			},
		});
	}
}
