import { expect, test, vi } from "vitest";
import { TorrentError } from "../../../../src/modules/acquisition/torrent-clients/public.js";

import {
	connectedModule,
	fixture,
	key,
	seedSubscription,
	setupTestLifecycle,
	target,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();

test("repeated polling and restart retain one task, identity and directory", async () => {
	const f = await fixture(true);
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	await Promise.all([f.worker.tick(), f.worker.tick()]);
	await f.restart();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.db.acquisitionDownloads.activity(key, 1, 100).items).toHaveLength(1);
	expect(f.db.acquisitionDownloads.directory(key)).toBe("Frieren [anilist-1]");
	expect(JSON.stringify(f.worker.activity(key))).not.toMatch(
		/magnet|passkey|secret|savePath|unresolved/,
	);
});

test("scope pause during asynchronous submission preparation prevents add", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.anime.target
		.mockImplementationOnce(async () => target)
		.mockImplementationOnce(async () => {
			const sub = f.db.acquisition.subscription(key),
				feed = f.db.acquisition.feed("feed");
			if (sub && feed)
				seedSubscription(
					f.db.acquisition,
					{ ...sub, enabled: false, revision: "paused" },
					feed,
					f.db.acquisition.candidates(key),
				);
			return target;
		});
	await f.worker.tick();
	expect(f.add).not.toHaveBeenCalled();
});

test("direct subscription save binds the current target without a source request and rejects stale configuration", async () => {
	const f = await fixture();
	const module = await connectedModule(f);
	const downloads = module.api.downloads;
	if (!downloads) throw new Error();
	const dest = await downloads.saveDestination({
		revision: null,
		scopeId: "root",
		path: "/downloads",
	});
	await downloads.validate(dest.revision);
	const input = {
		workKey: key,
		source: { kind: "feed" as const, url: "https://example.org/new-feed" },
		startEpisode: 1,
		revision: f.db.acquisition.subscription(key)?.revision ?? null,
		destinationRevision: dest.revision,
		connectionGeneration: module.api.connection.settings().generation,
	};
	const saved = await module.api.subscriptions.save(input);
	expect(saved.candidates).toEqual([]);
	expect(saved.subscription?.checkedAt).toBeNull();
	const stored = f.db.acquisition.subscription(key);
	expect(stored?.sourceInput).toEqual(input.source);
	expect(stored?.feedId && f.db.acquisition.source(stored.feedId)).toBeNull();
	expect(downloads.activity(key).authorized).toBe(true);
	await downloads.saveDestination({
		revision: dest.revision,
		scopeId: "root",
		path: "/other",
	});
	await expect(
		module.api.subscriptions.save({
			...input,
			revision: saved.subscription?.revision ?? null,
			startEpisode: 2,
		}),
	).rejects.toMatchObject({ code: "ACQUISITION_CONFLICT" });
	expect(f.db.acquisition.subscription(key)?.startEpisode).toBe(1);
});

test("failed pre-reservation metadata checks remain visible and recover without losing candidates", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.anime.target.mockRejectedValueOnce(new Error("offline"));
	await f.worker.tick();
	expect(f.worker.activity(key).planningError).toBe("acquisition_unavailable");
	expect(f.db.acquisition.candidates(key)).toHaveLength(1);
	f.advance();
	await f.worker.tick();
	expect(f.worker.activity(key).planningError).toBeNull();
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("changed release selection cannot submit a previously reserved publication; explicit recovery uses the current choice", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.anime.target
		.mockImplementationOnce(async () => target)
		.mockImplementationOnce(async () => {
			const sub = f.db.acquisition.subscription(key),
				feed = f.db.acquisition.feed("feed");
			if (!sub || !feed) throw new Error();
			seedSubscription(
				f.db.acquisition,
				sub,
				{
					...feed,
					entries: [
						{
							...feed.entries[0],
							id: "new-entry",
							observationId: "new-entry",
							title: "Frieren - 03 new release",
							publishedAt: 1,
							downloadUrl: `magnet:?xt=urn:btih:${"b".repeat(40)}`,
							hash: "b".repeat(40),
						},
					],
				},
				[
					{
						...f.db.acquisition.candidates(key)[0],
						id: "new-candidate",
						workKey: key,
						entryId: "new-entry",
						title: "Frieren - 03 new release",
						episode: 3,
						status: "selected",
						reasons: [],
						version: "1",
						snapshotId: "snapshot",
						publishedAt: 1,
					},
				],
			);
			return target;
		});
	await f.worker.tick();
	expect(f.add).not.toHaveBeenCalled();
	const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error();
	expect(item.error).toBe("selection_changed");
	f.worker.retry(item.id, item.revision, "retry-new-selection", "acquisition");
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.add.mock.calls[0]?.[0].source).toMatchObject({
		magnet: `magnet:?xt=urn:btih:${"b".repeat(40)}`,
	});
});

