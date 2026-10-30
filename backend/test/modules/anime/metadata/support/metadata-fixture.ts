import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, vi } from "vitest";
import { ApplicationDatabase } from "../../../../../src/app/bootstrap/database.js";
import { AniListMetadataClient } from "../../../../../src/modules/anime/anilist/infrastructure/metadata-client.js";
import {
	type AniListOptions,
	AniListWrapper,
} from "../../../../../src/modules/anime/anilist/public.js";
import { SourceMetadataApplication as MetadataApplication } from "../../../../../src/modules/anime/metadata/application/source-metadata.js";
import { createMetadataApplication as createPublicMetadata } from "../../../../../src/modules/anime/metadata/create.js";
import { AniListProvider } from "../../../../../src/modules/anime/metadata/infrastructure/anilist.js";
import { MetadataArtworkCache } from "../../../../../src/modules/anime/metadata/infrastructure/artwork.js";

export const logger = pino({ enabled: false });

export const reference = {
	provider: "anilist",
	mediaType: "anime",
	id: "154587",
} as const;

export const noSignal = () => new AbortController().signal;

export function media(id = 154587) {
	return {
		id,
		type: "ANIME",
		title: {
			romaji: "Sousou no Frieren",
			english: "Frieren",
			native: "葬送のフリーレン",
		},
		synonyms: ["葬送的芙莉莲"],
		startDate: { year: 2023, month: 9, day: null },
		endDate: { year: 2024, month: 3, day: null },
		seasonYear: 2023,
		format: "TV",
		status: "FINISHED",
		episodes: 28,
		nextAiringEpisode: null,
		season: "FALL",
		coverImage: {
			extraLarge:
				"https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/frieren.png",
			large: null,
		},
		description: "Story",
		bannerImage: null,
		duration: 24,
		countryOfOrigin: "JP",
		source: "MANGA",
		genres: ["Adventure"],
		tags: [
			{
				name: "Magic",
				rank: 80,
				isGeneralSpoiler: false,
				isMediaSpoiler: true,
			},
		],
		studios: { nodes: [{ id: 11, name: "Madhouse" }] },
		averageScore: 90,
		siteUrl: "https://anilist.co/anime/154587",
		updatedAt: 1700000000,
		streamingEpisodes: [
			{
				title: "Episode 1",
				url: "https://example.com/watch",
				thumbnail: null,
				site: "External",
			},
		],
	};
}

export function response(query: string, variables: Record<string, number>) {
	const pageInfo = {
		currentPage: variables.page ?? 1,
		perPage: variables.perPage ?? 25,
		hasNextPage: false,
	};
	if (query.includes("SelectedAnimeSearch"))
		return { data: { Page: { pageInfo, media: [media()] } } };
	if (query.includes("AnimeRelations"))
		return {
			data: {
				Media: {
					relations: {
						edges: [
							{ relationType: "SEQUEL", node: media(200) },
							{
								relationType: "SOURCE",
								node: { ...media(300), type: "MANGA" },
							},
						],
					},
				},
			},
		};
	if (query.includes("AnimeAiring"))
		return {
			data: {
				Media: {
					airingSchedule: {
						pageInfo,
						nodes: [{ id: 100, episode: 1, airingAt: 1700000000 }],
					},
				},
			},
		};
	return { data: { Media: media(variables.id) } };
}

export function transport() {
	return vi.fn<typeof fetch>(async (_url, init) => {
		const request = JSON.parse(String(init?.body));
		return Response.json(response(request.query, request.variables));
	});
}

export function createProvider(options: AniListOptions): AniListProvider {
	return new AniListProvider(
		new AniListMetadataClient(new AniListWrapper(options)),
	);
}

export const cleanups: (() => Promise<void>)[] = [];

export async function setup(
	fetcher = transport(),
	now?: () => number,
	persistent = false,
) {
	const dir = await mkdtemp(join(tmpdir(), "anishelf-metadata-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const database = persistent
		? ApplicationDatabase.open(dir)
		: ApplicationDatabase.openMemory();
	cleanups.push(async () => database.close());
	const artwork = new MetadataArtworkCache({
		hosts: ["s4.anilist.co"],
		dataDir: dir,
		store: database.metadata,
		fetch: fetcher,
	});
	await artwork.initialize();
	const provider = createProvider({
		fetch: fetcher,
		intervalMs: 0,
		attempts: 1,
	});
	const application = new MetadataApplication({
		defaultProvider: "anilist",
		store: database.metadata,
		providers: [provider],
		artwork,
		logger,
		...(now ? { now } : {}),
	});
	cleanups.push(() => application.close());
	return {
		dir,
		database,
		application,
		fetcher,
		provider,
		artwork,
		publicMetadata: createPublicMetadata(application, database.metadata),
	};
}

export async function failure(task: Promise<unknown>, code: string) {
	await expect(task).rejects.toMatchObject({ failure: { code } });
}

export const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
	"base64",
);

export function setupTestLifecycle() {
	afterEach(async () => {
		vi.useRealTimers();
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});
}
