export const identificationPolicy = {
	maximumFiles: 500,
	parserGroupSize: 50,
	maximumQueries: 3,
	maximumBatchQueries: 100,
	metadataTimeoutMs: 15000,
	maximumCandidates: 10,
	maximumRange: 100,
	maximumEpisode: 10000,
	matcherVersion: "canonical-evidence-numbering-v5",
	normalizationVersion: "anitomy-adapter-v4",
} as const;
