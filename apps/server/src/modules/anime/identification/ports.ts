import type { WorkCandidate } from "@anishelf/anime-identification";

/** Reserved integration. Metadata owns cloud transport, caching and provider limits. */
export interface IdentificationMetadata {
	search(
		query: string,
		signal: AbortSignal,
		options?: { refresh?: boolean },
	): Promise<WorkCandidate[]>;
}
