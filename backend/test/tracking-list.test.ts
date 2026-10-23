import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { builtinPolicy } from "../src/app/policy.js";
import { AniListError } from "../src/modules/anime/anilist/public.js";
import type { AnimeCatalogApi } from "../src/modules/anime/anime-catalog/public.js";
import { AnimeLibraryQueries } from "../src/modules/anime/anime-library/application/library.js";
import type { LocalIndex } from "../src/modules/anime/anime-library/domain/model.js";
import { registerAnimeLibraryRoutes } from "../src/modules/anime/anime-library/http/library.js";
import { createTrackingModule } from "../src/modules/anime/composition/tracking.js";
import { TrackingListReader } from "../src/modules/anime/tracking/application/list-cache.js";
import type {
	TrackingLease,
	TrackingListCache,
	TrackingListEntry,
	TrackingListSnapshot,
} from "../src/modules/anime/tracking/domain/list.js";
import { TrackingProviderError } from "../src/modules/anime/tracking/domain/list.js";
import type { TrackingStatus } from "../src/modules/anime/tracking/domain/model.js";
import { AniListListProvider } from "../src/modules/anime/tracking/infrastructure/list-provider.js";
import { aniListTracking } from "../src/modules/anime/tracking/infrastructure/provider-mapping.js";
import type { TrackingListStore } from "../src/modules/anime/tracking/ports.js";
import {
	AniListListsClient,
	createAniListTracking,
} from "./anilist-fixture.js";

const lease: TrackingLease = {
	accountId: "anilist:7",
	generation: "first",
	credential: "private-fixture-token",
	signal: new AbortController().signal,
};
const item = (mediaId = 1): TrackingListEntry => ({
	id: `anilist:${mediaId}`,
	mediaId: `anilist:anime:${mediaId}`,
	progress: 3,
	status: "watching",
	updatedAt: 100_000,
	titles: [`Title ${mediaId}`],
	format: "TV",
	year: 2025,
	episodeCount: 12,
	coverUrl: null,
});
const raw = (mediaId = 1) => ({
	id: mediaId,
	userId: 7,
	mediaId,
	progress: 3,
	status: "CURRENT",
	updatedAt: 100,
	media: {
		id: mediaId,
		type: "ANIME",
		title: { romaji: `Title ${mediaId}`, english: null, native: null },
		synonyms: [],
		format: "TV",
		startDate: { year: 2025 },
		seasonYear: null,
		episodes: 12,
		coverImage: { large: "https://evil.example/image" },
	},
});
const chunk = (entries: unknown[], hasNextChunk = false) => ({
	MediaListCollection: { hasNextChunk, lists: [{ entries }] },
});
const target = (number: number, ...versions: [string, string][]) => ({
	episodeId: `episode-${number}`,
	number: String(number),
	versions: versions.map(([fileId, sourceVersion]) => ({
		fileId,
		sourceVersion,
	})),
});

