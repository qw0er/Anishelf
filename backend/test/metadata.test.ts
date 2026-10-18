import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { AniListMetadataClient } from "../src/modules/anime/anilist/infrastructure/metadata-client.js";
import {
	type AniListOptions,
	AniListScheduler,
} from "../src/modules/anime/anilist/public.js";
import { createAniListMetadata } from "../src/modules/anime/composition/anilist.js";
import {
	createIdentificationMetadata,
	createMetadataModule,
} from "../src/modules/anime/composition/metadata.js";
import { IdentificationApplication } from "../src/modules/anime/identification/application/identification.js";
import { AnitomyIdentificationParser } from "../src/modules/anime/identification/infrastructure/parser.js";
import { MetadataApplication } from "../src/modules/anime/metadata/application/metadata.js";
import { AniListProvider } from "../src/modules/anime/metadata/infrastructure/anilist.js";
import { MetadataArtworkCache } from "../src/modules/anime/metadata/infrastructure/artwork.js";
import { metadataPolicy } from "../src/modules/anime/metadata/policy.js";
import type { CacheEntry } from "../src/modules/anime/metadata/ports.js";
import { MetadataError } from "../src/modules/anime/metadata/public.js";
import { createHttpApp } from "./support/http.js";

const logger = pino({ enabled: false });
const reference = {
	provider: "anilist",
	mediaType: "anime",
	id: "154587",
} as const;
const noSignal = () => new AbortController().signal;
function media(id = 154587) {
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
function response(query: string, variables: Record<string, number>) {
	const pageInfo = {
		currentPage: variables.page ?? 1,
		perPage: variables.perPage ?? 25,
		hasNextPage: false,
	};
	if (query.includes("SearchAnime"))
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
function transport() {
	return vi.fn<typeof fetch>(async (_url, init) => {
		const request = JSON.parse(String(init?.body));
		return Response.json(response(request.query, request.variables));
	});
}
function createProvider(options: AniListOptions): AniListProvider {
	return new AniListProvider(
		new AniListMetadataClient(new AniListScheduler(options)),
	);
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	vi.useRealTimers();
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(fetcher = transport(), now?: () => number) {
	const dir = await mkdtemp(join(tmpdir(), "anishelf-metadata-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const database = ApplicationDatabase.open(dir);
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
	return { dir, database, application, fetcher, provider, artwork };
}
async function failure(task: Promise<unknown>, code: string) {
	await expect(task).rejects.toMatchObject({ failure: { code } });
}

test("AniList search/details normalize multilingual titles, unknowns and calendar season", async () => {
	const { application, fetcher } = await setup();
	const search = await application.search({ query: "Frieren" });
	expect(search.data.items[0]).toMatchObject({
		reference,
		year: 2023,
		airingSeason: "FALL",
		episodeCount: 28,
	});
	expect(search.data.items[0]?.titles.map((title) => title.language)).toEqual([
		null,
		"en",
		null,
		null,
	]);
	const detail = await application.get(reference);
	expect(detail.data).toMatchObject({
		description: "Story",
		country: "JP",
		source: "MANGA",
		episodeCatalog: "unavailable",
		bannerUrl: null,
	});
	expect(detail.data.tags).toEqual([
		{ name: "Magic", rank: 80, spoiler: true },
	]);
	expect(detail.data.unavailableFields).toContain("bannerImage");
	expect(detail.data.startDate?.day).toBeNull();
	expect(fetcher).toHaveBeenCalledTimes(2);
	for (const [, init] of fetcher.mock.calls) {
		expect(init?.headers).not.toHaveProperty("Authorization");
		expect(JSON.parse(String(init?.body)).query).toContain("type: ANIME");
	}
});

test("fresh cache survives database restart and returned values are independent", async () => {
	const { application, dir, fetcher } = await setup();
	const first = await application.get(reference);
	first.data.titles.length = 0;
	expect((await application.get(reference)).data.titles).toHaveLength(4);
	const reopened = ApplicationDatabase.open(dir);
	try {
		const offline = vi.fn<typeof fetch>(async () => {
			throw new Error("offline");
		});
		const next = await createMetadataModule({
			dataDir: dir,
			store: reopened.metadata,
			logger,
			fetch: offline,
			...createAniListMetadata(
				new AniListScheduler({
					fetch: offline,
					intervalMs: 0,
					attempts: 1,
				}),
			),
		});
		try {
			expect((await next.get(reference, { cachedOnly: true })).snapshotId).toBe(
				first.snapshotId,
			);
			expect(offline).not.toHaveBeenCalled();
		} finally {
			await next.close();
		}
	} finally {
		reopened.close();
	}
	expect(fetcher).toHaveBeenCalledTimes(1);
});

test("stale snapshots return immediately, coalesce refresh and expose failures", async () => {
	const warn = vi.spyOn(logger, "warn");
	const debug = vi.spyOn(logger, "debug");
	let now = 1000;
	const { application, fetcher } = await setup(transport(), () => now);
	const original = await application.get(reference);
	now += metadataPolicy.finishedFreshMs + 1;
	let resolve!: (value: Response) => void;
	fetcher.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const stale = await application.get(reference);
	expect(stale).toMatchObject({
		stale: true,
		refreshing: true,
		snapshotId: original.snapshotId,
	});
	const explicit = application.get(reference, { refresh: true });
	await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
	resolve(
		Response.json({
			errors: [{ status: 500, message: "secret diagnostic" }],
			data: { Media: media() },
		}),
	);
	const retained = await explicit;
	expect(retained.snapshotId).toBe(original.snapshotId);
	expect(retained.refreshError?.code).toBe("unavailable");
	expect(retained.refreshError?.message).not.toContain("secret diagnostic");
	expect(warn).toHaveBeenCalledWith(
		expect.objectContaining({
			event: "metadata.refresh_failed",
			provider: "anilist",
			kind: "detail",
			retained: true,
			code: "unavailable",
			requestId: expect.stringMatching(/^[a-f0-9]{64}$/),
			elapsedMs: expect.any(Number),
		}),
		expect.any(String),
	);
	expect(
		debug.mock.calls.filter(
			([record]) =>
				(record as { event?: string }).event === "metadata.refresh_started",
		),
	).toHaveLength(2);
	expect(fetcher).toHaveBeenCalledTimes(2);
	await application.get(reference);
	expect(fetcher).toHaveBeenCalledTimes(2);
});

test("empty searches have short TTL and failures never create negative cache entries", async () => {
	let now = 0;
	const fetcher = transport();
	fetcher.mockImplementationOnce(async () =>
		Response.json({
			data: {
				Page: {
					pageInfo: { currentPage: 1, perPage: 10, hasNextPage: false },
					media: [],
				},
			},
		}),
	);
	const { application, database } = await setup(fetcher, () => now);
	const empty = await application.search({ query: "absent" });
	expect(empty.data.items).toEqual([]);
	expect(database.metadata.get(empty.snapshotId)?.expiresAt).toBe(
		metadataPolicy.emptySearchFreshMs,
	);
	now = metadataPolicy.emptySearchFreshMs - 1;
	await application.search({ query: "absent" });
	expect(fetcher).toHaveBeenCalledTimes(1);
	fetcher.mockImplementationOnce(
		async () => new Response(null, { status: 503 }),
	);
	await failure(
		application.search({ query: "uncached failure" }),
		"unavailable",
	);
	expect(
		database.metadata.find(
			JSON.stringify([
				"anilist",
				"anilist-v1",
				"metadata-v1",
				"search",
				{ query: "uncached failure", page: 1, perPage: 10 },
			]),
		),
	).toBeNull();
});

test("provider validation rejects partial, malformed, oversized and wrong-identity responses", async () => {
	const fetcher = transport();
	const provider = createProvider({
		fetch: fetcher,
		intervalMs: 0,
		attempts: 1,
	});
	for (const body of [
		{ data: { Media: { id: 154587 } } },
		{ data: { Media: media(1) } },
		{ data: { Media: { ...media(), type: "MANGA" } } },
		{ errors: [{}], data: { Media: media() } },
	]) {
		fetcher.mockImplementationOnce(async () => Response.json(body));
		await failure(provider.get(reference, noSignal()), "invalid-response");
	}
	fetcher.mockImplementationOnce(async () => new Response("bad-json"));
	await failure(provider.get(reference, noSignal()), "invalid-response");
	fetcher.mockImplementationOnce(
		async () =>
			new Response("{}", {
				headers: {
					"content-length": String(metadataPolicy.responseMaximumBytes + 1),
				},
			}),
	);
	await failure(provider.get(reference, noSignal()), "invalid-response");
	fetcher.mockImplementationOnce(async () =>
		Response.json({ data: { Media: null } }),
	);
	await failure(provider.get(reference, noSignal()), "not-found");
});

test("queried null lists are explicit unknowns rather than invalid or invented data", async () => {
	const fetcher = transport();
	fetcher.mockImplementationOnce(async () =>
		Response.json({
			data: {
				Media: {
					...media(),
					genres: null,
					synonyms: null,
					tags: null,
					studios: null,
					streamingEpisodes: null,
					episodes: null,
				},
			},
		}),
	);
	const { application } = await setup(fetcher);
	const details = (await application.get(reference)).data;
	expect(details.unavailableFields).toEqual(
		expect.arrayContaining([
			"genres",
			"synonyms",
			"tags",
			"studios",
			"streamingEpisodes",
			"episodes",
		]),
	);
	expect(details.episodeCount).toBeNull();
});

test("manual refresh is coalesced and one caller cancellation does not abort another", async () => {
	const fetcher = transport();
	let resolve!: (value: Response) => void;
	fetcher.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const { application } = await setup(fetcher);
	const controller = new AbortController();
	const cancelled = application.get(reference, { signal: controller.signal });
	const rejection = expect(cancelled).rejects.toMatchObject({
		name: "AbortError",
	});
	const remaining = application.get(reference, { refresh: true });
	await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
	controller.abort();
	await rejection;
	resolve(Response.json({ data: { Media: media() } }));
	expect((await remaining).data.reference).toEqual(reference);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

test("last caller cancellation and shutdown promptly abort uncooperative transport", async () => {
	const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
	const { application, database } = await setup(fetcher);
	const controller = new AbortController();
	const task = application.get(reference, { signal: controller.signal });
	const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
	controller.abort();
	await rejected;
	await application.close();
	expect(
		database.metadata.find(
			JSON.stringify([
				"anilist",
				"anilist-v1",
				"metadata-v1",
				"detail",
				reference,
			]),
		),
	).toBeNull();
});

test("rate headers pace retries and honor Retry-After/reset without bursts", async () => {
	vi.useFakeTimers();
	const fetcher = transport();
	fetcher.mockImplementationOnce(
		async () =>
			new Response(null, {
				status: 429,
				headers: {
					"Retry-After": "2",
					"X-RateLimit-Reset": String(Math.ceil(Date.now() / 1000) + 2),
					"X-RateLimit-Limit": "30",
				},
			}),
	);
	const provider = createProvider({
		fetch: fetcher,
		intervalMs: 0,
		attempts: 2,
		random: () => 0,
	});
	const task = provider.get(reference, noSignal());
	await vi.advanceTimersByTimeAsync(1000);
	expect(fetcher).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(3000);
	expect((await task).data.reference).toEqual(reference);
	expect(fetcher).toHaveBeenCalledTimes(2);
});

test("temporary failures retry within bounds, invalid responses do not loop", async () => {
	const fetcher = transport();
	fetcher.mockImplementationOnce(async () => {
		throw new Error("network");
	});
	const provider = createProvider({
		fetch: fetcher,
		intervalMs: 0,
		attempts: 2,
		random: () => 0,
	});
	expect((await provider.get(reference, noSignal())).data.reference).toEqual(
		reference,
	);
	expect(fetcher).toHaveBeenCalledTimes(2);
	fetcher.mockImplementationOnce(
		async () => new Response(null, { status: 400 }),
	);
	await failure(provider.get(reference, noSignal()), "invalid-request");
	expect(fetcher).toHaveBeenCalledTimes(3);
});

test("relations and airing keep pagination and do not infer episode catalogs", async () => {
	const { application } = await setup();
	const relations = await application.relations(reference, 1, 1);
	expect(relations.data).toMatchObject({
		page: 1,
		perPage: 1,
		hasNextPage: false,
	});
	expect(relations.data.items.map((item) => item.work.reference.id)).toEqual([
		"200",
	]);
	const airing = await application.airing(reference, 2, 10);
	expect(airing.data).toEqual({
		page: 2,
		perPage: 10,
		hasNextPage: false,
		items: [{ id: "100", episode: 1, airingAt: 1700000000 }],
	});
});

test("retained snapshot versions survive refresh, LRU pruning and restart", async () => {
	let now = 1;
	const { application, database, fetcher, dir } = await setup(
		transport(),
		() => now,
	);
	const original = await application.get(reference);
	application.retain(original.snapshotId, "work-1");
	application.retain(original.snapshotId, "work-1");
	now++;
	fetcher.mockImplementationOnce(async () =>
		Response.json({
			data: { Media: { ...media(), description: "New description" } },
		}),
	);
	const refreshed = await application.get(reference, { refresh: true });
	expect(refreshed.snapshotId).not.toBe(original.snapshotId);
	database.metadata.prune(0, 0);
	expect(application.snapshot(original.snapshotId).data).toMatchObject({
		description: "Story",
	});
	expect(database.metadata.get(refreshed.snapshotId)).toBeNull();
	const reopened = ApplicationDatabase.open(dir);
	try {
		expect(reopened.metadata.get(original.snapshotId)).not.toBeNull();
	} finally {
		reopened.close();
	}
	application.release(original.snapshotId, "work-1");
	database.metadata.prune(0, 0);
	expect(database.metadata.get(original.snapshotId)).toBeNull();
});

test("cache keys include pagination and adapter version, eviction follows access order", async () => {
	const { database } = await setup();
	for (let i = 0; i < 5; i++) {
		const entry: CacheEntry = {
			id: `id-${i}`,
			key: `query-${i}`,
			kind: "search",
			data: [],
			raw: {},
			fetchedAt: i,
			expiresAt: 100,
			accessedAt: i,
			failure: null,
		};
		database.metadata.save(entry);
	}
	database.metadata.touch("id-0", 20);
	database.metadata.prune(2, 0);
	expect(database.metadata.get("id-0")).not.toBeNull();
	expect(database.metadata.get("id-4")).not.toBeNull();
	expect(database.metadata.get("id-1")).toBeNull();
});

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
	"base64",
);
test("artwork is validated, atomically cached, served offline and reconciled on restart", async () => {
	const { artwork, database, dir, fetcher } = await setup();
	fetcher.mockImplementationOnce(async () => new Response(png));
	const ready = await artwork.get(
		"work-cover",
		media().coverImage.extraLarge,
		{},
	);
	expect(ready.status).toBe("ready");
	if (!ready.id) throw new Error("Missing artwork ID");
	expect((await artwork.read(ready.id)).bytes).toEqual(png);
	expect(
		(
			await artwork.get("work-cover", media().coverImage.extraLarge, {
				cachedOnly: true,
			})
		).id,
	).toBe(ready.id);
	expect(fetcher).toHaveBeenCalledTimes(1);
	await writeFile(
		join(dir, "cache", "metadata-artwork", "orphan.pending"),
		"partial",
	);
	await rm(join(dir, "cache", "metadata-artwork", ready.id));
	await artwork.initialize();
	expect(database.metadata.artworks()).toEqual([]);
	await expect(
		readFile(join(dir, "cache", "metadata-artwork", "orphan.pending")),
	).rejects.toThrow();
});

test("artwork denies arbitrary hosts/redirects, non-images and excessive bytes", async () => {
	const { artwork, fetcher } = await setup();
	expect(
		(await artwork.get("bad-host", "https://localhost/private", {})).status,
	).toBe("failed");
	expect(fetcher).not.toHaveBeenCalled();
	fetcher.mockImplementationOnce(
		async () =>
			new Response(null, {
				status: 302,
				headers: { location: "http://127.0.0.1/private" },
			}),
	);
	expect(
		(await artwork.get("redirect", media().coverImage.extraLarge, {})).status,
	).toBe("failed");
	expect(fetcher).toHaveBeenCalledTimes(1);
	fetcher.mockImplementationOnce(async () => new Response("not an image"));
	expect(
		(await artwork.get("invalid", media().coverImage.extraLarge, {})).failure
			?.code,
	).toBe("invalid-response");
	fetcher.mockImplementationOnce(
		async () =>
			new Response(png, {
				headers: {
					"content-length": String(metadataPolicy.artworkMaximumBytes + 1),
				},
			}),
	);
	expect(
		(await artwork.get("oversized", media().coverImage.extraLarge, {})).failure
			?.code,
	).toBe("invalid-response");
	await failure(artwork.read("../../private"), "not-found");
});

test("artwork failure preserves the previous usable URL version and budget evicts LRU", async () => {
	const warn = vi.spyOn(logger, "warn");
	const debug = vi.spyOn(logger, "debug");
	const { dir, database, fetcher } = await setup();
	const artwork = new MetadataArtworkCache({
		hosts: ["s4.anilist.co"],
		dataDir: dir,
		store: database.metadata,
		logger,
		fetch: fetcher,
		budgetBytes: png.length,
	});
	await artwork.initialize();
	cleanups.push(() => artwork.close());
	fetcher.mockImplementationOnce(async () => new Response(png));
	const first = await artwork.get("key", media().coverImage.extraLarge, {});
	fetcher.mockImplementationOnce(
		async () => new Response(null, { status: 500 }),
	);
	const retained = await artwork.get(
		"key",
		"https://s4.anilist.co/new.png",
		{},
	);
	expect(retained).toMatchObject({
		id: first.id,
		status: "ready",
		failure: { code: "unavailable" },
	});
	fetcher.mockImplementationOnce(async () => new Response(png));
	await artwork.get("other", "https://s4.anilist.co/other.png", {});
	expect(database.metadata.artworks()).toHaveLength(1);
	expect(warn).toHaveBeenCalledWith(
		expect.objectContaining({
			event: "metadata.artwork_failed",
			retained: true,
			code: "unavailable",
		}),
		expect.any(String),
	);
	expect(debug).toHaveBeenCalledWith(
		expect.objectContaining({
			event: "metadata.artwork_evicted",
			artworkId: first.id,
		}),
		expect.any(String),
	);
	expect(
		JSON.stringify([...warn.mock.calls, ...debug.mock.calls]),
	).not.toContain("https://s4.anilist.co/");
});

test("actual Metadata supplies Identification proposals without calendar season inference", async () => {
	const { application } = await setup();
	const identification = new IdentificationApplication({
		parser: new AnitomyIdentificationParser(),
		metadata: createIdentificationMetadata(application),
	});
	const results = await identification.identify([
		{
			scopeId: "/library",
			fileId: "file",
			relativePath: "Frieren - 01.mkv",
			sourceVersion: "version",
		},
	]);
	expect(results[0]).toMatchObject({
		metadataStatus: "searched",
		status: "proposed",
	});
	expect(results[0]?.proposals[0]?.candidate.work).toMatchObject({
		reference,
		season: null,
		part: null,
	});
	expect(results[0]?.proposals[0]?.mapping.targets).toEqual([
		{ kind: "regular", number: "1" },
	]);
});

test("metadata projects only explicit provider-title season and part ordinals", async () => {
	const fetcher = transport();
	fetcher.mockImplementation(async (_url, init) => {
		const request = JSON.parse(String(init?.body));
		const value = media();
		value.title = {
			romaji: "Ocean Season 2 Part 1",
			english: "Ocean 2nd Season Part 1",
			native: "海洋 第二季 第一部",
		};
		value.synonyms = ["Ocean"];
		return Response.json({
			data: {
				Page: {
					pageInfo: {
						currentPage: request.variables.page,
						perPage: request.variables.perPage,
						hasNextPage: false,
					},
					media: [value],
				},
			},
		});
	});
	const { application } = await setup(fetcher);
	const projection = createIdentificationMetadata(application);
	const candidates = await projection.search(
		"Ocean",
		new AbortController().signal,
	);
	expect(candidates[0]).toMatchObject({
		season: "2",
		part: "1",
		ordinalSource: "provider-title",
		titleVariants: expect.arrayContaining([
			{ value: "Ocean Season 2 Part 1", kind: "primary", language: null },
			{ value: "Ocean", kind: "alias", language: null },
		]),
	});
	expect(fetcher).toHaveBeenCalledTimes(1);
});

test("HTTP exposes normalized cache envelopes, refresh, artwork and safe failures", async () => {
	const { application, fetcher } = await setup();
	const app = createHttpApp({
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
		metadata: application,
	});
	try {
		const search = await app.inject({
			url: "/api/metadata/search?query=Frieren",
		});
		expect(search.statusCode).toBe(200);
		expect(search.json()).not.toHaveProperty("raw");
		expect(
			(await app.inject({ url: "/api/metadata/anilist/154587" })).statusCode,
		).toBe(200);
		fetcher.mockImplementationOnce(async () =>
			Response.json({ errors: [{ status: 500, message: "internal secret" }] }),
		);
		const refresh = await app.inject({
			method: "POST",
			url: "/api/metadata/anilist/154587/refresh",
		});
		expect(refresh.statusCode).toBe(200);
		expect(refresh.json().refreshError.code).toBe("unavailable");
		fetcher.mockImplementationOnce(
			async () => new Response(null, { status: 503 }),
		);
		const uncached = await app.inject({ url: "/api/metadata/anilist/999" });
		expect(uncached.statusCode).toBe(503);
		expect(uncached.json().error.code).toBe("METADATA_UNAVAILABLE");
		expect(
			(await app.inject({ url: "/api/metadata/search?query=x&perPage=99" }))
				.statusCode,
		).toBe(400);
		expect(
			(await app.inject({ url: "/api/metadata/anilist/1?cachedOnly=true" }))
				.statusCode,
		).toBe(404);
		fetcher.mockImplementationOnce(async () => new Response(png));
		const status = await app.inject({
			url: "/api/metadata/anilist/154587/artwork/cover",
		});
		expect(status.statusCode).toBe(200);
		const image = await app.inject({
			url: `/api/metadata/artwork/${status.json().id}`,
		});
		expect(image.statusCode).toBe(200);
		expect(image.headers["content-type"]).toBe("image/png");
		expect(image.rawPayload).toEqual(png);
	} finally {
		await app.close();
	}
});

test("bad input and unsupported references never contact the provider", async () => {
	const { application, fetcher } = await setup();
	expect(() => application.search({ query: " " })).toThrow(MetadataError);
	expect(() => application.search({ query: "title", page: 0 })).toThrow(
		MetadataError,
	);
	expect(() => application.get({ ...reference, provider: "unknown" })).toThrow(
		MetadataError,
	);
	await failure(application.get({ ...reference, id: "01" }), "invalid-request");
	await failure(
		application.get(reference, { refresh: true, cachedOnly: true }),
		"invalid-request",
	);
	expect(fetcher).not.toHaveBeenCalled();
});

test("snapshot cache keys distinguish pagination, provider versions and reference property order", async () => {
	const { application, database, artwork, provider, fetcher } = await setup();
	const first = await application.search({ query: "Frieren", page: 1 });
	const second = await application.search({ query: "Frieren", page: 2 });
	expect(first.snapshotId).not.toBe(second.snapshotId);
	const details = await application.get(reference);
	expect(
		(
			await application.get({
				id: reference.id,
				mediaType: "anime",
				provider: "anilist",
			})
		).snapshotId,
	).toBe(details.snapshotId);
	expect(fetcher).toHaveBeenCalledTimes(3);
	const next = new MetadataApplication({
		defaultProvider: "anilist",
		store: database.metadata,
		artwork,
		logger,
		providers: [
			{
				capabilities: { ...provider.capabilities, version: "anilist-v2" },
				search: provider.search.bind(provider),
				get: provider.get.bind(provider),
				relations: provider.relations.bind(provider),
				airing: provider.airing.bind(provider),
			},
		],
	});
	const upgraded = await next.get(reference);
	expect(upgraded.snapshotId).not.toBe(details.snapshotId);
	expect(fetcher).toHaveBeenCalledTimes(4);
	await next.close();
});

test("uncached work is bounded and queued cancellation does not launch extra requests", async () => {
	const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
	const { application } = await setup(fetcher);
	const controller = new AbortController();
	const tasks = Array.from(
		{ length: metadataPolicy.maximumPending + 1 },
		(_, index) =>
			application
				.get(
					{ ...reference, id: String(1000 + index) },
					{ signal: controller.signal },
				)
				.catch((error: unknown) => error),
	);
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
	expect(await tasks.at(-1)).toMatchObject({ failure: { code: "busy" } });
	controller.abort();
	const cancelled = await Promise.all(tasks.slice(0, -1));
	expect(
		cancelled.every(
			(error) => error instanceof Error && error.name === "AbortError",
		),
	).toBe(true);
	await application.close();
	expect(fetcher).toHaveBeenCalledTimes(1);
});

test("streamed response size limits apply without Content-Length", async () => {
	const fetcher = transport();
	fetcher.mockImplementationOnce(
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new Uint8Array(metadataPolicy.responseMaximumBytes),
						);
						controller.enqueue(new Uint8Array(1));
						controller.close();
					},
				}),
			),
	);
	const provider = createProvider({
		fetch: fetcher,
		intervalMs: 0,
		attempts: 1,
	});
	await failure(provider.get(reference, noSignal()), "invalid-response");
});

test("HTTP disconnect detaches its subscription and aborts unneeded provider work", async () => {
	const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
	const { application } = await setup(fetcher);
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 0, publicOrigin: "http://localhost" },
		logger,
		metadata: application,
	});
	const address = await app.listen({ host: "127.0.0.1", port: 0 });
	try {
		const controller = new AbortController();
		const request = fetch(`${address}/api/metadata/anilist/154587`, {
			signal: controller.signal,
		});
		const rejected = expect(request).rejects.toMatchObject({
			name: "AbortError",
		});
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
		controller.abort();
		await rejected;
		await vi.waitFor(() =>
			expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true),
		);
	} finally {
		await app.close();
	}
});

