import type {
	ExtractionEvidence,
	WorkCandidate,
} from "../identification/public.js";

export interface AcquisitionTarget {
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
	episode: number | null;
	eligible: boolean;
	reasons: string[];
	version: string;
}
export interface ReleaseAssessmentApi {
	target(key: string, signal?: AbortSignal): Promise<AcquisitionTarget>;
	assessReleaseTitle(
		title: string,
		target: AcquisitionTarget,
	): ReleaseAssessment;
}
export interface ReleaseParser {
	extractRelease(title: string): ExtractionEvidence;
}
