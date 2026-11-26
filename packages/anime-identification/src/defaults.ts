export const identificationDefaults = {
	maximumQueries: 3,
	maximumCandidates: 10,
	maximumRange: 100,
	maximumEpisode: 10000,
	matcherVersion: "anitomy-metadata-title-v7",
	normalizationVersion: "anitomy-title-sources-v6",
	missingSeasonPrimaryPenalty: 12,
	missingSeasonAliasPenalty: 3,
} as const;
