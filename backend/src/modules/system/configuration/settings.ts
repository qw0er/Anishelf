export type PreparationMode = "compatible" | "fast";

/** Settings port consumed by business workflows; configuration implements persistence. */
export interface PersistentSettings {
	resourceRoots: string[];
	defaultMetadataProvider?: "anilist" | "bangumi";
	autoPreparationEnabled?: boolean;
	autoPreparationPresetId?: string;
	preparationMode?: PreparationMode;
	transcodeCacheBudgetGiB?: number;
	defaultTranscodeProfileId?: string;
	defaultAcquisitionProfileId?: string;
	qbittorrentWebUiUrl?: string | null;
	rssRefreshIntervalMinutes?: number;
}
export interface SettingsStore {
	readonly settings: Readonly<PersistentSettings>;
	update(settings: PersistentSettings): Promise<Readonly<PersistentSettings>>;
}
