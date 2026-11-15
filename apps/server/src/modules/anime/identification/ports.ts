import type { ExtractionEvidence, WorkCandidate } from "./domain/model.js";

/** Reserved integration. Metadata owns cloud transport, caching and provider limits. */
export interface IdentificationMetadata {
	search(
		query: string,
		signal: AbortSignal,
		options?: { refresh?: boolean },
	): Promise<WorkCandidate[]>;
}
export interface IdentificationSourcePath {
	relativePath: string;
	filename: string;
	ancestors: string[];
}
export interface IdentificationParser {
	readonly version: string;
	extract(paths: readonly IdentificationSourcePath[]): ExtractionEvidence[];
}
