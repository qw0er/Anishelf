import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import type { Session, WebContents } from "electron";
import { afterEach, expect, test, vi } from "vitest";
import { DesktopOfflineCache } from "../src/main/offline-cache/cache.js";
import { OfflineCacheStore } from "../src/main/offline-cache/store.js";

const { netFetch, statfs } = vi.hoisted(() => ({
	netFetch: vi.fn(),
	statfs: vi.fn(),
}));
vi.mock("electron", () => ({ net: { fetch: netFetch } }));
vi.mock("node:fs/promises", async (original) => ({
	...(await original<typeof import("node:fs/promises")>()),
	statfs,
}));

const video = "fixture-video";
const origin = "https://example.test";
const names = new Map([
	["first", "一.mkv"],
	["second", "二.mkv"],
]);
const sender = { isDestroyed: () => false } as WebContents;
const directories: string[] = [];
const caches: DesktopOfflineCache[] = [];

function serverFixture() {
	let version = "version-1";
	netFetch.mockImplementation(async (href, init) => {
		const url = new URL(href);
		expect(new Headers(init.headers).get("authorization")).toBe(
			"Bearer device",
		);
		expect(init.redirect).toBe("error");
		const id = url.pathname.split("/")[3] ?? "";
		if (url.pathname.endsWith("/subtitles"))
			return Response.json({
				sourceVersion: version,
				tracks: [
					{
						id: "subtitle",
						origin: "external",
						supported: true,
						format: "srt",
						sourceVersion: "sub-version",
						name: "English",
						language: "eng",
					},
				],
			});
		if (url.pathname.includes("/subtitles/"))
			return new Response("subtitle content");
		if (url.pathname.endsWith("/access-link"))
			return Response.json({ url: `/api/media/${id}?access_token=${id}` });
		if (url.pathname.startsWith("/api/catalog/"))
			return Response.json({
				sourceVersion: version,
				associations: [
					{
						workId: "work",
						workTitle: "Work",
						number: "1",
						label: "Episode 1",
					},
				],
			});
		return Response.json({
			file: {
				id,
				name: names.get(id),
				sizeBytes: video.length,
				sourceVersion: version,
				mimeType: "video/x-matroska",
			},
			originalMediaUrl: `/api/media/${id}`,
		});
	});
	return {
		replaceSource: () => {
			version = "version-2";
		},
	};
}

class DownloadSession extends EventEmitter {
	downloads: string[] = [];
	finish?: () => Promise<void>;

	downloadURL(url: string) {
		this.downloads.push(url);
		let path = "";
		const item = Object.assign(new EventEmitter(), {
			getURLChain: () => [url],
			getSavePath: () => path,
			getPercentComplete: () => 42,
			setSavePath: (value: string) => {
				path = value;
			},
			cancel: () => {
				item.emit("done", {}, "cancelled");
			},
		});
		this.finish = async () => {
			await writeFile(path, video);
			item.emit("done", {}, "completed");
		};
		this.emit("will-download", { preventDefault: () => {} }, item, null);
	}
}

async function setup(
	options: { directory?: string; downloads?: DownloadSession } = {},
) {
	const directory =
		options.directory ??
		(await mkdtemp(join(tmpdir(), "anishelf-cache-test-")));
	if (!options.directory) directories.push(directory);
	const downloads = options.downloads ?? new DownloadSession();
	const db = new OfflineCacheStore(join(directory, "test.sqlite"));
	let server = origin;
	const publish = vi.fn();
	const cache = new DesktopOfflineCache(
		directory,
		db,
		downloads as unknown as Session,
		() => ({
			key: server,
			origin: server,
			authorization: () => "Bearer device",
		}),
		publish,
	);
	caches.push(cache);
	await cache.initialize();
	return {
		cache,
		directory,
		downloads,
		publish,
		switchServer: () => {
			server = "https://other.test";
		},
	};
}

async function waitFor(
	cache: DesktopOfflineCache,
	fileId: string,
	status: string,
) {
	return vi.waitFor(async () => {
		const entry = (await cache.list()).find((item) => item.fileId === fileId);
		if (entry?.status !== status)
			throw new Error(`Expected ${status}, got ${entry?.status}`);
		return entry;
	});
}

afterEach(async () => {
	for (const cache of caches.splice(0)) cache.dispose();
	for (const directory of directories.splice(0))
		await rm(directory, { force: true, recursive: true });
	netFetch.mockReset();
	statfs.mockReset();
});

