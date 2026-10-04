/** Settings port consumed by business workflows; configuration implements persistence. */
export interface PersistentSettings {
	resourceRoot: string | null;
	scanIntervalMinutes?: number;
	defaultTranscodeProfileId?: string;
}
export interface SettingsStore {
	readonly settings: Readonly<PersistentSettings>;
	update(settings: PersistentSettings): Promise<Readonly<PersistentSettings>>;
}
