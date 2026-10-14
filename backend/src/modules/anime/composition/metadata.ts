import type { Logger } from "pino";
import {
	type IdentificationMetadata,
	titleEvidence,
} from "../identification/public.js";
import { MetadataApplication } from "../metadata/application/metadata.js";
import { AniListProvider } from "../metadata/infrastructure/anilist.js";
import { MetadataArtworkCache } from "../metadata/infrastructure/artwork.js";
import type { MetadataStore } from "../metadata/ports.js";
import type { MetadataApi } from "../metadata/public.js";
export async function createMetadataModule(options: {
	dataDir: string;
	store: MetadataStore;
	logger: Logger;
	fetch?: typeof fetch;
}): Promise<MetadataApplication> {
	const artwork = new MetadataArtworkCache({
		dataDir: options.dataDir,
		store: options.store,
		logger: options.logger,
		...(options.fetch ? { fetch: options.fetch } : {}),
	});
	await artwork.initialize();
	return new MetadataApplication({
		store: options.store,
		logger: options.logger,
		artwork,
		providers: [
			new AniListProvider(options.fetch ? { fetch: options.fetch } : {}),
		],
	});
}

/** Explicit provider title ordinals only; calendar seasons/relations are not ordinals. */
export function createIdentificationMetadata(
	metadata: MetadataApi,
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
