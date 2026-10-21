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
import type { PreparationMode } from "../settings.js";

export interface EffectiveConfiguration {
	deployment: DeploymentConfig;
	settings: PersistentSettings & {
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
		readonly transcodeProfiles: DeepReadonly<TranscodeProfile[]>,
	) {
		this.current = this.resolve();
	}
	static async load(
		env: Readonly<Record<string, string | undefined>> = process.env,
	): Promise<ConfigurationService> {
		const deployment = freeze(await loadDeploymentConfig(env));
		const persistent = await PersistentConfiguration.load(
			deployment.dataDir,
			deployment.initialResourceRoots,
			deployment.initialQbittorrentWebUiUrl,
		);
		return new ConfigurationService(
			deployment,
			persistent,
			captureRuntimeEnvironment(env),
			await loadTranscodeProfiles(deployment.dataDir),
		);
	}
	get settings(): Readonly<PersistentSettings> {
		return this.persistent.settings;
	}
	get snapshot(): DeepReadonly<EffectiveConfiguration> {
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
	private resolve(): DeepReadonly<EffectiveConfiguration> {
		return Object.freeze({
			deployment: this.deployment,
			settings: freeze({
				...this.settings,
				preparationMode: this.settings.preparationMode ?? "compatible",
				defaultTranscodeProfileId:
					this.settings.defaultTranscodeProfileId ?? defaultTranscodeProfileId,
			}),
		});
	}
}
