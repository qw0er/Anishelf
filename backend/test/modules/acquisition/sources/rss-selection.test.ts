import { expect, test, vi } from "vitest";
import { createQbittorrentClient } from "../../../../src/modules/acquisition/torrent-clients/create.js";
import {
	feed,
	fixture,
	hash,
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

test("subscriptions save and rank versions in background refresh without review", async () => {
	const f = await fixture();
	f.fetch.mockResolvedValueOnce({
		xml: feed(
			item() +
				item(
					"[Other] Frieren - 03 [720p]",
					secondHash,
					"Wed, 21 Oct 2026 10:00:00 GMT",
				) +
				item("Other Anime - 02", "c".repeat(40)),
		),
		etag: "a",
		lastModified: null,
	});
	const saved = await f.subscribe(key, 2);
	expect(
		saved.candidates.filter((candidate) => candidate.status === "selected"),
	).toHaveLength(0);
	expect(
		saved.candidates.find((candidate) => candidate.episode === 3)?.reasons,
	).toContain("waiting_for_level");
	expect(saved.subscription).toMatchObject({ enabled: true, startEpisode: 2 });
	expect(JSON.stringify(saved)).not.toContain("private-feed-token");
	expect(f.logs.join("")).not.toContain("private-feed-token");
	f.advance(60 * 60_000);
	f.fetch.mockResolvedValueOnce({
		xml: feed(
			item(
				"[New] Frieren - 03 [2160p]",
				"d".repeat(40),
				"Mon, 19 Oct 2026 10:00:00 GMT",
			),
		),
		etag: "b",
		lastModified: null,
	});
	const refreshed = await f.discovery.refresh(
		key,
		saved.subscription?.revision ?? "",
	);
	expect(
		refreshed.candidates.find((candidate) => candidate.status === "selected")
			?.entryId,
	).toBe(
		refreshed.candidates.find((candidate) =>
			candidate.title.includes("[2160p]"),
		)?.entryId,
	);
});

test("scope, accessible local episodes and unknown download links are automatically excluded", async () => {
	const f = await fixture();
	f.state.target.availableEpisodes = [3];
	f.fetch.mockResolvedValueOnce({
		xml: feed(
			item("Frieren - 01") +
				item("Frieren - 03", secondHash) +
				`<item><title>Frieren - 04</title><guid>no-download</guid><link>https://example.org/view/4</link></item>`,
		),
		etag: "a",
		lastModified: null,
	});
	const result = await f.subscribe(key, 2);
	expect(result.candidates.flatMap((candidate) => candidate.reasons)).toEqual(
		expect.arrayContaining([
			"outside_scope",
			"already_available",
			"download_unavailable",
		]),
	);
	expect(
		result.candidates.every((candidate) => candidate.status === "skipped"),
	).toBe(true);
});

test("known downloader hashes exclude alternate versions, while failed snapshots block selection", async () => {
	const tasks = vi.fn(async () => [
		{
			hash,
			v1Hash: hash,
			v2Hash: null,
			name: "Frieren - 03",
			state: "downloading" as const,
			progress: 0.5,
			remainingBytes: 1,
			totalBytes: 2,
			downloadBytesPerSecond: 0,
			uploadBytesPerSecond: 0,
			savePath: "/data/media",
			contentPath: "/data/media/file.mkv",
			ownerKey: null,
		},
	]);
	const f = await fixture((options) => {
		const client = createQbittorrentClient(options);
		vi.spyOn(client, "tasks").mockImplementation(tasks);
		return client;
	});
	await f.module.api.connection.save({
		generation: f.module.api.connection.settings().generation,
		url: "http://qbittorrent:8080",
		username: "admin",
		password: "private-password",
	});
	f.fetch.mockResolvedValue({
		xml: feed(item() + item("Frieren - 03 [1080p]", secondHash)),
		etag: "one",
		lastModified: null,
	});
	const saved = await f.subscribe();
	expect(saved.candidates.map((candidate) => candidate.reasons)).toEqual(
		expect.arrayContaining([["existing_download"], ["episode_downloading"]]),
	);
	f.advance();
	tasks.mockRejectedValueOnce(new Error("private transport error"));
	const failed = await f.discovery.refresh(
		key,
		saved.subscription?.revision ?? "",
	);
	expect(
		failed.candidates.every(
			(candidate) =>
				candidate.status === "skipped" &&
				candidate.reasons.includes("downloader_unavailable"),
		),
	).toBe(true);
	expect(f.logs.join("")).not.toContain("private transport error");
});

test("saving rejects an unavailable inherited profile before writing a subscription", async () => {
	const f = await fixture();
	f.state.profileId = "custom:missing";
	await expect(
		f.discovery.save({
			workKey: key,
			source: { kind: "feed" as const, url: "https://feeds.example.org/rss" },
			startEpisode: 1,
			revision: null,
			...f.stamp(),
		}),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	expect(f.discovery.get(key).subscription).toBeNull();
	expect(f.fetch).not.toHaveBeenCalled();
});
