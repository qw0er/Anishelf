import type {
	ReleaseAssessment,
	ReleaseAttributes,
	WorkCandidate,
} from "@anishelf/anime-identification";

export type { ReleaseAttributes } from "@anishelf/anime-identification";

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
