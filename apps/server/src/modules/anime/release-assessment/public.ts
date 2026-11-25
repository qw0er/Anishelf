import type {
	ExtractionEvidence,
	IdentificationParser,
	WorkCandidate,
} from "../identification/public.js";

export interface AcquisitionTarget {
	airing?: {
		status: string | null;
		nextEpisode: { episode: number; airingAt: number } | null;
		fetchedAt: number;
		stale: boolean;
		refreshing?: boolean;
		refreshError: boolean;
	};
	/** Ordered, deduplicated romaji/English/native/Chinese queries; at most four. */
	searchTitles: string[];
	work: WorkCandidate;
	availableEpisodes: number[];
	revision: string;
}
export interface ReleaseAttributes {
	subtitleLanguages: string[];
	subtitleFormats: string[];
	resolutions: number[];
	videoCodecs: string[];
	sources: string[];
	releaseGroups: string[];
	revision: number;
}
interface ReleaseAssessment {
	attributes?: ReleaseAttributes;
	/** The title plausibly identifies a publication whose files could be useful. */
	inspectionCandidate: boolean;
	episode: number | null;
	/** Only a confirmed single regular episode can enter the single-video flow. */
	eligible: boolean;
	reasons: string[];
	version: string;
}
export interface ReleaseFileCoverage {
	episodes: number[];
	complete: boolean;
	videos: {
		index: number;
		episodes: number[];
		subtitleIndices: number[];
		attributes: ReleaseAttributes;
	}[];
}
export interface ReleaseAssessmentApi {
	target(key: string, signal?: AbortSignal): Promise<AcquisitionTarget>;
	assessReleaseTitle(
		title: string,
		target: AcquisitionTarget,
	): ReleaseAssessment;
	mapReleaseFiles?(
		title: string,
		target: AcquisitionTarget,
		files: readonly { index: number; path: string }[],
	): ReleaseFileCoverage;
}
export interface ReleaseParser extends Pick<IdentificationParser, "extract"> {
	extractRelease(title: string): ExtractionEvidence;
}
