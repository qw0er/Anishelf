import type { Logger } from "pino";
import {
	type IdentificationMetadata,
	titleEvidence,
} from "../identification/public.js";
import { MetadataArtworkReader } from "../metadata/application/artwork.js";
import { MetadataIdentities } from "../metadata/application/identities.js";
import { MetadataSearch } from "../metadata/application/search.js";
import { MetadataSnapshots } from "../metadata/application/snapshots.js";
import { SourceMetadataApplication } from "../metadata/application/source-metadata.js";
import { MetadataWorkReader } from "../metadata/application/work-reader.js";
import { MetadataArtworkCache } from "../metadata/infrastructure/artwork.js";
import type {
	MetadataProvider,
	MetadataStore,
	SourceMetadataApi,
} from "../metadata/ports.js";
import type { MetadataModule } from "../metadata/public.js";

export async function createMetadataModule(options: {
	dataDir: string;
	store: MetadataStore;
	logger: Logger;
	fetch?: typeof fetch;
	providers: MetadataProvider[];
	defaultProvider: string;
	artworkHosts: readonly string[];
	canAssociate?: (
		target: import("../metadata/public.js").WorkReference,
		other: import("../metadata/public.js").WorkReference,
	) => boolean;
}): Promise<MetadataModule> {
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
	return createMetadataApplication(
		source,
		options.store,
		options.logger,
		options.canAssociate,
	);
}

/** Assemble internal collaborators once; consumers receive only their required capability. */
export function createMetadataApplication(
	source: SourceMetadataApi,
	store: MetadataStore,
	logger?: Logger,
	canAssociate?: (
		target: import("../metadata/public.js").WorkReference,
		other: import("../metadata/public.js").WorkReference,
	) => boolean,
): MetadataModule {
	const identities = new MetadataIdentities(
		source,
		store,
		logger,
		canAssociate,
	);
	const snapshots = new MetadataSnapshots(source, store, identities, logger);
	const works = new MetadataWorkReader(source, identities, snapshots, logger);
	const search = new MetadataSearch(source, identities, snapshots, logger);
	const artwork = new MetadataArtworkReader(
		source,
		identities,
		snapshots,
		works,
	);
	logger?.debug(
		{ event: "metadata.services_configured" },
		"Metadata content, identity and snapshot services configured.",
	);
	return {
		resolveReference: identities.resolveReference.bind(identities),
		search: search.search.bind(search),
		get: works.get.bind(works),
		current: works.current.bind(works),
		relations: works.relations.bind(works),
		airing: works.airing.bind(works),
		snapshot: snapshots.snapshot.bind(snapshots),
		retain: source.retain.bind(source),
		release: source.release.bind(source),
		artwork: artwork.artwork.bind(artwork),
		snapshotArtwork: artwork.snapshotArtwork.bind(artwork),
		readArtwork: source.readArtwork.bind(source),
		cachedArtworkId: artwork.cachedArtworkId.bind(artwork),
		associations: identities,
		management: identities,
		close: source.close.bind(source),
	};
}

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
