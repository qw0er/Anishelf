/** Settings port consumed by business workflows; configuration implements persistence. */
export interface PersistentSettings {
	resourceRoots: string[];
	titleDisplayPreference?: "chinese" | "native" | "english" | "romaji";
	defaultMetadataProvider?: "anilist" | "bangumi";
	defaultTranscodeProfileId?: string;
	defaultAcquisitionProfileId?: string;
	qbittorrentWebUiUrl?: string | null;
	rssRefreshIntervalMinutes?: number;
}
export interface SettingsStore {
	readonly settings: Readonly<PersistentSettings>;
	update(settings: PersistentSettings): Promise<Readonly<PersistentSettings>>;
}
