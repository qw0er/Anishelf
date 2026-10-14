import type { Logger } from "pino";
import type { IdentificationMetadata } from "../identification/public.js";
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

/** Consumer projection deliberately leaves series season/part unknown. */
export function createIdentificationMetadata(
	metadata: MetadataApi,
): IdentificationMetadata {
	return {
		search: async (query, signal) => {
			const result = await metadata.search({ query }, { signal });
			return result.data.items.map((work) => ({
				reference: work.reference,
				snapshotId: result.snapshotId,
				titles: work.titles.map((title) => title.value),
				year: work.year,
				format: work.format,
				episodeCount: work.episodeCount,
				season: null,
				part: null,
			}));
		},
	};
}