test.each([
	["RELEASING", 6 * 60 * 60_000],
	["NOT_YET_RELEASED", 24 * 60 * 60_000],
	["HIATUS", 24 * 60 * 60_000],
	["CANCELLED", 24 * 60 * 60_000],
	[null, 24 * 60 * 60_000],
	["FINISHED", 7 * 24 * 60 * 60_000],
])(
	"%s details revalidate only after their freshness interval",
	async (status, interval) => {
		let now = 1000;
		const fetcher = vi.fn<typeof fetch>(async () =>
			Response.json({ data: { Media: { ...media(), status } } }),
		);
		const { application } = await setup(fetcher, () => now);
		const first = await application.get(reference);
		now = first.fetchedAt + Number(interval) - 1;
		expect((await application.get(reference)).stale).toBe(false);
		expect(fetcher).toHaveBeenCalledTimes(1);
		now++;
		expect(application.snapshot(first.snapshotId).stale).toBe(true);
		expect((await application.get(reference)).stale).toBe(true);
		await vi.waitFor(() =>
			expect(application.snapshot(first.snapshotId).stale).toBe(false),
		);
		expect(fetcher).toHaveBeenCalledTimes(2);
	},
);

test("persisted releasing snapshots with the former 24-hour expiry use the new six-hour policy", async () => {
	let now = 1000;
	const fetcher = vi.fn<typeof fetch>(async () =>
		Response.json({ data: { Media: { ...media(), status: "RELEASING" } } }),
	);
	const { application, database } = await setup(fetcher, () => now);
	const first = await application.get(reference);
	const entry = database.metadata.get(first.snapshotId);
	if (!entry) throw new Error("Missing cached detail");
	database.metadata.save({
		...entry,
		expiresAt: first.fetchedAt + 24 * 60 * 60_000,
	});
	now = first.fetchedAt + 6 * 60 * 60_000;
	expect(application.snapshot(first.snapshotId).stale).toBe(true);
	expect((await application.get(reference, { cachedOnly: true })).stale).toBe(
		true,
	);
	expect(fetcher).toHaveBeenCalledTimes(1);
	await application.get(reference);
	await vi.waitFor(() =>
		expect(application.snapshot(first.snapshotId).stale).toBe(false),
	);
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(database.metadata.get(first.snapshotId)?.expiresAt).toBe(
		now + 6 * 60 * 60_000,
	);
});

test("manual lookup delegates provider ID and URL parsing to the configured adapter without a network request", async () => {
	const { application, fetcher } = await setup();
	const app = createHttpApp({
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
		metadata: application,
	});
	try {
		for (const value of ["154587", "https://anilist.co/anime/154587/Frieren"]) {
			const response = await app.inject({
				url: `/api/metadata/reference?${new URLSearchParams({ value })}`,
			});
			expect(response.statusCode, response.body).toBe(200);
			expect(response.json()).toEqual({
				provider: "anilist",
				mediaType: "anime",
				id: "154587",
			});
		}
		expect(
			(
				await app.inject({
					url: `/api/metadata/reference?${new URLSearchParams({ value: "https://other.example/anime/154587" })}`,
				})
			).statusCode,
		).toBe(400);
		expect(fetcher).not.toHaveBeenCalled();
	} finally {
		await app.close();
	}
});
