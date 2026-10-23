/** Stable storage layout and security constraints; changing these requires migration. */
export const storageRules = Object.freeze({
	directoryMode: 0o700,
	fileMode: 0o600,
	settingsFile: "settings.json",
	databaseFile: "anishelf.sqlite",
	subtitleCacheSegments: Object.freeze(["cache", "subtitles"]),
	pendingSuffix: ".pending",
	sourceVersion: "stat-v1",
});
