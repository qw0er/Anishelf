import { expect, test, vi } from "vitest";
import { rssConstraints } from "../../../../src/contracts/defaults.js";
import { createAcquisitionModule } from "../../../../src/modules/acquisition/create.js";
import type { AcquisitionTarget } from "../../../../src/modules/anime/public.js";
import {
	cleanup,
	feed,
	fixture,
	item,
	key,
	secondHash,
	setupTestLifecycle,
} from "./support/rss-fixture.js";

vi.mock("node:fs/promises", async () => {
	const { memoryFs } = await import("../../../support/memory-filesystem.js");
	return memoryFs.promises;
});

setupTestLifecycle();

test("unchanged feeds reuse parsed evidence; failures retain candidates, validators and next retry", async () => {
	const f = await fixture();
	const saved = await f.subscribe();
	f.advance();
	f.fetch.mockResolvedValueOnce({
		xml: null as never,
		etag: "etag-1",
		lastModified: null,
	});
	const unchanged = await f.discovery.refresh(
		key,
		saved.subscription?.revision ?? "",
	);
	expect(unchanged.candidates).toEqual(saved.candidates);
	f.advance();
	f.fetch.mockRejectedValueOnce(new Error("private-feed-token"));
	const failed = await f.discovery.refresh(
		key,
		saved.subscription?.revision ?? "",
	);
	expect(failed.candidates).toEqual(saved.candidates);
	expect(failed.subscription?.error).toBeTruthy();
	expect(f.logs.join("")).not.toContain("private-feed-token");
});

test("saving is local, rejects stale revisions and persists initial source failures for retry", async () => {
	const f = await fixture();
	const input = {
		workKey: key,
		source: { kind: "feed" as const, url: "https://feeds.example.org/rss" },
		startEpisode: 1,
		revision: null,
		...f.stamp(),
	};
	const saved = await f.discovery.save(input);
	expect(f.fetch).not.toHaveBeenCalled();
	expect(f.options.anime.target).not.toHaveBeenCalled();
	expect(saved.subscription).toMatchObject({ enabled: true, checkedAt: null });
	expect(saved.candidates).toEqual([]);
	await expect(f.discovery.save(input)).rejects.toMatchObject({
		code: "ACQUISITION_CONFLICT",
	});
	f.fetch.mockRejectedValueOnce(new Error("offline"));
	await f.discovery.refresh(key, saved.subscription?.revision ?? "");
	expect(f.discovery.get(key).subscription?.error).toBeTruthy();
	f.advance();
	const updated = await f.discovery.refresh(
		key,
		saved.subscription?.revision ?? "",
	);
	expect(updated.subscription?.error).toBeNull();
});

test("pause, restart and removal preserve state without fetching on reads", async () => {
	const f = await fixture();
	const saved = await f.subscribe();
	const paused = await f.discovery.setEnabled(
		key,
		saved.subscription?.revision ?? "",
		false,
	);
	const count = f.fetch.mock.calls.length;
	f.discovery.get(key);
	expect(f.fetch.mock.calls).toHaveLength(count);
	f.database.authentication.saveSession(
		"retained",
		JSON.stringify({
			cookie: {
				expires: null,
				originalMaxAge: null,
				sameSite: "lax",

				path: "/",
				httpOnly: true,
				domain: null,
			},
		}),
		9_999_999,
	);
	const reopened = await createAcquisitionModule(f.options);
	cleanup.push(() => reopened.close());
	expect(reopened.api.subscriptions?.get(key)).toEqual(paused);
	expect(
		JSON.parse(f.database.authentication.readSession("retained", 0) ?? "null"),
	).toMatchObject({ cookie: { path: "/", httpOnly: true } });
	await expect(
		f.discovery.refresh(key, paused.subscription?.revision ?? ""),
	).rejects.toMatchObject({ code: "ACQUISITION_CONFLICT" });
	await f.discovery.remove(key, paused.subscription?.revision ?? "");
	expect(f.discovery.get(key).total).toBe(0);
	expect(f.database.acquisition.subscriptions()).toHaveLength(0);
});

