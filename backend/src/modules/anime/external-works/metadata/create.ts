import type { Logger } from "pino";
import { MetadataArtworkReader } from "./application/artwork.js";
import { MetadataIdentities } from "./application/identities.js";
import { MetadataSearch } from "./application/search.js";
import { MetadataSnapshots } from "./application/snapshots.js";
import { SourceMetadataApplication } from "./application/source-metadata.js";
import { MetadataWorkReader } from "./application/work-reader.js";
import { MetadataArtworkCache } from "./infrastructure/artwork.js";
import type {
	MetadataProvider,
	MetadataStore,
	SourceMetadataApi,
} from "./ports.js";
import type { MetadataModule } from "./public.js";

export async function createMetadataModule(options: {
	dataDir: string;
	store: MetadataStore;
	logger: Logger;
	fetch?: typeof fetch;
	providers: MetadataProvider[];
	defaultProvider: string;
	artworkHosts: readonly string[];
	defaultSearchProvider?: () => string;
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
		options.defaultSearchProvider ?? (() => options.defaultProvider),
	);
}

/** Assemble internal collaborators once; consumers receive only their required capability. */
export function createMetadataApplication(
	source: SourceMetadataApi,
	store: MetadataStore,
	logger?: Logger,
	defaultSearchProvider: () => string = () =>
		source.providers()[0]?.key ?? "anilist",
): MetadataModule {
	const identities = new MetadataIdentities(source, store, logger);
	const snapshots = new MetadataSnapshots(source, store, identities, logger);
	const works = new MetadataWorkReader(source, identities, snapshots);
	const search = new MetadataSearch(
		source,
		identities,
		snapshots,
		logger,
		defaultSearchProvider,
	);
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
		identities,
		providers: () =>
			source.providers().map(({ key }) => ({
				key,
				name: key === "anilist" ? "AniList" : "Bangumi",
				metadata: true as const,
				tracking: key === "anilist",
			})),
		close: source.close.bind(source),
	};
}
