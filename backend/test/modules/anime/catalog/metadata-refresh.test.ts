import { expect, test, vi } from "vitest";
import { catalogDefaults } from "../../../../src/modules/anime/anime-catalog/defaults.js";
import { MetadataError } from "../../../../src/modules/anime/metadata/domain/source-model.js";
import type { MetadataProvider } from "../../../../src/modules/anime/metadata/ports.js";

import {
	confirm,
	details,
	fixture,
	project,
	reference,
	required,
	rows,
	setupTestLifecycle,
} from "./support/anime-catalog-fixture.js";

setupTestLifecycle();

test("cached browsing stays offline and refresh failures preserve confirmed metadata and manual data", async () => {
	const f = await fixture();
	const result = await confirm(f);
	const before = await f.catalog.getLocalWorkDetail(result.workId);
	f.get.mockRejectedValue(new Error("provider outage"));
	expect(
		(await f.catalog.refresh(result.workId, before.work.revision)).metadata
			.refreshError?.code,
	).toBe("unavailable");
	const after = await f.catalog.getLocalWorkDetail(result.workId);
	expect(after.work).toEqual(before.work);
	expect(after.metadata.data).toEqual(before.metadata.data);
	expect(f.get).toHaveBeenCalledTimes(2);
	await f.catalog.list();
	await f.catalog.getLocalWorkDetail(result.workId);
	expect(f.get).toHaveBeenCalledTimes(2);
	f.database.metadata.prune(0, 0);
	expect(
		(await f.catalog.getLocalWorkDetail(result.workId)).metadata.data,
	).toEqual(before.metadata.data);
});

test("failed refresh after an intervening local edit cannot overwrite the edit", async () => {
	const f = await fixture();
	const result = await confirm(f);
	let resolve:
		| ((value: Awaited<ReturnType<MetadataProvider["get"]>>) => void)
		| undefined;
	f.get.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const refreshing = f.catalog.refresh(result.workId, result.revision);
	await vi.waitFor(() => expect(resolve).toBeDefined());
	const episode = required(
		(await f.catalog.getLocalWorkDetail(result.workId)).episodes[0],
	);
	await f.catalog.editEpisode(
		result.workId,
		episode.id,
		result.revision,
		episode.number,
		"Concurrent correction",
	);
	required(resolve)({
		data: { ...details(), description: "Refreshed" },
	});
	await expect(refreshing).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	expect(
		(await f.catalog.getLocalWorkDetail(result.workId)).episodes[0]?.label,
	).toBe("Concurrent correction");
});

test("expired details return retained data immediately and coalesce automatic updates", async () => {
	const f = await fixture();
	const result = await confirm(f);
	const before = await f.catalog.getLocalWorkDetail(result.workId);
	const episode = required(before.episodes[0]);
	await f.catalog.editEpisode(
		result.workId,
		episode.id,
		before.work.revision,
		"1",
		"My correction",
	);
	const review = required((await f.catalog.reviews()).items[0]);
	f.database.playback.openGeneration(review.sourceId);
	const progress = f.database.playback.get(review.sourceId);
	vi.spyOn(Date, "now").mockReturnValue(
		before.metadata.fetchedAt + 8 * 24 * 60 * 60_000,
	);
	let complete:
		| ((value: Awaited<ReturnType<MetadataProvider["get"]>>) => void)
		| undefined;
	f.get.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const first = await f.catalog.getLocalWorkDetail(result.workId);
	const second = await f.catalog.getLocalWorkDetail(result.workId);
	expect(first.metadata).toMatchObject({
		snapshotId: before.metadata.snapshotId,
		stale: true,
		refreshing: true,
	});
	expect(second.metadata.refreshing).toBe(true);
	await vi.waitFor(() => expect(complete).toBeDefined());
	expect(f.get).toHaveBeenCalledTimes(2);
	required(complete)({
		data: { ...details(), description: "Automatic update", episodeCount: 13 },
	});
	await vi.waitFor(() =>
		expect(f.publicMetadata.current(project(f))?.snapshotId).not.toBe(
			before.metadata.snapshotId,
		),
	);
	const after = await f.catalog.getLocalWorkDetail(result.workId);
	expect(after.metadata.data.description).toBe("Automatic update");
	expect(after.work.episodeCount).toBe(13);
	expect(after.metadata.refreshing).toBe(false);
	expect(after.episodes[0]).toMatchObject({
		id: episode.id,
		label: "My correction",
		number: "1",
	});
	expect(f.database.playback.get(review.sourceId)).toEqual(progress);
	f.database.metadata.prune(0, 0);
	expect(f.publicMetadata.snapshot(before.metadata.snapshotId).data).toEqual(
		before.metadata.data,
	);
	expect(f.publicMetadata.snapshot(after.metadata.snapshotId).data).toEqual(
		after.metadata.data,
	);
});