test("shared RSS bindings save locally and concurrent refreshes collect once for both works", async () => {
	const f = await fixture();
	const input = {
		source: { kind: "feed" as const, url: "https://feeds.example.org/shared" },
		startEpisode: 1,
		revision: null,
		...f.stamp(),
	};
	const one = await f.discovery.save({ ...input, workKey: key });
	const two = await f.discovery.save({ ...input, workKey: "anilist:anime:2" });
	expect(f.fetch).not.toHaveBeenCalled();
	await Promise.all([
		f.discovery.refresh(key, one.subscription?.revision ?? ""),
		f.discovery.refresh("anilist:anime:2", two.subscription?.revision ?? ""),
	]);
	expect(f.fetch).toHaveBeenCalledTimes(1);
	expect(f.database.acquisition.subscriptions()).toHaveLength(2);
});

test("pausing during discovery prevents stale candidate publication", async () => {
	const f = await fixture();
	const saved = await f.subscribe();
	f.advance();
	let resolve: (value: {
		xml: string;
		etag: string;
		lastModified: null;
	}) => void = () => {};
	f.fetch.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const refreshing = f.discovery.refresh(
		key,
		saved.subscription?.revision ?? "",
	);
	const paused = await f.discovery.setEnabled(
		key,
		saved.subscription?.revision ?? "",
		false,
	);
	resolve({
		xml: feed(item("Frieren - 04", secondHash)),
		etag: "next",
		lastModified: null,
	});
	await refreshing;
	expect(f.discovery.get(key).candidates).toEqual(saved.candidates);
	expect(f.discovery.get(key).subscription?.revision).toBe(
		paused.subscription?.revision,
	);
});

test("a source change during metadata assessment rejects all stale candidate and evidence writes", async () => {
	const f = await fixture();
	const saved = await f.subscribe();
	f.advance();
	let finish!: (value: AcquisitionTarget) => void;
	f.options.anime.target.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const refreshing = f.discovery.refresh(
		key,
		saved.subscription?.revision ?? "",
	);
	await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
	const newer = await f.discovery.save({
		workKey: key,
		source: { kind: "feed" as const, url: "https://feeds.example.org/another" },
		startEpisode: 1,
		revision: saved.subscription?.revision ?? null,
		...f.stamp(),
	});
	finish(f.state.target);
	await refreshing;
	expect(f.discovery.get(key)).toEqual(newer);
});

test("startup recovers due subscriptions and a shared feed has one bounded scheduled fetch", async () => {
	const f = await fixture();
	await f.subscribe();
	f.advance();
	vi.useFakeTimers();
	const worker = await createAcquisitionModule({
		...f.options,
		autoStart: true,
	});
	cleanup.push(() => worker.close());
	await vi.advanceTimersByTimeAsync(0);
	expect(f.fetch).toHaveBeenCalledTimes(2);
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.fetch).toHaveBeenCalledTimes(2);
	await worker.close();
	f.advance();
	await vi.advanceTimersByTimeAsync(600_000);
	expect(f.fetch).toHaveBeenCalledTimes(2);
});

test("RSS uses the default interval and reschedules existing feeds after live changes", async () => {
	const f = await fixture();
	const saved = await f.subscribe();
	const feedId = saved.subscription?.feedId ?? "";
	const initial = f.database.acquisition.feed(feedId);
	expect(initial?.nextAttemptAt).toBe(
		(initial?.checkedAt ?? 0) +
			rssConstraints.defaultRefreshIntervalMinutes * 60_000,
	);
	vi.useFakeTimers();
	const worker = await createAcquisitionModule({
		...f.options,
		autoStart: true,
	});
	cleanup.push(() => worker.close());
	await vi.advanceTimersByTimeAsync(0);
	f.advance(10 * 60_000);
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.fetch).toHaveBeenCalledTimes(1);
	f.state.refreshIntervalMinutes = 60;
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.database.acquisition.feed(feedId)?.nextAttemptAt).toBe(
		(initial?.checkedAt ?? 0) + 60 * 60_000,
	);
	f.advance(20 * 60_000);
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.fetch).toHaveBeenCalledTimes(1);
	// Reducing the interval makes this existing feed due on the next scheduler check.
	f.state.refreshIntervalMinutes = 15;
	f.fetch.mockResolvedValueOnce({
		xml: null as never,
		etag: "etag-1",
		lastModified: null,
	});
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.fetch).toHaveBeenCalledTimes(2);
	const refreshed = f.database.acquisition.feed(feedId);
	expect(refreshed?.nextAttemptAt).toBe(
		(refreshed?.checkedAt ?? 0) + 15 * 60_000,
	);
	expect(f.discovery.get(key).candidates).toEqual(saved.candidates);
});