test("queues and deduplicates transfers, cancels one and saves a playable copy across restarts", async () => {
	statfs.mockResolvedValue({ bavail: 1024n, bsize: 1024n });
	serverFixture();
	const { cache, directory, downloads } = await setup();
	cache.start({ fileId: "first", sourceVersion: "version-1" });
	cache.start({ fileId: "first", sourceVersion: "version-1" });
	cache.start({ fileId: "second", sourceVersion: "version-1" });
	const first = await waitFor(cache, "first", "downloading");
	expect(first.percent).toBe(42);
	await waitFor(cache, "second", "queued");
	await cache.cancel(first.id);
	expect((await cache.list()).some((entry) => entry.id === first.id)).toBe(
		false,
	);
	await waitFor(cache, "second", "downloading");
	expect(downloads.downloads).toHaveLength(2);
	await downloads.finish?.();
	const ready = await waitFor(cache, "second", "ready");
	expect(ready.episodes[0]?.label).toBe("Episode 1");
	expect(await cache.list()).toHaveLength(1);

	const playback = await cache.open(sender, ready.id);
	if (!playback) throw new Error("Cache did not open");
	expect(playback.format).toBe("mkv");
	await expect(cache.remove(ready.id)).rejects.toThrow(/in use/);
	const media = await fetch(playback.url, {
		headers: { range: "bytes=1-3", origin: desktopOrigin },
	});
	expect(media.status).toBe(206);
	expect(media.headers.get("content-range")).toBe(`bytes 1-3/${video.length}`);
	expect(await media.text()).toBe(video.slice(1, 4));
	const head = await fetch(playback.url, { method: "HEAD" });
	expect(head.headers.get("content-length")).toBe(String(video.length));
	const [subtitle] = playback.subtitles;
	if (!subtitle) throw new Error("Cached subtitle is missing");
	expect(await (await fetch(subtitle.url)).text()).toBe("subtitle content");
	cache.position(sender, playback.lease, 1234);
	cache.close(sender, playback.lease);
	expect((await fetch(playback.url)).status).toBe(404);
	const index = caches.indexOf(cache);
	caches.splice(index, 1);
	cache.dispose();

	const restarted = await setup({ directory });
	restarted.switchServer();
	const resumed = await restarted.cache.open(sender, ready.id);
	expect(resumed?.positionMs).toBe(1234);
	if (resumed) restarted.cache.close(sender, resumed.lease);
	await writeFile(join(directory, "media", ready.id, "video.mkv"), "corrupt");
	expect((await restarted.cache.list())[0]?.status).toBe("unavailable");
	await restarted.cache.remove(ready.id);
	expect(await restarted.cache.list()).toEqual([]);
});

test("keeps disk failures retryable and refuses to publish a replaced source", async () => {
	statfs.mockResolvedValue({ bavail: 0n, bsize: 1024n });
	const { replaceSource } = serverFixture();
	const { cache, downloads } = await setup();
	cache.start({ fileId: "first" });
	const failure = await waitFor(cache, "first", "failed");
	expect(failure.failure).toBe("space");
	statfs.mockResolvedValue({ bavail: 1024n, bsize: 1024n });
	await cache.retry(failure.id);
	await waitFor(cache, "first", "downloading");
	replaceSource();
	await downloads.finish?.();
	expect((await waitFor(cache, "first", "failed")).failure).toBe(
		"sourceChanged",
	);
});

test("recovers interrupted entries and discards unpublished media on startup", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-cache-recovery-"));
	directories.push(directory);
	const id = "9cb14031-711d-4620-a6fd-8b0323221575";
	const db = new OfflineCacheStore(join(directory, "test.sqlite"));
	db.save({
		entry: {
			id,
			server: origin,
			status: "finalizing",
			fileId: "first",
			sourceVersion: "version-1",
			name: "一.mkv",
			percent: 100,
			sizeBytes: 0,
			episodes: [],
			failure: null,
		},
		positionMs: 0,
	});
	db.close();
	for (const subdirectory of ["staging", "media"]) {
		await mkdir(join(directory, subdirectory, id), { recursive: true });
		await writeFile(join(directory, subdirectory, id, "video.mkv.part"), video);
	}
	const { cache } = await setup({ directory });
	expect((await waitFor(cache, "first", "failed")).failure).toBe("interrupted");
	for (const subdirectory of ["staging", "media"])
		await expect(rm(join(directory, subdirectory, id))).rejects.toMatchObject({
			code: "ENOENT",
		});
});