test("startup refreshes expired releasing works without a detail request and skips finished works", async () => {
	const f = await fixture(
		["Anime - 01.mkv", "Anime - 02.mkv"],
		undefined,
		true,
	);
	f.setData({ ...details(), status: "RELEASING" });
	const selected = await rows(f);
	const releasing = await confirm(f, Promise.resolve([required(selected[0])]));
	f.setData(details("2"));
	const finished = await confirm(
		f,
		Promise.resolve([required(selected[1])]),
		"2",
	);
	expect(f.database.catalog.refreshWorks("", 50)).toHaveLength(2);
	const link = required(f.database.catalog.link(releasing.workId) ?? undefined);
	const finishedLink = required(
		f.database.catalog.link(finished.workId) ?? undefined,
	);
	const fetchedAt = f.publicMetadata.snapshot(link.snapshotId).fetchedAt;
	vi.useFakeTimers();
	vi.setSystemTime(fetchedAt + 6 * 60 * 60_000 - 5001);
	f.setData({
		...details(),
		status: "FINISHED",
		description: "Series completed",
	});
	await f.restart();
	f.get.mockClear();
	await vi.advanceTimersByTimeAsync(5000);
	expect(f.get).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(catalogDefaults.refreshIntervalMs - 1);
	expect(f.get).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(f.get).toHaveBeenCalledTimes(1);
	expect(f.publicMetadata.current(link.reference)?.snapshotId).not.toBe(
		link.snapshotId,
	);
	expect(f.publicMetadata.current(finishedLink.reference)?.snapshotId).toBe(
		finishedLink.snapshotId,
	);
	vi.setSystemTime(fetchedAt + 16 * 24 * 60 * 60_000);
	await vi.advanceTimersByTimeAsync(catalogDefaults.refreshIntervalMs);
	expect(f.get).toHaveBeenCalledTimes(1);
	const oldFinished = await f.catalog.getLocalWorkDetail(finished.workId);
	expect(oldFinished.metadata.refreshing).toBe(true);
	await vi.advanceTimersByTimeAsync(0);
	expect(f.get).toHaveBeenCalledTimes(2);
});

test("automatic failure keeps the snapshot and honors persisted retry time across restart", async () => {
	const f = await fixture(undefined, undefined, true);
	const result = await confirm(f);
	const before = await f.catalog.getLocalWorkDetail(result.workId);
	let now = before.metadata.fetchedAt + 8 * 24 * 60 * 60_000;
	vi.spyOn(Date, "now").mockImplementation(() => now);
	f.get.mockRejectedValue(new Error("Provider offline"));
	await f.catalog.getLocalWorkDetail(result.workId);
	await vi.waitFor(() =>
		expect(
			f.publicMetadata.snapshot(before.metadata.snapshotId).refreshError,
		).not.toBeNull(),
	);
	await f.restart();
	const retry = await f.catalog.getLocalWorkDetail(result.workId);
	expect(retry.metadata).toMatchObject({
		snapshotId: before.metadata.snapshotId,
		refreshing: false,
		refreshError: { code: "unavailable" },
	});
	expect(f.get).toHaveBeenCalledTimes(2);
	f.get.mockImplementation(async () => ({
		data: { ...details(), description: "Recovered" },
	}));
	now += 60_001;
	await f.catalog.getLocalWorkDetail(result.workId);
	await vi.waitFor(() =>
		expect(f.publicMetadata.current(project(f))?.snapshotId).not.toBe(
			before.metadata.snapshotId,
		),
	);
	expect(
		(await f.catalog.getLocalWorkDetail(result.workId)).metadata.refreshError,
	).toBeNull();
});

test("automatic refresh yields to a concurrent correction then adopts cached metadata without another provider read", async () => {
	const f = await fixture();
	const result = await confirm(f);
	const before = await f.catalog.getLocalWorkDetail(result.workId);
	vi.spyOn(Date, "now").mockReturnValue(
		before.metadata.fetchedAt + 8 * 24 * 60 * 60_000,
	);
	let complete:
		| ((value: Awaited<ReturnType<MetadataProvider["get"]>>) => void)
		| undefined;
	f.get.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	await f.catalog.getLocalWorkDetail(result.workId);
	await vi.waitFor(() => expect(complete).toBeDefined());
	const episode = required(before.episodes[0]);
	await f.catalog.editEpisode(
		result.workId,
		episode.id,
		before.work.revision,
		"1",
		"Concurrent correction",
	);
	required(complete)({
		data: { ...details(), description: "New data" },
	});
	await vi.waitFor(async () =>
		expect(
			(await f.metadata.get(reference, { cachedOnly: true })).data.description,
		).toBe("New data"),
	);
	await vi.waitFor(async () =>
		expect(
			(await f.catalog.getLocalWorkDetail(result.workId)).metadata.data
				.description,
		).toBe("New data"),
	);
	expect(
		(await f.catalog.getLocalWorkDetail(result.workId)).episodes[0]?.label,
	).toBe("Concurrent correction");
	expect(f.get).toHaveBeenCalledTimes(2);
});

