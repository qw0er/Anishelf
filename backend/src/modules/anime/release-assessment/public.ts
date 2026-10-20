import type {
	ExtractionEvidence,
	WorkCandidate,
} from "../identification/public.js";

export interface AcquisitionTarget {
	work: WorkCandidate;
	availableEpisodes: number[];
	revision: string;
}
interface ReleaseAssessment {
	episode: number | null;
	eligible: boolean;
	reasons: string[];
	version: string;
}
export interface ReleaseAssessmentApi {
	target(key: string, signal?: AbortSignal): Promise<AcquisitionTarget>;
	assess(title: string, target: AcquisitionTarget): ReleaseAssessment;
}
export interface ReleaseParser {
	extractRelease(title: string): ExtractionEvidence;
}
