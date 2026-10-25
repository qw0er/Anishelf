import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { AniListMetadataClient } from "../src/modules/anime/anilist/infrastructure/metadata-client.js";
import {
	type AniListOptions,
	AniListWrapper,
} from "../src/modules/anime/anilist/public.js";
import { createAniListMetadata } from "../src/modules/anime/composition/anilist.js";
import {
	createIdentificationMetadata,
	createMetadataModule,
} from "../src/modules/anime/composition/metadata.js";
import { IdentificationApplication } from "../src/modules/anime/identification/application/identification.js";
import { AnitomyIdentificationParser } from "../src/modules/anime/identification/infrastructure/parser.js";
import { MetadataApplication as PublicMetadataApplication } from "../src/modules/anime/metadata/application/metadata.js";
import { SourceMetadataApplication as MetadataApplication } from "../src/modules/anime/metadata/application/source-metadata.js";
import { AniListProvider } from "../src/modules/anime/metadata/infrastructure/anilist.js";
import { MetadataArtworkCache } from "../src/modules/anime/metadata/infrastructure/artwork.js";
import { metadataPolicy } from "../src/modules/anime/metadata/policy.js";
import type { CacheEntry } from "../src/modules/anime/metadata/ports.js";
import {
	airedEpisodeCount,
	MetadataError,
} from "../src/modules/anime/metadata/public.js";
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
function response(query: string, variables: Record<string, number>) {
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
function transport() {
	return vi.fn<typeof fetch>(async (_url, init) => {
		const request = JSON.parse(String(init?.body));
		return Response.json(response(request.query, request.variables));
	});
}
function createProvider(options: AniListOptions): AniListProvider {
	return new AniListProvider(
		new AniListMetadataClient(new AniListWrapper(options)),
	);
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	vi.useRealTimers();
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(
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
		publicMetadata: new PublicMetadataApplication(
			application,
			database.metadata,
		),
	};
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

test("details expose the next scheduled episode for aired progress", async () => {
	const fetcher = transport();
	fetcher.mockImplementationOnce(async () =>
		Response.json({
			data: {
				Media: {
					...media(),
					status: "RELEASING",
					episodes: 12,
					nextAiringEpisode: { episode: 8, airingAt: 1700000000 },
				},
			},
		}),
	);
	const { application } = await setup(fetcher);
	const detail = (await application.get(reference)).data;
	expect(detail.nextAiringEpisode).toEqual({
		episode: 8,
		airingAt: 1700000000,
	});
});

test("fresh cache survives database restart and returned values are independent", async () => {
	const { application, dir, fetcher } = await setup(undefined, undefined, true);
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
				new AniListWrapper({
					fetch: offline,
					intervalMs: 0,
					attempts: 1,
				}),
			),
		});
		try {
			expect(
				(await next.get(next.resolveReference("154587"), { cachedOnly: true }))
					.snapshotId,
			).toBe(first.snapshotId);
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

test("provider validation rejects partial, malformed and wrong-identity responses", async () => {
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
	fetcher.mockImplementationOnce(async () => Response.json({}));
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
		true,
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
	expect(application.current(reference)?.snapshotId).toBe(refreshed.snapshotId);
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
			data: { items: [], page: 1, perPage: 50, hasNextPage: false },
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
	// Warm lookups stay provider-free so list cards can link content addresses.
	expect(await artwork.cached("work-cover")).toBe(ready.id);
	expect(await artwork.cached("unknown-cover")).toBeNull();
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

test("artwork downloads keep bounded concurrency and deduplicate identical requests", async () => {
	const { dir, database } = await setup();
	let active = 0;
	let peak = 0;
	const releases: (() => void)[] = [];
	const fetcher = vi.fn<typeof fetch>(async () => {
		active++;
		peak = Math.max(peak, active);
		await new Promise<void>((resolve) => releases.push(resolve));
		active--;
		return new Response(png);
	});
	const artwork = new MetadataArtworkCache({
		hosts: ["s4.anilist.co"],
		dataDir: dir,
		store: database.metadata,
		fetch: fetcher,
	});
	await artwork.initialize();
	cleanups.push(() => artwork.close());
	const url = (name: string) => `https://s4.anilist.co/${name}.png`;
	const requests = Array.from({ length: 6 }, (_, index) =>
		artwork.get(`key-${index}`, url(`art-${index}`), {}),
	);
	// A second request for an in-flight image joins that download instead of fetching.
	const duplicate = artwork.get("key-0", url("art-0"), {});
	const settled = Promise.all([...requests, duplicate]);
	for (let round = 0; round < 10; round++) {
		while (releases.length > 0) releases.shift()?.();
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	const statuses = await settled;
	expect(fetcher).toHaveBeenCalledTimes(6);
	expect(peak).toBe(4);
	expect(statuses.every((status) => status.status === "ready")).toBe(true);
});

test("a requested artwork refresh serves cached bytes and refreshes in the background", async () => {
	const { dir, database } = await setup();
	const debug = vi.spyOn(logger, "debug");
	const fetcher = vi.fn<typeof fetch>(async () => new Response(png));
	const artwork = new MetadataArtworkCache({
		hosts: ["s4.anilist.co"],
		dataDir: dir,
		store: database.metadata,
		logger,
		fetch: fetcher,
	});
	await artwork.initialize();
	cleanups.push(() => artwork.close());
	const url = media().coverImage.extraLarge;
	const first = await artwork.get("key", url, {});
	if (!first.id) throw new Error("Missing artwork ID");
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	fetcher.mockImplementationOnce(async () => {
		await gate;
		return new Response(png);
	});
	const refreshed = await artwork.get("key", url, { refresh: true });
	expect(refreshed).toMatchObject({ id: first.id, status: "ready" });
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(debug).toHaveBeenCalledWith(
		expect.objectContaining({ event: "metadata.artwork_refresh_started" }),
		expect.any(String),
	);
	release();
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(database.metadata.artworks()).toHaveLength(1);
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
	const { publicMetadata } = await setup();
	const identification = new IdentificationApplication({
		parser: new AnitomyIdentificationParser(),
		metadata: createIdentificationMetadata(publicMetadata),
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
	const { publicMetadata } = await setup(fetcher);
	const projection = createIdentificationMetadata(publicMetadata);
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
	const { application, publicMetadata, fetcher } = await setup();
	const app = createHttpApp({
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
		metadata: publicMetadata,
	});
	try {
		const search = await app.inject({
			url: "/api/metadata/search?query=Frieren",
		});
		expect(search.statusCode).toBe(200);
		expect(search.json()).not.toHaveProperty("raw");
		expect(
			(
				await app.inject({
					url: `/api/metadata/${publicMetadata.resolveReference("154587").id}`,
				})
			).statusCode,
		).toBe(200);
		fetcher.mockImplementationOnce(async () =>
			Response.json({ errors: [{ status: 500, message: "internal secret" }] }),
		);
		const refresh = await app.inject({
			method: "POST",
			url: "/api/metadata/anilist/154587/refresh",
		});
		expect(refresh.statusCode).toBe(404);
		const refreshed = await application.get(
			{ provider: "anilist", mediaType: "anime", id: "154587" },
			{ refresh: true },
		);
		expect(refreshed.refreshError?.code).toBe("unavailable");
		fetcher.mockImplementationOnce(
			async () => new Response(null, { status: 503 }),
		);
		const uncached = await app.inject({
			url: `/api/metadata/${publicMetadata.resolveReference("999").id}`,
		});
		expect(uncached.statusCode).toBe(503);
		expect(uncached.json().error.code).toBe("METADATA_UNAVAILABLE");
		expect(
			(await app.inject({ url: "/api/metadata/search?query=x&perPage=99" }))
				.statusCode,
		).toBe(400);
		expect(
			(
				await app.inject({
					url: `/api/metadata/${publicMetadata.resolveReference("1").id}?cachedOnly=true`,
				})
			).statusCode,
		).toBe(404);
		fetcher.mockImplementationOnce(async () => new Response(png));
		const status = await app.inject({
			url: "/api/metadata/anilist/154587/artwork/cover",
		});
		expect(status.statusCode).toBe(404);
		const artworkId = (
			await application.artwork(
				{ provider: "anilist", mediaType: "anime", id: "154587" },
				"cover",
				{},
			)
		).id;
		const image = await app.inject({
			url: `/api/metadata/artwork/${artworkId}`,
		});
		expect(image.statusCode).toBe(200);
		expect(image.headers["content-type"]).toBe("image/png");
		expect(image.headers["cache-control"]).toBe("private, max-age=604800");
		expect(image.headers.etag).toBe(`"${artworkId}"`);
		expect(image.rawPayload).toEqual(png);
		const revalidated = await app.inject({
			url: `/api/metadata/artwork/${artworkId}`,
			headers: { "if-none-match": image.headers.etag as string },
		});
		expect(revalidated.statusCode).toBe(304);
		expect(revalidated.rawPayload).toHaveLength(0);
		// Provider references resolve the same cached bytes for tracked works.
		const proxied = await app.inject({
			url: `/api/metadata/${publicMetadata.resolveReference("154587").id}/artwork/cover/image`,
		});
		expect(proxied.statusCode).toBe(200);
		expect(proxied.headers["content-type"]).toBe("image/png");
		expect(proxied.headers["cache-control"]).toBe("private, max-age=3600");
		expect(proxied.headers.etag).toBe(`"${artworkId}"`);
		expect(proxied.rawPayload).toEqual(png);
		expect(
			(
				await app.inject({
					url: `/api/metadata/${publicMetadata.resolveReference("154587").id}/artwork/cover/image`,
					headers: { "if-none-match": proxied.headers.etag as string },
				})
			).statusCode,
		).toBe(304);
		expect(
			(
				await app.inject({
					url: `/api/metadata/${publicMetadata.resolveReference("154587").id}/artwork/banner/image`,
				})
			).statusCode,
		).toBe(404);
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

test("SDK rejects malformed streamed GraphQL responses without Content-Length", async () => {
	const fetcher = transport();
	fetcher.mockImplementationOnce(
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("invalid-json"));
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

test("HTTP request cancellation detaches its subscription and aborts unneeded provider work", async () => {
	const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
	const { publicMetadata } = await setup(fetcher);
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 0, publicOrigin: "http://localhost" },
		logger,
		metadata: publicMetadata,
	});
	try {
		const controller = new AbortController();
		const request = app.inject({
			url: `/api/metadata/${publicMetadata.resolveReference("154587").id}`,
			headers: { host: "localhost" },
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

test("legacy detail snapshots missing nextAiringEpisode refresh to backfill aired progress", async () => {
	let now = 1000;
	const fetcher = vi.fn<typeof fetch>(async () =>
		Response.json({ data: { Media: media() } }),
	);
	const { application, database } = await setup(fetcher, () => now);
	const first = await application.get(reference);
	const entry = database.metadata.get(first.snapshotId);
	if (!entry) throw new Error("Missing cached detail");
	const { nextAiringEpisode: _removed, ...legacy } = entry.data as Record<
		string,
		unknown
	>;
	database.metadata.save({ ...entry, data: legacy });
	now = first.fetchedAt + 1000;
	expect((await application.get(reference)).stale).toBe(true);
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
	const refreshed = await application.get(reference);
	expect(refreshed.stale).toBe(false);
	expect(refreshed.data.nextAiringEpisode).toBeNull();
});

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
	const { publicMetadata, fetcher } = await setup();
	const app = createHttpApp({
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
		metadata: publicMetadata,
	});
	try {
		for (const value of ["154587", "https://anilist.co/anime/154587/Frieren"]) {
			const response = await app.inject({
				url: `/api/metadata/reference?${new URLSearchParams({ value })}`,
			});
			expect(response.statusCode, response.body).toBe(200);
			expect(response.json()).toEqual(
				publicMetadata.resolveReference("154587"),
			);
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

test("aired episode count uses provider status and the next scheduled episode", () => {
	const now = 1_000_000;
	expect(
		airedEpisodeCount(
			{
				status: "RELEASING",
				episodeCount: 12,
				nextAiringEpisode: { episode: 8, airingAt: now / 1000 + 60 },
			},
			now,
		),
	).toBe(7);
	expect(
		airedEpisodeCount(
			{
				status: "RELEASING",
				episodeCount: 12,
				nextAiringEpisode: { episode: 8, airingAt: now / 1000 - 60 },
			},
			now,
		),
	).toBe(8);
	expect(
		airedEpisodeCount(
			{ status: "FINISHED", episodeCount: 12, nextAiringEpisode: null },
			now,
		),
	).toBe(12);
	expect(
		airedEpisodeCount(
			{ status: "NOT_YET_RELEASED", episodeCount: 12, nextAiringEpisode: null },
			now,
		),
	).toBe(0);
	expect(
		airedEpisodeCount(
			{ status: "HIATUS", episodeCount: 12, nextAiringEpisode: null },
			now,
		),
	).toBeNull();
});

test("public metadata uses durable project identities across search, detail, snapshots and restart", async () => {
	const { application, publicMetadata, database, dir, fetcher } = await setup(
		transport(),
		undefined,
		true,
	);
	const search = await publicMetadata.search({ query: "Frieren" });
	const identity = search.data.items[0]?.reference;
	expect(identity).toEqual({ id: expect.any(String) });
	expect(identity?.id).not.toBe(reference.id);
	if (!identity) throw new Error("Missing metadata identity");
	const detail = await publicMetadata.get(identity);
	expect(detail.data.reference).toEqual(identity);
	expect(publicMetadata.current(identity)?.data.reference).toEqual(identity);
	expect(publicMetadata.snapshot(detail.snapshotId).data).toEqual(detail.data);
	expect(detail.data.coverUrl).toBe(
		`/api/metadata/${identity.id}/artwork/cover/image`,
	);
	expect(detail.data).not.toHaveProperty("siteUrl");
	expect(detail.data).not.toHaveProperty("providerUpdatedAt");
	expect(detail.data.unavailableFields).toContain("bannerUrl");
	for (const result of [
		search,
		detail,
		publicMetadata.snapshot(search.snapshotId),
	]) {
		const value = JSON.stringify(result);
		expect(value).not.toContain('"provider"');
		expect(value).not.toContain("anilist");
		expect(value).not.toContain("bannerImage");
	}
	// Identities are not evictable search/snapshot evidence.
	database.metadata.prune(0, 0);
	const reopened = ApplicationDatabase.open(dir);
	try {
		const projection = new PublicMetadataApplication(
			application,
			reopened.metadata,
		);
		expect(projection.resolveReference("154587")).toEqual(identity);
		expect(projection.externalReference(identity)).toEqual(reference);
	} finally {
		reopened.close();
	}
	expect(fetcher).toHaveBeenCalledTimes(2);
});

test("public metadata rejects source selection and unknown project IDs without upstream requests", async () => {
	const { publicMetadata, fetcher } = await setup();
	const app = createHttpApp({
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
		metadata: publicMetadata,
	});
	try {
		for (const url of [
			"/api/metadata/search?query=Frieren&provider=anilist",
			"/api/metadata/reference?value=154587&provider=anilist",
		]) {
			expect((await app.inject({ url })).statusCode).toBe(400);
		}
		expect(
			(await app.inject({ url: "/api/metadata/unknown-work" })).statusCode,
		).toBe(404);
		expect(
			(await app.inject({ url: "/api/metadata/anilist/154587" })).statusCode,
		).toBe(404);
		expect(fetcher).not.toHaveBeenCalled();
	} finally {
		await app.close();
	}
});

test("relations and airing snapshots use project references and episode identities", async () => {
	const { publicMetadata } = await setup();
	const identity = publicMetadata.resolveReference("154587");
	const relations = await publicMetadata.relations(identity);
	const related = relations.data.items[0]?.work.reference;
	expect(related).toEqual(publicMetadata.resolveReference("200"));
	expect(JSON.stringify(relations)).not.toContain("anilist");
	expect(publicMetadata.snapshot(relations.snapshotId).data).toEqual(
		relations.data,
	);
	const airing = await publicMetadata.airing(identity);
	expect(airing.data.items).toEqual([
		{ id: "1", episode: 1, airingAt: 1700000000 },
	]);
	expect(publicMetadata.snapshot(airing.snapshotId).data).toEqual(airing.data);
});

test("public metadata hides source failure messages while preserving retry semantics", async () => {
	const { publicMetadata, application } = await setup();
	vi.spyOn(application, "get").mockRejectedValueOnce(
		new MetadataError({
			code: "rate-limited",
			message: "AniList request failed at https://anilist.co/internal",
			retryAt: 12345,
		}),
	);
	await expect(
		publicMetadata.get(publicMetadata.resolveReference("154587")),
	).rejects.toMatchObject({
		failure: {
			code: "rate-limited",
			retryAt: 12345,
			message: "Metadata could not be loaded. Retry shortly.",
		},
	});
});

test("different configured sources produce the same project contract without source selectors", async () => {
	const { application, database, artwork, provider } = await setup();
	const raw = (await application.get(reference)).data;
	const alternateReference = {
		provider: "alternate",
		mediaType: "anime",
		id: "42",
	} as const;
	const alternateWork = { ...raw, reference: alternateReference };
	const alternate = {
		capabilities: { ...provider.capabilities, key: "alternate" },
		resolveReference: (value: string) =>
			value === "https://example.com/work/42" ? alternateReference : null,
		search: async () => ({
			data: {
				items: [alternateWork],
				page: 1,
				perPage: 10,
				hasNextPage: false,
			},
		}),
		get: async () => ({ data: alternateWork }),
		relations: async () => ({
			data: { items: [], page: 1, perPage: 25, hasNextPage: false },
		}),
		airing: async () => ({
			data: { items: [], page: 1, perPage: 25, hasNextPage: false },
		}),
	};
	const source = new MetadataApplication({
		defaultProvider: "alternate",
		store: database.metadata,
		providers: [alternate, provider],
		artwork,
		logger,
	});
	cleanups.push(() => source.close());
	const api = new PublicMetadataApplication(source, database.metadata);
	const search = await api.search({ query: "Frieren" });
	const found = search.data.items[0]?.reference;
	expect(api.resolveReference("https://example.com/work/42")).toEqual(found);
	if (!found) throw new Error("Missing work");
	const alternateDetail = await api.get(found);
	const other = api.resolveReference("https://anilist.co/anime/154587");
	const otherDetail = await api.get(other);
	expect(found).not.toEqual(other);
	expect(Object.keys(alternateDetail.data).sort()).toEqual(
		Object.keys(otherDetail.data).sort(),
	);
	expect(JSON.stringify(search)).not.toMatch(/anilist|alternate|provider/);
	expect(JSON.stringify(alternateDetail)).not.toMatch(
		/anilist|alternate|provider/,
	);
});