test("background checks rotate through batches and exclude works without source associations", async () => {
	const f = await fixture(
		Array.from({ length: 8 }, (_, i) => `Anime - ${i + 1}.mkv`),
		undefined,
		true,
	);
	const selected = await rows(f);
	const committed: Awaited<ReturnType<typeof confirm>>[] = [];
	for (let index = 0; index < 8; index++) {
		const id = String(index + 1);
		f.setData({ ...details(id), status: "RELEASING" });
		committed.push(
			await confirm(f, Promise.resolve([required(selected[index])]), id),
		);
	}
	const removedReview = required(
		(await f.catalog.reviews()).items.find(
			(item) => item.associations[0]?.workId === committed[7]?.workId,
		),
	);
	await f.catalog.remove(
		removedReview.id,
		removedReview.revision,
		"Remove local association",
	);
	expect(f.database.catalog.refreshWorks("", 50)).toHaveLength(7);
	const link = required(
		f.database.catalog.link(required(committed[0]).workId) ?? undefined,
	);
	const fetchedAt = f.publicMetadata.snapshot(link.snapshotId).fetchedAt;
	vi.useFakeTimers();
	vi.setSystemTime(fetchedAt + 25 * 60 * 60_000);
	await f.restart();
	f.get.mockClear();
	await vi.advanceTimersByTimeAsync(5000);
	expect(f.get).toHaveBeenCalledTimes(5);
	await vi.advanceTimersByTimeAsync(catalogDefaults.refreshIntervalMs);
	expect(f.get).toHaveBeenCalledTimes(7);
	await vi.advanceTimersByTimeAsync(catalogDefaults.refreshIntervalMs);
	expect(f.get).toHaveBeenCalledTimes(7);
	expect(f.get.mock.calls.some(([ref]) => ref.id === "8")).toBe(false);
});

test("manual refresh joins an automatic request and accepts its already applied snapshot", async () => {
	const f = await fixture();
	const result = await confirm(f);
	const before = await f.catalog.getLocalWorkDetail(result.workId);
	vi.spyOn(Date, "now").mockReturnValue(
		before.metadata.fetchedAt + 8 * 24 * 60 * 60_000,
	);
	let complete:
		| ((value: Awaited<ReturnType<MetadataProvider["get"]>>) => void)
		| undefined;
	f.get.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	await f.catalog.getLocalWorkDetail(result.workId);
	await vi.waitFor(() => expect(complete).toBeDefined());
	const reads = vi.spyOn(f.metadata, "get");
	const manual = f.catalog.refresh(result.workId, before.work.revision);
	await vi.waitFor(() => expect(reads).toHaveBeenCalled());
	required(complete)({
		data: { ...details(), description: "Shared refresh" },
	});
	expect((await manual).metadata.data.description).toBe("Shared refresh");
	expect(f.get).toHaveBeenCalledTimes(2);
	expect(f.database.catalog.work(result.workId)?.revision).toBe(
		before.work.revision,
	);
});

test("automatic errors for a missing current cache key are visible without replacing the retained snapshot", async () => {
	const f = await fixture();
	const result = await confirm(f);
	const before = await f.catalog.getLocalWorkDetail(result.workId);
	const now = before.metadata.fetchedAt + 8 * 24 * 60 * 60_000;
	vi.spyOn(Date, "now").mockReturnValue(now);
	const reads = vi
		.spyOn(f.metadata, "get")
		.mockImplementation(async (_reference, options) => {
			throw new MetadataError({
				code: options?.cachedOnly ? "not-found" : "rate-limited",
				message: "Retry later",
				retryAt: options?.cachedOnly ? null : now + 120_000,
			});
		});
	await f.catalog.getLocalWorkDetail(result.workId);
	await vi.waitFor(async () =>
		expect(
			(await f.catalog.getLocalWorkDetail(result.workId)).metadata.refreshError
				?.code,
		).toBe("rate-limited"),
	);
	expect(reads).toHaveBeenCalledTimes(2);
	const after = await f.catalog.getLocalWorkDetail(result.workId);
	expect(after.metadata.snapshotId).toBe(before.metadata.snapshotId);
	expect(after.metadata.data).toEqual(before.metadata.data);
	expect(after.metadata.refreshing).toBe(false);
});

test("unchanged provider details renew freshness without incrementing the local work revision", async () => {
	const f = await fixture();
	const result = await confirm(f);
	const before = await f.catalog.getLocalWorkDetail(result.workId);
	const now = before.metadata.fetchedAt + 8 * 24 * 60 * 60_000;
	vi.spyOn(Date, "now").mockReturnValue(now);
	await f.catalog.getLocalWorkDetail(result.workId);
	await vi.waitFor(() =>
		expect(f.publicMetadata.snapshot(before.metadata.snapshotId).stale).toBe(
			false,
		),
	);
	const after = await f.catalog.getLocalWorkDetail(result.workId);
	expect(after.work.revision).toBe(before.work.revision);
	expect(after.metadata.snapshotId).toBe(before.metadata.snapshotId);
	expect(after.metadata.fetchedAt).toBe(now);
	expect(f.get).toHaveBeenCalledTimes(2);
});
