export { identificationDefaults } from "./defaults.ts";
export { mappingSelection, proposeMapping } from "./mapping.ts";
export { rankCandidates } from "./matching.ts";
export type {
	ExtractionEvidence,
	IdentificationResult,
	MappingProposal,
	RankedCandidate,
	WorkCandidate,
} from "./model.ts";
export { applyNumberingContext } from "./numbering-context.ts";
export {
	AnitomyIdentificationParser,
	type IdentificationParser,
	type IdentificationSourcePath,
} from "./parser.ts";
export {
	assessReleaseTitle,
	type ReleaseAssessment,
	type ReleaseParser,
	releaseFilenameMatchesEpisode,
} from "./release.ts";
export {
	type ReleaseAttributes,
	releaseAttributes,
} from "./release-attributes.ts";
export { mapReleaseVideos } from "./release-files.ts";
export { identificationSearchQueries } from "./search-queries.ts";
export {
	matchingTitle,
	normalizeTitle,
	romanSeasonEvidence,
	titleEvidence,
} from "./title-evidence.ts";
export { workCandidate } from "./work-candidate.ts";
