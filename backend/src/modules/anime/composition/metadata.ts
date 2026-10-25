import type { Logger } from "pino";
import {
	type IdentificationMetadata,
	titleEvidence,
} from "../identification/public.js";
import { MetadataApplication } from "../metadata/application/metadata.js";
import { SourceMetadataApplication } from "../metadata/application/source-metadata.js";
import { MetadataArtworkCache } from "../metadata/infrastructure/artwork.js";
import type { MetadataProvider, MetadataStore } from "../metadata/ports.js";
export async function createMetadataModule(options: {
	dataDir: string;
	store: MetadataStore;
	logger: Logger;
	fetch?: typeof fetch;
	providers: MetadataProvider[];
	defaultProvider: string;
	artworkHosts: readonly string[];
}): Promise<MetadataApplication> {
	const artwork = new MetadataArtworkCache({
		hosts: options.artworkHosts,
		dataDir: options.dataDir,
		store: options.store,
		logger: options.logger,
		...(options.fetch ? { fetch: options.fetch } : {}),
	});
	await artwork.initialize();
	const source = new SourceMetadataApplication({
		defaultProvider: options.defaultProvider,
		store: options.store,
		logger: options.logger,
		artwork,
		providers: options.providers,
	});
	return new MetadataApplication(source, options.store, options.logger);
}

/** Explicit provider title ordinals only; calendar seasons/relations are not ordinals. */
export function createIdentificationMetadata(
	metadata: MetadataApplication,
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
					reference: metadata.externalReference(work.reference),
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

/** Adapt explicit Catalog/Tracking associations on input; results remain source-independent. */
export function createCatalogMetadata(
	metadata: import("../metadata/application/metadata.js").MetadataApplication,
): import("../anime-catalog/ports.js").CatalogMetadata {
	return {
		get: (reference, options) =>
			metadata.get(metadata.referenceForExternal(reference), options),
		current: (reference) =>
			metadata.current(metadata.referenceForExternal(reference)),
		snapshot: (id) => metadata.snapshot(id),
		retain: (id, owner) => metadata.retain(id, owner),
		release: (id, owner) => metadata.release(id, owner),
		snapshotArtwork: (id, kind) => metadata.snapshotArtwork(id, kind),
		readArtwork: (id) => metadata.readArtwork(id),
	};
}
