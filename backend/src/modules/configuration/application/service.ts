import type { TranscodeProfileCatalog } from "../../../contracts/http.js";
import { DomainError } from "../../../shared/errors.js";
import type { DeploymentConfig, PersistentSettings } from "../domain/model.js";
import {
	defaultTranscodeProfileId,
	type TranscodeProfile,
} from "../domain/transcode-profiles.js";
import {
	captureRuntimeEnvironment,
	loadDeploymentConfig,
} from "../infrastructure/deployment.js";
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
	};
}
/** The composition root owns one service; consumers receive immutable snapshots. */
export class ConfigurationService {
	private current: DeepReadonly<EffectiveConfiguration>;
	private pendingChange: Promise<void> = Promise.resolve();
	private constructor(
		readonly deployment: DeepReadonly<DeploymentConfig>,
		private readonly persistent: PersistentConfiguration,
		readonly environment: ReturnType<typeof captureRuntimeEnvironment>,
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
				({ id, name, description, usage }) => ({
					id,
					name,
					description,
					usage,
					source: id.startsWith("builtin:") ? "builtin" : "custom",
				}),
			),
			selectedProfileId,
			selectionAvailable: this.transcodeProfiles.some(
				(profile) => profile.id === selectedProfileId,
			),
		};
	}
	selectTranscodeProfile(
		profileId: string | null,
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
				defaultTranscodeProfileId:
					this.settings.defaultTranscodeProfileId ?? defaultTranscodeProfileId,
				scanIntervalMinutes:
					this.settings.scanIntervalMinutes ??
					this.policy.library.defaultScanIntervalMinutes,
			},
		});
	}
}
