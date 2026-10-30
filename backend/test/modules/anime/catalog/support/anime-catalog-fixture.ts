import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pino from "pino";
import { afterEach, vi } from "vitest";
import { ApplicationDatabase } from "../../../../../src/app/bootstrap/database.js";
import { AnimeCatalogApplication } from "../../../../../src/modules/anime/anime-catalog/application/catalog.js";
import type { MappingSelection } from "../../../../../src/modules/anime/anime-catalog/public.js";
import { createIdentificationMetadata } from "../../../../../src/modules/anime/integration/identification-metadata.js";
import { SourceMetadataApplication as MetadataApplication } from "../../../../../src/modules/anime/metadata/application/source-metadata.js";
import { createMetadataApplication as createPublicMetadata } from "../../../../../src/modules/anime/metadata/create.js";
import type { WorkDetails } from "../../../../../src/modules/anime/metadata/domain/source-model.js";
import { MetadataArtworkCache } from "../../../../../src/modules/anime/metadata/infrastructure/artwork.js";
import type { MetadataProvider } from "../../../../../src/modules/anime/metadata/ports.js";
import { createIdentificationModule } from "../../../../../src/modules/anime/workflows/create-identification.js";
import { LibraryIndex } from "../../../../../src/modules/resources/library/infrastructure/index.js";
import { createLibraryModule } from "../../../../support/library.js";
import { settingsStore } from "../../../../support/settings-store.js";

export const logger = pino({ enabled: false });

export const reference = {
	provider: "fixture",
	mediaType: "anime",
	id: "1",
} as const;

export function details(id = "1"): WorkDetails {
	return {
		reference: { ...reference, id },
		unavailableFields: [],
		titles: [
			{ value: `Anime ${id}`, kind: "romaji", language: null },
			{ value: "葬送のフリーレン", kind: "native", language: null },
		],
		year: 2023,
		format: "TV",
		status: "FINISHED",
		episodeCount: 12,
		nextAiringEpisode: null,
		airingSeason: "FALL",
		coverUrl: null,
		description: "Original provider text",
		bannerUrl: null,
		startDate: null,
		endDate: null,
		durationMinutes: null,
		country: null,
		source: null,
		genres: [],
		tags: [],
		studios: [],
		averageScore: null,
		siteUrl: null,
		providerUpdatedAt: null,
		streamingEpisodes: [],
		episodeCatalog: "unavailable",
	};
}

export function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing fixture value");
	return value;
}

export const cleanups: (() => Promise<void>)[] = [];