test("pre-submission checks exclude another active version and reject stale release evidence", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	vi.mocked(f.client.tasks).mockResolvedValueOnce([
		{
			hash: "b".repeat(40),
			v1Hash: "b".repeat(40),
			v2Hash: null,
			name: "Frieren - 03 other",
			state: "downloading",
			progress: 0.5,
			remainingBytes: 50,
			totalBytes: 100,
			downloadBytesPerSecond: 1,
			uploadBytesPerSecond: 0,
			savePath: "/elsewhere",
			contentPath: "/elsewhere/file",
			ownerKey: null,
		},
	]);
	await f.worker.tick();
	expect(f.add).not.toHaveBeenCalled();
	let item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error();
	expect(item.error).toBe("episode_downloading");
	f.worker.retry(item.id, item.revision, "retry-evidence", "acquisition");
	f.anime.assessReleaseTitle.mockReturnValueOnce({
		episode: 3,
		eligible: false,
		reasons: ["identity_unconfirmed"],
		version: "2",
	});
	await f.worker.tick();
	expect(f.add).not.toHaveBeenCalled();
	item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	expect(item?.error).toBe("release_evidence_changed");
});

test("subscription save rolls back binding, subscription, candidates and permission together", async () => {
	const f = await fixture();
	const module = await connectedModule(f);
	const downloads = module.api.downloads;
	if (!downloads) throw new Error();
	const destination = await downloads.saveDestination({
		revision: null,
		scopeId: "root",
		path: "/downloads",
	});
	await downloads.validate(destination.revision);
	const before = f.db.acquisition.subscription(key),
		candidates = f.db.acquisition.candidates(key),
		sources = f.db.acquisition.sources();
	const input = {
		workKey: key,
		source: { kind: "feed" as const, url: "https://example.org/other-feed" },
		startEpisode: 2,
		revision: before?.revision ?? null,
		destinationRevision: destination.revision,
		connectionGeneration: module.api.connection.settings().generation,
	};
	const authorize = f.db.acquisition.authorize.bind(f.db.acquisition);
	const write = vi
		.spyOn(f.db.acquisition, "authorize")
		.mockImplementationOnce((value) => {
			authorize(value);
			throw new Error("storage failed");
		});
	await expect(module.api.subscriptions.save(input)).rejects.toThrow(
		"storage failed",
	);
	expect(f.db.acquisition.subscription(key)).toEqual(before);
	expect(f.db.acquisition.candidates(key)).toEqual(candidates);
	expect(f.db.acquisition.sources()).toEqual(sources);
	expect(f.db.acquisition.authorization(key)).toBeNull();
	write.mockRestore();
	await module.api.subscriptions.save(input);
	expect(downloads.activity(key).authorized).toBe(true);
});

test("definitive submission failures retain retryable intent after the submitting revision is persisted", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.add.mockRejectedValueOnce(new TorrentError("unavailable", "rejected"));
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		state: "pending",
		error: "downloader_unavailable",
		attempts: 2,
	});
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	f.advance();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(2);
	expect(f.worker.activity(key).items[0]?.state).toBe("bound");
});

test("successful reservation checks preserve Discovery assessment errors and candidate evidence", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	const subscription = f.db.acquisition.subscription(key),
		candidates = f.db.acquisition.candidates(key);
	if (!subscription) throw new Error();
	f.db.acquisition.updateCandidates(
		subscription,
		candidates,
		"assessment_unavailable",
	);
	await f.worker.tick();
	expect(f.db.acquisition.subscription(key)?.lastError).toBe(
		"assessment_unavailable",
	);
	expect(f.db.acquisition.candidates(key)).toEqual(candidates);
});

test("source reference is rechecked after subscription admission before submission", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	vi.spyOn(f.reader, "isCurrent").mockReturnValue(false);
	await f.worker.tick();
	expect(f.add).not.toHaveBeenCalled();
	expect(f.db.acquisitionDownloads.activity(key, 1, 100).items[0]?.error).toBe(
		"source_changed",
	);
});
