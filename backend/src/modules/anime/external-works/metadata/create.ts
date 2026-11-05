import type { Logger } from "pino";
import { MetadataArtworkReader } from "./application/artwork.js";
import { MetadataIdentities } from "./application/identities.js";
import { MetadataLibraryTitles } from "./application/library-titles.js";
import { MetadataNameEnrichment } from "./application/name-enrichment.js";
import { MetadataSearch } from "./application/search.js";
import { MetadataSnapshots } from "./application/snapshots.js";
import { SourceMetadataApplication } from "./application/source-metadata.js";
import { MetadataTitles } from "./application/titles.js";
import { MetadataWorkReader } from "./application/work-reader.js";
import { metadataDefaults } from "./defaults.js";
import type { TitleDisplayPreference } from "./domain/model.js";
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
	titleDisplayPreference?: () => TitleDisplayPreference;
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
		options.titleDisplayPreference,
	);
}

/** Assemble internal collaborators once; consumers receive only their required capability. */
export function createMetadataApplication(
	source: SourceMetadataApi,
	store: MetadataStore,
	logger?: Logger,
	defaultSearchProvider: () => string = () =>
		source.providers()[0]?.key ?? "anilist",
	titleDisplayPreference: () => TitleDisplayPreference = () => "native",
): MetadataModule {
	const identities = new MetadataIdentities(source, store, logger);
	const titles = new MetadataTitles(titleDisplayPreference);
	const snapshots = new MetadataSnapshots(source, store, identities, logger);
	const names = new MetadataNameEnrichment(source, logger);
	const works = new MetadataWorkReader(source, identities, snapshots, names);
	const libraryTitles = new MetadataLibraryTitles({
		store,
		...(logger ? { logger } : {}),
		load: async (reference, signal) => {
			const current = source.current(reference);
			const value = await works.get(
				identities.referenceForExternal(reference),
				{
					signal,
					...(current &&
					(current.stale || current.refreshing || current.refreshError)
						? { refresh: true }
						: {}),
				},
				{
					timeoutMs: metadataDefaults.nameVerificationTimeoutMs,
					throwOnFailure: true,
				},
			);
			if (value.stale || value.refreshError)
				throw new Error("Fresh title evidence is temporarily unavailable.");
			return value;
		},
	});
	const search = new MetadataSearch(
		source,
		identities,
		snapshots,
		logger,
		defaultSearchProvider,
		names,
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
		search: async (...args) => titles.page(await search.search(...args)),
		get: async (...args) => titles.envelope(await works.get(...args)),
		current: (reference) => {
			const value = works.current(reference);
			return value ? titles.envelope(value) : null;
		},
		relations: async (...args) => {
			const value = await works.relations(...args);
			return {
				...value,
				data: {
					...value.data,
					items: value.data.items.map((item) => ({
						...item,
						work: titles.work(item.work),
					})),
				},
			};
		},
		airing: works.airing.bind(works),
		snapshot: (id) => titles.snapshot(snapshots.snapshot(id)),
		retain: source.retain.bind(source),
		release: source.release.bind(source),
		artwork: artwork.artwork.bind(artwork),
		snapshotArtwork: artwork.snapshotArtwork.bind(artwork),
		readArtwork: source.readArtwork.bind(source),
		cachedArtworkId: artwork.cachedArtworkId.bind(artwork),
		identities,
		libraryTitles,
		providers: () =>
			source.providers().map(({ key }) => ({
				key,
				name: key === "anilist" ? "AniList" : "Bangumi",
				metadata: true as const,
				tracking: key === "anilist",
			})),
		close: async () => {
			await libraryTitles.close();
			await source.close();
		},
	};
}
