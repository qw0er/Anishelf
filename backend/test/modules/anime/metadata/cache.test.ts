import { expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { AniListWrapper } from "../../../../src/modules/anime/anilist/public.js";
import { createAniListMetadata } from "../../../../src/modules/anime/integration/anilist.js";
import { SourceMetadataApplication as MetadataApplication } from "../../../../src/modules/anime/metadata/application/source-metadata.js";
import { createMetadataModule } from "../../../../src/modules/anime/metadata/create.js";
import { metadataDefaults } from "../../../../src/modules/anime/metadata/defaults.js";
import type { CacheEntry } from "../../../../src/modules/anime/metadata/ports.js";

import {
	failure,
	logger,
	media,
	reference,
	setup,
	setupTestLifecycle,
	transport,
} from "./support/metadata-fixture.js";

setupTestLifecycle();

test("fresh cache survives database restart and returned values are independent", async () => {
	const { application, dir, fetcher, publicMetadata } = await setup(
		undefined,
		undefined,
		true,
	);
	const publicFirst = await publicMetadata.get(
		publicMetadata.resolveReference("154587"),
	);
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
			).toBe(publicFirst.snapshotId);
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
	now += metadataDefaults.finishedFreshMs + 1;
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
		metadataDefaults.emptySearchFreshMs,
	);
	now = metadataDefaults.emptySearchFreshMs - 1;
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