test("changing the RSS interval preserves failure retry deadlines and restart recovery", async () => {
	const f = await fixture();
	const saved = await f.subscribe();
	const feedId = saved.subscription?.feedId ?? "";
	f.advance();
	f.fetch.mockRejectedValueOnce(new Error("source unavailable"));
	await f.discovery.refresh(key, saved.subscription?.revision ?? "");
	const failed = f.database.acquisition.feed(feedId);
	expect(failed?.failures).toBe(1);
	f.state.refreshIntervalMinutes = 1440;
	vi.useFakeTimers();
	const worker = await createAcquisitionModule({
		...f.options,
		autoStart: true,
	});
	cleanup.push(() => worker.close());
	await vi.advanceTimersByTimeAsync(0);
	expect(f.database.acquisition.feed(feedId)?.nextAttemptAt).toBe(
		failed?.nextAttemptAt,
	);
	expect(f.fetch).toHaveBeenCalledTimes(2);
	f.advance(120_000);
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.fetch).toHaveBeenCalledTimes(3);
	const recovered = f.database.acquisition.feed(feedId);
	expect(recovered?.failures).toBe(0);
	expect(recovered?.nextAttemptAt).toBe(
		(recovered?.checkedAt ?? 0) + 1440 * 60_000,
	);
});

test("scope edits keep a saved source without revealing or resubmitting its URL", async () => {
	const f = await fixture();
	const saved = await f.subscribe();
	const count = f.fetch.mock.calls.length;
	const updated = await f.discovery.save({
		workKey: key,
		source: null,
		startEpisode: 4,
		revision: saved.subscription?.revision ?? null,
		...f.stamp(),
	});
	expect(updated.subscription).toMatchObject({
		feedId: saved.subscription?.feedId,
		startEpisode: 4,
	});
	expect(f.fetch).toHaveBeenCalledTimes(count);
	expect(JSON.stringify(updated)).not.toContain("private-feed-token");
});

test("shared-source candidate publication rolls back every work and source evidence together", async () => {
	const f = await fixture();
	const first = await f.subscribe();
	const second = await f.discovery.save({
		workKey: "anilist:anime:2",
		source: {
			kind: "feed" as const,
			url: "https://feeds.example.org/rss?passkey=private-feed-token",
		},
		startEpisode: 1,
		revision: null,
		...f.stamp(),
	});
	const sourceId = first.subscription?.feedId ?? "";
	const before = f.database.acquisition.feed(sourceId),
		one = f.database.acquisition.candidates(key),
		two = f.database.acquisition.candidates("anilist:anime:2");
	f.advance();
	f.fetch.mockResolvedValueOnce({
		xml: feed(item("Frieren - 04 [1080p]", secondHash)),
		etag: "new",
		lastModified: null,
	});
	const update = f.database.acquisition.updateCandidates.bind(
		f.database.acquisition,
	);
	let calls = 0;
	vi.spyOn(f.database.acquisition, "updateCandidates").mockImplementation(
		(...args) => (++calls === 2 ? false : update(...args)),
	);
	await f.discovery.refresh(key, first.subscription?.revision ?? "");
	expect(calls).toBe(2);
	expect(f.database.acquisition.feed(sourceId)).toEqual(before);
	expect(f.database.acquisition.candidates(key)).toEqual(one);
	expect(f.database.acquisition.candidates("anilist:anime:2")).toEqual(two);
	expect(second.subscription?.feedId).toBe(sourceId);
});
