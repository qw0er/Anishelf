export const identificationPolicy = {
	maximumFiles: 500,
	parserGroupSize: 50,
	maximumQueries: 3,
	maximumBatchQueries: 100,
	metadataTimeoutMs: 15000,
	maximumCandidates: 10,
	maximumRange: 100,
	maximumEpisode: 10000,
	matcherVersion: "title-season-context-v3",
	normalizationVersion: "parser-elements-v2",
} as const;