test("provider reads every chunk, deduplicates custom lists and strips unsafe covers", async () => {
	const request = vi
		.fn()
		.mockResolvedValueOnce(chunk([raw(), raw()], true))
		.mockResolvedValueOnce(chunk([raw(2)]));
	const entries = await new AniListListsClient({ request }).read(
		7,
		lease.credential,
		lease.signal,
	);
	expect(
		entries.map((entry) => ({
			...entry,
			id: `anilist:${entry.id}`,
			mediaId: `anilist:anime:${entry.mediaId}`,
			status: "watching",
			updatedAt: entry.updatedAt * 1000,
		})),
	).toEqual([item(), item(2)]);
	expect(request.mock.calls[1]?.[1]).toEqual({ userId: 7, chunk: 2 });
	expect(request.mock.calls[0]?.[2].token).toBe(lease.credential);
});
test.each([
	chunk([{ ...raw(), userId: 8 }]),
	chunk([{ ...raw(), mediaId: 2 }]),
	chunk([{ ...raw(), status: "UNKNOWN" }]),
	chunk([raw(), { ...raw(), progress: 5 }]),
	chunk([], true),
	{ MediaListCollection: null },
])(
	"provider rejects incomplete or inconsistent collections",
	async (response) => {
		await expect(
			new AniListListsClient({ request: async () => response }).read(
				7,
				lease.credential,
				lease.signal,
			),
		).rejects.toBeInstanceOf(AniListError);
	},
);
function readerFixture() {
	let now = 1000;
	const status: TrackingStatus = {
		provider: aniListTracking,
		generation: "first",
		account: { id: "anilist:7", name: "Fixture" },
		state: "connected",
		connectivity: "available",
		checkedAt: 0,
	};
	const cache = new Map<string, TrackingListCache>();
	const store: TrackingListStore = {
		read: (id) => cache.get(id),
		replace: (value) => {
			cache.set(value.accountId, value);
		},
	};
	const read = vi.fn(async () => [item()]);
	const reader = new TrackingListReader({
		store,
		now: () => now,
		provider: { read },
		access: {
			status: () => status,
			acquire: async () => ({
				...lease,
				accountId: status.account?.id ?? "",
				generation: status.generation,
			}),
			assertCurrent: (generation) => {
				if (generation !== status.generation)
					throw new Error("Account changed");
			},
			authorizationFailed: () => {
				status.state = "authorization-required";
			},
		},
	});
	return {
		reader,
		status,
		cache,
		read,
		advance: () => {
			now += 400000;
		},
	};
}
test("refresh coalesces, preserves the full previous snapshot on failure and survives restart", async () => {
	const f = readerFixture();
	await Promise.all([f.reader.refresh(), f.reader.refresh()]);
	expect(f.read).toHaveBeenCalledTimes(1);
	expect(f.reader.read(undefined, false).entries).toEqual([item()]);
	f.advance();
	f.read.mockRejectedValueOnce(new TrackingProviderError("unavailable", null));
	const failed = await f.reader.refresh();
	expect(failed.entries).toEqual([item()]);
	expect(failed.stale).toBe(true);
	expect(failed.error?.code).toBe("unavailable");
	f.reader.read();
	expect(f.read).toHaveBeenCalledTimes(2);
	await f.reader.close();
	const dir = await mkdtemp(join(tmpdir(), "anishelf-lists-"));
	try {
		const first = ApplicationDatabase.open(dir);
		const saved = f.cache.get("anilist:7");
		if (!saved) throw new Error("Expected saved snapshot");
		first.trackingLists.replace({ ...saved, invalidated: true });
		first.close();
		const second = ApplicationDatabase.open(dir);
		try {
			expect(second.trackingLists.read("anilist:7")?.entries).toEqual([item()]);
			expect(second.trackingLists.read("anilist:7")?.invalidated).toBe(true);
			expect(second.trackingLists.read("anilist:7")?.fetchedAt).toBe(
				saved.fetchedAt,
			);
			expect(second.trackingLists.read("anilist:8")).toBeUndefined();
		} finally {
			second.close();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
test("an in-flight response cannot publish into a changed account", async () => {
	const f = readerFixture();
	let resolve!: (entries: TrackingListEntry[]) => void;
	f.read.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const pending = f.reader.refresh("first");
	await vi.waitFor(() => expect(f.read).toHaveBeenCalled());
	f.status.generation = "second";
	f.status.account = { id: "anilist:8", name: "Other" };
	resolve([item()]);
	await expect(pending).rejects.toThrow("Account changed");
	expect(f.cache.size).toBe(0);
	expect(f.reader.read(undefined, false).entries).toEqual([]);
	await f.reader.close();
});
test("authorization failure retains cached state and requires reconnect", async () => {
	const f = readerFixture();
	await f.reader.refresh();
	f.read.mockRejectedValueOnce(new TrackingProviderError("unauthorized", null));
	const snapshot = await f.reader.refresh();
	expect(snapshot.state).toBe("authorization-required");
	expect(snapshot.entries).toHaveLength(1);
	expect(snapshot.error).toEqual({ code: "unauthorized", retryAt: null });
	expect(JSON.stringify(snapshot)).not.toContain(lease.credential);
	await f.reader.close();
});
function projection() {
	const f = readerFixture();
	const snapshot: TrackingListSnapshot = {
		provider: aniListTracking,
		accountId: "anilist:7",
		generation: "first",
		state: "connected",
		fetchedAt: 1000,
		stale: false,
		refreshing: false,
		error: null,
		entries: [item(), item(2)],
	};
	const index: LocalIndex = {
		epoch: 1,
		items: [
			{
				id: "local",
				providerTitle: "Local title",
				searchTitles: [],
				format: "TV",
				year: 2025,
				episodeCount: 12,
				airedEpisodeCount: null,
				revision: 1,
				createdAt: 1,
				updatedAt: 2,
				reference: { provider: "anilist", mediaType: "anime", id: "1" },
				available: true,
			},
		],
	};
	const cards = vi.fn<AnimeCatalogApi["cards"]>(async () => []);
	const app = new AnimeLibraryQueries({
		catalog: { index: async () => index, cards },
		lists: { list: () => snapshot, refreshList: async () => snapshot },
		logger: pino({ enabled: false }),
	});
	return { app, snapshot, index, cards, f };
}
test("library merges only exact IDs, preserves local identity, and paginates after filters", async () => {
	const { app, cards, snapshot } = projection();
	const local = await app.list();
	expect(local.items.map((entry) => entry.id)).toEqual(["local"]);
	expect(local.items[0]?.viewing?.progress).toBe(3);
	expect(cards).toHaveBeenLastCalledWith(["local"], 1);
	const all = await app.list({ scope: "all", perPage: 1 });
	expect(all.hasNextPage).toBe(true);
	expect(
		(await app.list({ scope: "all", perPage: 1, page: 2 })).items,
	).toHaveLength(1);
	expect(
		(await app.list({ scope: "all", availability: "unavailable" })).items.map(
			(entry) => entry.id,
		),
	).toEqual(["anilist:anime:2"]);
	expect(
		(await app.list({ scope: "all", query: "Title 1" })).items[0]?.id,
	).toBe("local");
	snapshot.entries = [item(2)];
	expect((await app.list({ viewingStatus: "untracked" })).items[0]?.id).toBe(
		"local",
	);
	snapshot.fetchedAt = null;
	expect((await app.list({ viewingStatus: "untracked" })).items).toEqual([]);
});
test("remote lists can be browsed without a local catalog", async () => {
	const { snapshot } = projection();
	const app = new AnimeLibraryQueries({
		catalog: undefined,
		lists: { list: () => snapshot, refreshList: async () => snapshot },
		logger: pino({ enabled: false }),
	});
	expect((await app.list()).items).toEqual([]);
	const result = await app.list({ scope: "all", viewingStatus: "watching" });
	expect(result.localState).toBe("unavailable");
	expect(result.items).toHaveLength(2);
	expect(result.items.every((entry) => entry.localWorkId === null)).toBe(true);
	expect(result.items.every((entry) => entry.nextPlayback === null)).toBe(true);
});

test("a later chunk failure prevents publishing a partial list; an empty complete list clears it", async () => {
	const f = readerFixture();
	await f.reader.refresh();
	f.advance();
	const request = vi
		.fn()
		.mockResolvedValueOnce(chunk([raw(2)], true))
		.mockRejectedValueOnce(new Error("private-provider-sentinel"));
	const provider = new AniListListsClient({ request });
	f.read.mockImplementationOnce(() =>
		new AniListListProvider(provider).read(lease, lease.signal),
	);
	const failed = await f.reader.refresh();
	expect(failed.entries).toEqual([item()]);
	f.read.mockResolvedValueOnce([]);
	const empty = await f.reader.refresh();
	expect(empty.entries).toEqual([]);
	expect(empty.stale).toBe(false);
	expect(empty.error).toBeNull();
	await f.reader.close();
});
test("list logs contain outcomes and counts but no credentials, titles or provider errors", async () => {
	const f = readerFixture();
	let logs = "";
	const logger = pino(
		{ level: "trace" },
		{
			write: (line: string) => {
				logs += line;
			},
		},
	);
	const reader = new TrackingListReader({
		store: { read: () => undefined, replace: () => {} },
		provider: {
			read: vi
				.fn()
				.mockResolvedValueOnce([item()])
				.mockRejectedValueOnce(new Error("private-provider-sentinel")),
		},
		access: {
			status: () => f.status,
			acquire: async () => lease,
			assertCurrent: () => {},
			authorizationFailed: () => {},
		},
		logger,
	});
	await reader.refresh();
	await reader.refresh();
	await reader.close();
	await f.reader.close();
	expect(logs).toContain("tracking.list_refresh_completed");
	expect(logs).toContain("tracking.list_refresh_failed");
	expect(logs).toContain('"retainedCache":false');
	for (const secret of [
		lease.credential,
		"Title 1",
		"private-provider-sentinel",
	])
		expect(logs).not.toContain(secret);
});

test("unified Library HTTP validates filters and serializes merged cards", async () => {
	const { app: library } = projection();
	const http = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: pino({ enabled: false }),
		policy: builtinPolicy,
		registrations: [(app) => registerAnimeLibraryRoutes(app, library)],
		closeDependencies: async () => {},
	});
	try {
		const response = await http.inject({
			url: "/api/anime/library?scope=all&viewingStatus=watching&perPage=1",
			headers: { host: "127.0.0.1:3000" },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json().hasNextPage).toBe(true);
		expect(response.json().items[0].viewing.progress).toBe(3);
		expect(response.json().items[0]).toHaveProperty("coverUrl");
		expect(response.json().items[0]).not.toHaveProperty("remoteCoverUrl");
		for (const sort of ["updated", "unwatched", "title", "recent"])
			expect(
				(
					await http.inject({
						url: `/api/anime/library?sort=${sort}`,
						headers: { host: "127.0.0.1:3000" },
					})
				).statusCode,
			).toBe(200);
		for (const query of [
			"sort=bad",
			"scope=bad",
			"viewingStatus=bad",
			"perPage=51",
			"generation=bad",
		])
			expect(
				(
					await http.inject({
						url: `/api/anime/library?${query}`,
						headers: { host: "127.0.0.1:3000" },
					})
				).statusCode,
			).toBe(400);
	} finally {
		await http.close();
	}
});

test("assembled Tracking facade uses protocol adapters, preserves cache on malformed reads and maps expired authorization", async () => {
	const dir = await mkdtemp(join(tmpdir(), "anishelf-tracking-boundary-"));
	const database = ApplicationDatabase.openMemory();
	let mode = "success";
	const module = await createTrackingModule({
		dataDir: dir,
		store: database.tracking,
		listStore: database.trackingLists,
		operationStore: database.trackingOperations,
		...createAniListTracking({
			request: async (query) => {
				if (query.includes("Viewer"))
					return { Viewer: { id: 7, name: "Fixture" } };
				if (mode === "unauthorized")
					throw new AniListError({
						code: "unauthorized",
						message: "private-provider-sentinel",
						retryAt: null,
					});
				return mode === "malformed"
					? { MediaListCollection: null }
					: chunk([raw()]);
			},
		}),
	});
	try {
		const preview = await module.preview(
			"fixture-session",
			"private-token-sentinel",
		);
		await module.confirm(
			"fixture-session",
			preview.candidateId,
			preview.generation,
		);
		const generation = module.status().generation;
		expect((await module.refreshList(generation)).entries).toEqual([item()]);
		mode = "malformed";
		const failed = await module.refreshList(generation);
		expect(failed.error?.code).toBe("invalid-response");
		expect(failed.entries).toEqual([item()]);
		mode = "unauthorized";
		const expired = await module.refreshList(generation);
		expect(expired.state).toBe("authorization-required");
		expect(expired.error?.code).toBe("unauthorized");
		expect(expired.entries).toEqual([item()]);
		expect(JSON.stringify(expired)).not.toContain("private-token-sentinel");
		await module.disconnect(generation);
		expect(module.list(undefined, false).entries).toEqual([]);
	} finally {
		await module.close();
		database.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("confirmed writes fence an older in-flight full-list refresh", async () => {
	const f = readerFixture();
	await f.reader.refresh();
	let finish: ((value: TrackingListEntry[]) => void) | undefined;
	f.read.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const refresh = f.reader.refresh();
	await vi.waitFor(() => expect(finish).toBeDefined());
	f.reader.confirmed("anilist:7", "anilist:anime:1", {
		id: "anilist:10",
		progress: 8,
		status: "paused",
		updatedAt: 2000,
	});
	finish?.([item()]);
	await refresh;
	expect(f.reader.read(undefined, false).entries[0]?.progress).toBe(8);
	expect(f.reader.read(undefined, false).fetchedAt).toBe(1000);
	expect(f.reader.read(undefined, false).stale).toBe(true);
	await f.reader.close();
});

test("available-unwatched counts use actual episode numbers rather than availability minus progress", async () => {
	const f = projection();
	const indexed = f.index.items[0];
	if (!indexed) throw new Error("Missing local work");
	f.cards.mockResolvedValue([
		{
			...indexed,
			displayTitle: indexed.providerTitle,
			hasCover: false,
			metadataStale: false,
			availableEpisodes: 4,
			availableRegularEpisodes: 3,
			availableEpisodeTargets: [
				target(1, ["file-1", "v1"]),
				target(4, ["file-4", "v4"]),
				target(7, ["file-7", "v7"]),
			],
		},
	]);
	const [card] = (await f.app.list()).items;
	expect(card?.availableUnwatchedEpisodes).toBe(2);
	expect(card?.nextPlayback).toEqual({
		episodeId: "episode-4",
		episodeNumber: "4",
		versionCount: 1,
		fileId: "file-4",
		sourceVersion: "v4",
	});
	f.snapshot.entries = [];
	const [untracked] = (await f.app.list()).items;
	expect(untracked?.availableUnwatchedEpisodes).toBeNull();
	expect(untracked?.nextPlayback).toBeNull();
});

test("next playback points at the first available unwatched episode and leaves multi-version choice to the detail page", async () => {
	const f = projection();
	const indexed = f.index.items[0];
	if (!indexed) throw new Error("Missing local work");
	f.cards.mockResolvedValue([
		{
			...indexed,
			displayTitle: indexed.providerTitle,
			hasCover: false,
			metadataStale: false,
			availableEpisodes: 3,
			availableRegularEpisodes: 3,
			availableEpisodeTargets: [
				target(1, ["file-1", "v1"]),
				target(4, ["file-4a", "v4a"], ["file-4b", "v4b"]),
				target(8, ["file-8", "v8"]),
			],
		},
	]);
	const [card] = (await f.app.list()).items;
	expect(card?.nextPlayback).toEqual({
		episodeId: "episode-4",
		episodeNumber: "4",
		versionCount: 2,
		fileId: null,
		sourceVersion: null,
	});
	f.snapshot.entries = [{ ...item(), progress: 8 }];
	const [caughtUp] = (await f.app.list()).items;
	expect(caughtUp?.nextPlayback).toBeNull();
	expect(caughtUp?.availableUnwatchedEpisodes).toBe(0);
});

test("unwatched sorting uses all available episode mappings before pagination and batches card reads", async () => {
	const f = projection();
	const base = f.index.items[0];
	if (!base) throw new Error("Missing local work");
	f.index.items = Array.from({ length: 54 }, (_, i) => ({
		...base,
		id: `work-${i}`,
		providerTitle: `Title ${i}`,
		reference: { ...base.reference, id: String(i + 1) },
	}));
	f.snapshot.entries = f.index.items.map((_, i) => item(i + 1));
	f.cards.mockImplementation(async (ids) =>
		f.index.items
			.filter((work) => ids.includes(work.id))
			.map((work) => ({
				...work,
				displayTitle: work.providerTitle,
				hasCover: false,
				metadataStale: false,
				availableEpisodes: 2,
				availableRegularEpisodes: 2,
				availableEpisodeTargets: [
					target(1, ["file-1", "v1"]),
					target(work.id === "work-53" || work.id === "work-52" ? 7 : 3, [
						`file-${work.id}`,
						`v-${work.id}`,
					]),
				],
			})),
	);
	const first = await f.app.list({ perPage: 1 });
	expect(first.items[0]?.id).toBe("work-52");
	expect(first.items[0]?.availableUnwatchedEpisodes).toBe(1);
	expect(first.hasNextPage).toBe(true);
	expect(f.cards.mock.calls.map(([ids]) => ids.length)).toEqual([50, 4]);
	expect(
		(await f.app.list({ sort: "unwatched", perPage: 1, page: 2 })).items[0]?.id,
	).toBe("work-53");
	f.snapshot.entries = [];
	expect((await f.app.list({ perPage: 1 })).items[0]?.id).toBe("work-0");
});

test("recent addition and work update sorts use distinct timestamps and retain remote-only works", async () => {
	const f = projection();
	const base = f.index.items[0];
	if (!base) throw new Error("Missing local work");
	f.index.items = [
		{ ...base, id: "older", createdAt: 10, updatedAt: 300_000 },
		{
			...base,
			id: "newer",
			reference: { ...base.reference, id: "3" },
			createdAt: 20,
			updatedAt: 30,
		},
	];
	expect(
		(await f.app.list({ sort: "recent" })).items.map((work) => work.id),
	).toEqual(["newer", "older"]);
	expect(
		(await f.app.list({ sort: "updated" })).items.map((work) => work.id),
	).toEqual(["older", "newer"]);
	expect(
		(await f.app.list({ scope: "all", sort: "updated" })).items.map(
			(work) => work.id,
		),
	).toEqual(["older", "anilist:anime:2", "newer"]);
	expect(
		(await f.app.list({ scope: "all" })).items.at(-1)
			?.availableUnwatchedEpisodes ?? null,
	).toBeNull();
});
