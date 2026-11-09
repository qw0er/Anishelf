import type { Logger } from "pino";
import {
	captureRuntimeEnvironment,
	type RuntimeEnvironment,
} from "../../../../platform/environment.js";
import type { EncodingValidation } from "../../../../platform/media/encoding.js";
import { DomainError } from "../../../../shared/errors.js";
import { fingerprint } from "../../../../shared/fingerprint.js";
import { type DeepReadonly, freeze } from "../../../../shared/policy.js";
import type { ProfileCatalogIssue } from "../../../../shared/profile-issue.js";
import type { AutoPreparationPreset } from "../domain/auto-preparation.js";
import type { DeploymentConfig, PersistentSettings } from "../domain/model.js";
import {
	defaultTranscodeProfileId,
	type TranscodeProfile,
} from "../domain/transcode-profiles.js";
import { loadAutoPreparationPresets } from "../infrastructure/auto-preparation.js";
import { loadDeploymentConfig } from "../infrastructure/deployment.js";
import { PersistentConfiguration } from "../infrastructure/persistent.js";
import { loadTranscodeProfiles } from "../infrastructure/transcode-profiles.js";
import type { TranscodeProfileValidator } from "../profile.js";

export interface EffectiveConfiguration {
	deployment: DeploymentConfig;
	settings: PersistentSettings & {
		defaultTranscodeProfileId: string;
	};
}
/** The composition root owns one service; consumers receive immutable snapshots. */
export class ConfigurationService {
	private readonly listeners = new Set<() => void>();
	onSettingsChanged(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	private validator?: TranscodeProfileValidator | undefined;
	transcodeValidation: Record<string, EncodingValidation> = {};
	get transcodeRevision(): string {
		return fingerprint({
			profiles: this.transcodeProfiles,
			presets: this.autoPreparationPresets,
		});
	}
	async configureTranscodeValidation(
		validator: TranscodeProfileValidator,
		logger?: Logger,
	): Promise<void> {
		this.validator = validator;
		await this.refreshTranscodeValidation();
		logger?.info(
			{
				event: "configuration.transcode_profiles_loaded",
				revision: this.transcodeRevision,
				count: this.transcodeProfiles.length,
				restartRequiredForFileChanges: true,
			},
			"Transcode profiles loaded.",
		);
	}
	async refreshTranscodeValidation(): Promise<void> {
		if (!this.validator) return;
		const current = this.transcodeProfiles;
		const checked = await this.validator(current);
		if (this.transcodeProfiles !== current) return;
		this.transcodeProfiles = freeze(checked.profiles);
		this.transcodeValidation = checked.validation;
	}
	private current: DeepReadonly<EffectiveConfiguration>;
	private pendingChange: Promise<void> = Promise.resolve();
	private constructor(
		readonly deployment: DeepReadonly<DeploymentConfig>,
		private readonly persistent: PersistentConfiguration,
		readonly environment: RuntimeEnvironment,
		public transcodeProfiles: DeepReadonly<TranscodeProfile[]>,
		public transcodeProfileIssue: ProfileCatalogIssue | undefined,
		public autoPreparationPresets: DeepReadonly<AutoPreparationPreset[]>,
		public autoPreparationIssue: ProfileCatalogIssue | undefined,
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
		const transcode = await loadTranscodeProfiles(deployment.dataDir);
		const automatic = await loadAutoPreparationPresets(
			deployment.dataDir,
			transcode.profiles,
		);
		return new ConfigurationService(
			deployment,
			persistent,
			captureRuntimeEnvironment(env),
			transcode.profiles,
			transcode.issue,
			automatic.presets,
			automatic.issue,
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
	): Promise<Readonly<PersistentSettings>> {
		return this.change((current) => {
			if (
				profileId !== null &&
				!this.transcodeProfiles.some(
					(profile) =>
						profile.id === profileId &&
						this.transcodeValidation[profile.id]?.status !== "unsupported",
				)
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
				(profile) =>
					profile.id === next.defaultTranscodeProfileId &&
					this.transcodeValidation[profile.id]?.status !== "unsupported",
			)
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Select an existing transcode profile.",
			);
		if (
			next.autoPreparationPresetId !== undefined &&
			next.autoPreparationPresetId !== current.autoPreparationPresetId &&
			!this.autoPreparationPresets.some(
				(p) => p.id === next.autoPreparationPresetId,
			)
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Select an existing automatic preparation preset.",
			);
		return next;
	}

	private change(
		transform: (current: Readonly<PersistentSettings>) => PersistentSettings,
	): Promise<Readonly<PersistentSettings>> {
		const result = this.pendingChange.then(async () => {
			const saved = await this.persistent.update(transform(this.settings));
			this.current = this.resolve();
			for (const listener of this.listeners) {
				try {
					listener();
				} catch {
					/* Subscribers cannot undo persisted settings. */
				}
			}
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
				defaultTranscodeProfileId:
					this.settings.defaultTranscodeProfileId ?? defaultTranscodeProfileId,
			}),
		});
	}
}
