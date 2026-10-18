export type PreparationMode = "compatible" | "fast";

/** Settings port consumed by business workflows; configuration implements persistence. */
export interface PersistentSettings {
	resourceRoots: string[];
	preparationMode?: PreparationMode;
	transcodeCacheBudgetGiB?: number;
	defaultTranscodeProfileId?: string;
}
export interface SettingsStore {
	readonly settings: Readonly<PersistentSettings>;
	update(settings: PersistentSettings): Promise<Readonly<PersistentSettings>>;
}
