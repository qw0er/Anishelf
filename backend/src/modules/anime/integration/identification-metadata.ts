import {
	type IdentificationMetadata,
	titleEvidence,
} from "../identification/public.js";
/** Explicit provider title ordinals only; calendar seasons/relations are not ordinals. */
export function createIdentificationMetadata(
	metadata: Pick<import("../metadata/public.js").MetadataApi, "search">,
): IdentificationMetadata {
	return {
		search: async (query, signal) => {
			const result = await metadata.search({ query }, { signal });
			return result.data.items.map((work) => {
				const titles = work.titles.map((title) => title.value);
				const evidence = titles.map(titleEvidence);
				const seasons = [...new Set(evidence.flatMap((item) => item.seasons))];
				const parts = [...new Set(evidence.flatMap((item) => item.parts))];
				return {
					reference: work.reference,
					snapshotId: result.snapshotId,
					titles: work.titles.map((title) => title.value),
					titleVariants: work.titles.map((title) => ({
						value: title.value,
						kind:
							title.kind === "alias"
								? ("alias" as const)
								: ("primary" as const),
						language: title.language,
					})),
					year: work.year,
					format: work.format,
					episodeCount: work.episodeCount,
					season: seasons.length === 1 ? (seasons[0] ?? null) : null,
					part: parts.length === 1 ? (parts[0] ?? null) : null,
					ordinalSource: "provider-title" as const,
				};
			});
		},
	};
}