export async function fixture(
	paths = ["Anime - 01.mkv"],
	artworkFetch?: typeof fetch,
	persistent = false,
) {
	const base = await mkdtemp(join(tmpdir(), "anishelf-catalog-"));
	cleanups.push(() => rm(base, { recursive: true, force: true }));
	const requestedRoot = join(base, "media");
	await mkdir(requestedRoot);
	const root = await realpath(requestedRoot);
	for (const path of paths) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), "original");
	}
	let database = persistent
		? ApplicationDatabase.open(join(base, "data"))
		: ApplicationDatabase.openMemory();
	let providerData = details();
	const get = vi.fn<MetadataProvider["get"]>(async (ref) => ({
		data: {
			...providerData,
			reference: { ...reference, id: ref.id },
			titles:
				ref.id === providerData.reference.id
					? providerData.titles
					: details(ref.id).titles,
		},
	}));
	const provider: MetadataProvider = {
		capabilities: {
			key: "fixture",
			version: "1",
			search: true,
			details: true,
			relations: false,
			airing: false,
			streamingLinks: false,
			canonicalEpisodes: false,
		},
		get,
		search: async () => ({
			data: { items: [providerData], page: 1, perPage: 10, hasNextPage: false },
		}),
		relations: async () => ({
			data: { items: [], page: 1, perPage: 10, hasNextPage: false },
		}),
		airing: async () => ({
			data: { items: [], page: 1, perPage: 10, hasNextPage: false },
		}),
	};
	const index = new LibraryIndex();
	const configuration = settingsStore(root);
	const library = createLibraryModule({ configuration, index, logger });
	async function makeMetadata() {
		const artwork = new MetadataArtworkCache({
			hosts: ["s4.anilist.co"],
			dataDir: join(base, "data"),
			store: database.metadata,
			...(artworkFetch ? { fetch: artworkFetch } : {}),
		});
		await artwork.initialize();
		return new MetadataApplication({
			defaultProvider: "fixture",
			store: database.metadata,
			providers: [provider],
			artwork,
			logger,
		});
	}
	let metadata = await makeMetadata();
	function makeCatalog() {
		return new AnimeCatalogApplication({
			store: database.catalog,
			metadata: createPublicMetadata(metadata, database.metadata),
			sources: library.sources,
			logger,
		});
	}
	let catalog = makeCatalog();
	const automatic = createIdentificationModule({
		library,
		sources: library.sources,
		logger,
		onPublication: (results, scopeIds, signal, fileIds) =>
			catalog.publish(results, scopeIds, signal, fileIds),
	});
	cleanups.push(async () => {
		await automatic.close();
		await catalog.quiesce();
		catalog.close();
		await metadata.close();
		await library.close();
		database.close();
	});
	async function scan() {
		await library.startScan();
		await library.waitForCompletion();
		await automatic.waitForCompletion();
	}
	async function restart() {
		if (!persistent) throw new Error("Restart requires a persistent fixture.");
		await catalog.quiesce();
		catalog.close();
		await metadata.close();
		database.close();
		database = ApplicationDatabase.open(join(base, "data"));
		metadata = await makeMetadata();
		catalog = makeCatalog();
	}
	await scan();
	return {
		root,
		base,
		library,
		configuration,
		automatic,
		get,
		scan,
		restart,
		setData: (value: WorkDetails) => {
			providerData = value;
		},
		get catalog() {
			return catalog;
		},
		get publicMetadata() {
			return createPublicMetadata(metadata, database.metadata);
		},
		get database() {
			return database;
		},
		get metadata() {
			return metadata;
		},
	};
}

export function project(f: Awaited<ReturnType<typeof fixture>>, id = "1") {
	return f.publicMetadata.resolveReference(id);
}

export async function rows(
	f: Awaited<ReturnType<typeof fixture>>,
	numbers = ["1"],
): Promise<MappingSelection[]> {
	const result = await f.catalog.reviews();
	return result.items.map((item, index) => ({
		reviewId: item.id,
		revision: item.revision,
		reason: "User confirmed numbering",
		targets: [{ kind: "regular", number: numbers[index] ?? "1" }],
	}));
}

export async function confirm(
	f: Awaited<ReturnType<typeof fixture>>,
	selected = rows(f),
	id = "1",
) {
	const preview = await f.catalog.preview({
		reference: project(f, id),
		rows: await selected,
	});
	return f.catalog.confirm({
		operationKey: `operation-${preview.id}`,
		previewId: preview.id,
		replace: false,
	});
}

export async function enableAutomatic(f: Awaited<ReturnType<typeof fixture>>) {
	// Replace the local-only fixture coordinator so two publishers cannot race.
	await f.automatic.close();
	f.setData({
		...details(),
		titles: [{ value: "Anime", kind: "romaji", language: null }],
	});
	const search = f.metadata.search.bind(f.metadata);
	const searchSpy = vi
		.spyOn(f.metadata, "search")
		.mockImplementation((query, options) =>
			search({ ...query, provider: "fixture" }, options),
		);
	cleanups.push(async () => {
		searchSpy.mockRestore();
	});
	const automatic = createIdentificationModule({
		library: f.library,
		sources: f.library.sources,
		logger,
		metadata: createIdentificationMetadata(
			createPublicMetadata(f.metadata, f.database.metadata),
		),
		onPublication: (results, root, signal) =>
			f.catalog.publish(results, root, signal),
	});
	cleanups.push(() => automatic.close());
	await automatic.waitForCompletion();
	return automatic;
}

export function setupTestLifecycle() {
	afterEach(async () => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});
}
