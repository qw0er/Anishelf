import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toTorrentFile } from "parse-torrent";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { resolveTorrent } from "../src/modules/acquisition/downloads/infrastructure/torrent.js";
import { SourcesApplication } from "../src/modules/acquisition/sources/application/application.js";
import { SourceError } from "../src/modules/acquisition/sources/domain/model.js";
import { JackettConnection } from "../src/modules/acquisition/sources/jackett/connection.js";
import type { JackettConfiguration } from "../src/modules/acquisition/sources/jackett/model.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.useRealTimers();
});
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-source-lifecycle-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const logger = pino({ level: "silent" });
	let configuration: JackettConfiguration | null = null;
	const connection = new JackettConnection(
		{
			read: async () => configuration,
			write: async (value) => {
				configuration = value;
			},
		},
		() => {
			throw new Error("Unexpected live request");
		},
		logger,
	);
	await connection.initialize();
	const settings = await connection.save({
		generation: connection.settings().generation,
		url: "http://jackett:9117",
		apiKey: "private-key",
		origin: "external",
		indexers: ["nyaasi"],
	});
	cleanup.push(() => connection.close());
	const result = {
		entries: [
			{
				id: "release",
				observationId: "observation",
				title: "Frieren - 03",
				publishedAt: 1000,
				downloadUrl: null,
				hash: "a".repeat(40),
				download: {
					kind: "jackett-torrent" as const,
					generation: settings.generation,
					indexerId: "nyaasi",
					path: "/api/v2.0/indexers/nyaasi/results/torznab/api",
					file: "opaque-file",
				},
			},
		],
		coverage: {
			limited: true,
			reason: "missing_pagination" as const,
			pages: 1,
			queries: 1,
		},
		outcome: "matches" as const,
	};
	const readTorrent = vi.spyOn(connection, "readTorrent").mockResolvedValue({
		kind: "magnet",
		uri: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
	});
	const search = vi
		.spyOn(connection, "search")
		.mockImplementation(async () => structuredClone(result));
	let clock = 1000;
	const opened = () => {
		const database = ApplicationDatabase.open(directory);
		cleanup.push(() => database.close());
		const fetch = vi.fn(async () => ({
			xml: "feed",
			etag: "validator",
			lastModified: null,
		}));
		const torrentRead = vi.fn(async () => new Uint8Array([1, 2, 3]));
		const sources = new SourcesApplication({
			torrentTransport: { read: torrentRead, close: async () => {} },
			store: database.acquisition,
			rss: {
				store: database.acquisition,
				transport: { fetch, close: async () => {} },
				parse: () => [
					{
						id: "rss-release",
						observationId: "rss-observation",
						title: "Frieren - 03",
						publishedAt: 1000,
						hash: "a".repeat(40),
						downloadUrl: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
					},
				],
				normalizeUrl: (url) => url,
				logger,
			},
			jackett: connection,
			logger,
			now: () => clock,
			refreshIntervalMinutes: () => 1,
		});
		cleanup.push(() => sources.close());
		return { database, sources, fetch, torrentRead };
	};
	const first = opened();
	const reference = first.sources.jackettReference({
		generation: settings.generation,
		indexerId: "nyaasi",
		titles: ["Frieren", "Sousou no Frieren"],
	});
	return {
		...first,
		opened,
		reference,
		connection,
		search,
		readTorrent,
		result,
		setClock: (value: number) => {
			clock = value;
		},
	};
}

test("query evidence, descriptors and coverage survive SQLite reopen; previews stay temporary", async () => {
	const f = await fixture();
	const preview = await f.sources.refresh(f.reference);
	expect(f.database.acquisition.sources()).toEqual([]);
	expect(f.sources.snapshot(f.reference.id)).toBeNull();
	f.sources.publish(preview);
	expect(f.database.acquisition.source(preview.id)?.enabled).toBe(false);
	const reopened = f.opened();
	expect(reopened.sources.snapshot(preview.id)).toEqual(preview);
	expect(
		Object.isFrozen(reopened.sources.snapshot(preview.id)?.entries[0]),
	).toBe(true);
	expect(
		typeof reopened.sources.snapshot(preview.id)?.entries[0]?.download,
	).toBe("string");
	expect(reopened.sources.reference(preview.id)).toEqual(f.reference);
	expect(f.search).toHaveBeenCalledTimes(1);
	const refreshed = await reopened.sources.refresh(
		reopened.sources.reference(preview.id),
	);
	expect(f.search).toHaveBeenCalledTimes(2);
	reopened.sources.publish(refreshed);
	expect(reopened.sources.snapshot(preview.id)?.revision).toBe(
		refreshed.revision,
	);
	expect(f.database.acquisition.subscriptions()).toEqual([]);
});

test("coalesced requests share one revision; older same-query results and delayed failures cannot overwrite newer evidence", async () => {
	const f = await fixture();
	const [one, same] = await Promise.all([
		f.sources.refresh(f.reference),
		f.sources.refresh(f.reference),
	]);
	expect(f.search).toHaveBeenCalledTimes(1);
	const newer = await f.sources.refresh(f.reference);
	f.sources.publish(newer);
	expect(f.sources.isCurrent(one)).toBe(false);
	expect(() => f.sources.publish(same)).toThrow();
	f.sources.failed(one, "late_failure");
	expect(f.sources.snapshot(newer.id)).toEqual(newer);
	expect(() => f.sources.publish({ ...newer })).toThrow();
});

test("managed query refreshes when due and after restart, backs off with prior evidence, and respects disable/removal", async () => {
	const f = await fixture();
	vi.useFakeTimers();
	f.sources.register(f.reference);
	const consumer = vi.fn(async () => {});
	f.sources.start(() => [], consumer);
	await vi.advanceTimersByTimeAsync(0);
	expect(f.search).toHaveBeenCalledTimes(1);
	const saved = f.sources.snapshot(f.reference.id);
	f.search.mockRejectedValueOnce(new SourceError("rate_limited", 500_000));
	f.setClock(61_000);
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.sources.snapshot(f.reference.id)).toMatchObject({
		entries: saved?.entries,
		checkedAt: saved?.checkedAt,
		error: "rate_limited",
	});
	expect(
		f.sources.snapshot(f.reference.id)?.nextAttemptAt,
	).toBeGreaterThanOrEqual(500_000);
	const reopened = f.opened();
	reopened.sources.start(() => [], consumer);
	await vi.advanceTimersByTimeAsync(0);
	expect(f.search).toHaveBeenCalledTimes(2);
	f.sources.setEnabled(f.reference.id, false);
	f.setClock(600_000);
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.search).toHaveBeenCalledTimes(2);
	reopened.sources.setEnabled(f.reference.id, true);
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.search).toHaveBeenCalledTimes(3);
	reopened.sources.remove(f.reference.id);
	await vi.advanceTimersByTimeAsync(60_000);
	expect(f.search).toHaveBeenCalledTimes(3);
	expect(reopened.sources.snapshot(f.reference.id)?.entries).toEqual(
		saved?.entries,
	);
	expect(consumer).not.toHaveBeenCalled();
});

test("first refresh failure is durable and retries without a previous successful snapshot", async () => {
	const f = await fixture();
	vi.useFakeTimers();
	f.search.mockRejectedValueOnce(new SourceError("upstream_failure"));
	f.sources.register(f.reference);
	f.sources.start(
		() => [],
		async () => {},
	);
	await vi.advanceTimersByTimeAsync(0);
	expect(f.sources.snapshot(f.reference.id)).toMatchObject({
		checkedAt: null,
		entries: [],
		error: "upstream_failure",
		nextAttemptAt: 121_000,
	});
	const reopened = f.opened();
	expect(reopened.sources.snapshot(f.reference.id)).toEqual(
		f.sources.snapshot(f.reference.id),
	);
	f.setClock(121_000);
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.sources.snapshot(f.reference.id)?.error).toBeNull();
});

test("generation changes fence saved bindings and in-flight evidence without inheriting new credentials", async () => {
	const f = await fixture();
	vi.useFakeTimers();
	f.sources.register(f.reference);
	const prepared = await f.sources.refresh(f.reference);
	f.sources.publish(prepared);
	await f.connection.clear(f.connection.settings().generation);
	expect(f.sources.isCurrent(prepared)).toBe(false);
	expect(() => f.sources.publish(prepared)).toThrow();
	expect(() => f.sources.reference(prepared.id)).toThrow();
	f.sources.start(
		() => [],
		async () => {},
	);
	f.setClock(600_000);
	await vi.advanceTimersByTimeAsync(30_000);
	expect(f.search).toHaveBeenCalledTimes(1);
	expect(f.sources.snapshot(prepared.id)).toEqual(prepared);
});

test("removing a source invalidates pending publication; disabling prevents background publication", async () => {
	const f = await fixture();
	vi.useFakeTimers();
	let resolve!: (value: typeof f.result) => void;
	f.search.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	f.sources.register(f.reference);
	const pending = f.sources.refresh(f.reference);
	f.sources.remove(f.reference.id);
	resolve(f.result);
	const result = await pending;
	expect(() => f.sources.publish(result)).toThrow();
	expect(f.sources.snapshot(result.id)).toBeNull();
	f.sources.register(f.reference);
	f.search.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	f.sources.start(
		() => [],
		async () => {},
	);
	f.sources.setEnabled(f.reference.id, false);
	resolve(f.result);
	await vi.advanceTimersByTimeAsync(0);
	expect(f.sources.snapshot(f.reference.id)).toBeNull();
});

test("published RSS can use the same managed scheduler without subscribing or authorizing downloads", async () => {
	const f = await fixture();
	vi.useFakeTimers();
	const reference = f.sources.rssReference("https://example.org/feed");
	f.sources.publish(await f.sources.refresh(reference));
	f.sources.register(reference);
	f.setClock(61_000);
	f.sources.start(
		() => [],
		async () => {},
	);
	await vi.advanceTimersByTimeAsync(0);
	expect(f.fetch).toHaveBeenCalledTimes(2);
	expect(f.sources.snapshot(reference.id)?.checkedAt).toBe(61_000);
	expect(f.database.acquisition.subscriptions()).toEqual([]);
	f.sources.remove(reference.id);
	expect(f.sources.snapshot(reference.id)).not.toBeNull();
});

test.each(["rss", "jackett"] as const)(
	"%s supports registration before evidence, durable initial failure, recovery and evidence-preserving removal",
	async (kind) => {
		const f = await fixture();
		vi.useFakeTimers();
		const reference =
			kind === "rss"
				? f.sources.rssReference("https://example.org/feed")
				: f.reference;
		if (kind === "rss")
			f.fetch.mockRejectedValueOnce(new SourceError("upstream_failure"));
		else f.search.mockRejectedValueOnce(new SourceError("upstream_failure"));
		f.sources.register(reference);
		expect(f.sources.snapshot(reference.id)).toBeNull();
		f.sources.start(
			() => [],
			async () => {},
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(f.sources.snapshot(reference.id)).toMatchObject({
			checkedAt: null,
			error: "upstream_failure",
			nextAttemptAt: 121_000,
		});
		const reopened = f.opened();
		expect(reopened.sources.reference(reference.id)).toEqual(reference);
		expect(reopened.sources.snapshot(reference.id)?.error).toBe(
			"upstream_failure",
		);
		f.setClock(121_000);
		await vi.advanceTimersByTimeAsync(30_000);
		const saved = f.sources.snapshot(reference.id);
		expect(saved?.error).toBeNull();
		expect(saved?.entries).toHaveLength(1);
		const download = saved?.entries[0]?.download;
		expect(typeof download).toBe("string");
		expect(JSON.stringify(saved)).not.toMatch(
			/downloadUrl|jackett-torrent|magnet:|opaque-file|private-key|indexerId|generation/,
		);
		f.sources.remove(reference.id);
		expect(f.database.acquisition.source(reference.id)?.enabled).toBe(false);
		expect(f.sources.snapshot(reference.id)).toEqual(saved);
		if (!download) throw new Error("Missing reference");
		expect(
			await f.sources.readDownload(download, new AbortController().signal),
		).toMatchObject({ kind: "magnet" });
		f.setClock(500_000);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f.sources.snapshot(reference.id)).toEqual(saved);
	},
);

test.each(["rss", "jackett"] as const)(
	"%s preview cannot resolve downloads until publication; accepted references survive later snapshots and reopen",
	async (kind) => {
		const f = await fixture();
		const reference =
			kind === "rss"
				? f.sources.rssReference("https://example.org/feed")
				: f.reference;
		const prepared = await f.sources.refresh(reference);
		const download = prepared.entries[0]?.download;
		if (!download) throw new Error("Missing reference");
		await expect(
			f.sources.readDownload(download, new AbortController().signal),
		).rejects.toMatchObject({ code: "download_missing" });
		f.sources.publish(prepared);
		if (kind === "jackett") {
			f.search.mockResolvedValueOnce({
				...f.result,
				entries: [],
				outcome: "no_match",
			});
			f.sources.publish(await f.sources.refresh(reference));
		}
		const reopened = f.opened();
		expect(reopened.sources.isDownloadCurrent(download)).toBe(true);
		expect(
			await reopened.sources.readDownload(
				download,
				new AbortController().signal,
			),
		).toMatchObject({ kind: "magnet" });
		await expect(
			reopened.sources.readDownload(
				"https://example.org/arbitrary.torrent",
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: "download_missing" });
		expect(f.torrentRead).not.toHaveBeenCalled();
	},
);

test("a connection change during locator resolution invalidates its content", async () => {
	const f = await fixture();
	const prepared = await f.sources.refresh(f.reference);
	f.sources.publish(prepared);
	const download = prepared.entries[0]?.download;
	if (!download) throw new Error("Missing reference");
	let resolve!: (value: { kind: "magnet"; uri: string }) => void;
	f.readTorrent.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const pending = f.sources.readDownload(
		download,
		new AbortController().signal,
	);
	await f.connection.clear(f.connection.settings().generation);
	resolve({ kind: "magnet", uri: `magnet:?xt=urn:btih:${"a".repeat(40)}` });
	await expect(pending).rejects.toMatchObject({ code: "source_conflict" });
	expect(f.sources.isDownloadCurrent(download)).toBe(false);
});

test("query evidence can back a persisted subscription without an RSS row", async () => {
	const f = await fixture();
	const prepared = await f.sources.refresh(f.reference);
	f.sources.publish(prepared);
	f.database.acquisition.saveSubscription(
		{
			workKey: "anilist:anime:1",
			feedId: prepared.id,
			startEpisode: 1,
			enabled: true,
			revision: "subscription",
		},
		[],
	);
	expect(f.database.acquisition.feed(prepared.id)).toBeNull();
	expect(f.database.acquisition.subscription("anilist:anime:1")?.feedId).toBe(
		prepared.id,
	);
	f.sources.remove(prepared.id);
	expect(f.database.acquisition.subscription("anilist:anime:1")?.enabled).toBe(
		true,
	);
	expect(f.sources.snapshot(prepared.id)).toEqual(prepared);
});

test("authenticated torrent content enters the same canonical hash and path validation pipeline", async () => {
	const f = await fixture();
	const bytes = new Uint8Array(
		toTorrentFile({
			infoHash: "",
			announce: [],
			urlList: [],
			info: {
				name: Buffer.from("Frieren - 03.mkv"),
				length: 100,
				"piece length": 16384,
				pieces: Buffer.alloc(20),
			},
		}),
	);
	const rawEntry = f.result.entries[0];
	if (!rawEntry) throw new Error("Missing adapter evidence");
	f.search.mockResolvedValueOnce({
		...f.result,
		entries: [{ ...rawEntry, hash: null }],
	});
	const prepared = await f.sources.refresh(f.reference);
	f.sources.publish(prepared);
	f.readTorrent.mockResolvedValue({ kind: "bytes", bytes });
	const reader = {
		read: (reference: string, signal: AbortSignal) =>
			f.sources.readDownload(reference, signal),
		isCurrent: (reference: string) => f.sources.isDownloadCurrent(reference),
		close: async () => {},
	};
	const entry = prepared.entries[0];
	if (!entry) throw new Error("Missing evidence");
	const resolved = await resolveTorrent(
		entry,
		reader,
		new AbortController().signal,
	);
	expect(resolved.hash).toMatch(/^[a-f0-9]{40}$/);
	expect(resolved.source).toEqual({ torrent: bytes });
	await expect(
		resolveTorrent(
			{ ...entry, hash: "b".repeat(40) },
			reader,
			new AbortController().signal,
		),
	).rejects.toMatchObject({ code: "torrent_identity_conflict" });
});

test("shutdown aborts and drains source download reads", async () => {
	const f = await fixture();
	const prepared = await f.sources.refresh(f.reference);
	f.sources.publish(prepared);
	const download = prepared.entries[0]?.download;
	if (!download) throw new Error("Missing reference");
	let release!: (value: { kind: "magnet"; uri: string }) => void;
	let requestSignal: AbortSignal | undefined;
	f.readTorrent.mockImplementationOnce((_generation, _descriptor, signal) => {
		requestSignal = signal;
		return new Promise((done) => {
			release = done;
		});
	});
	const reading = f.sources.readDownload(
		download,
		new AbortController().signal,
	);
	const rejected = expect(reading).rejects.toThrow();
	let closed = false;
	const closing = f.sources.close().then(() => {
		closed = true;
	});
	await Promise.resolve();
	expect(requestSignal?.aborted).toBe(true);
	expect(closed).toBe(false);
	release({ kind: "magnet", uri: `magnet:?xt=urn:btih:${"a".repeat(40)}` });
	await closing;
	await rejected;
	expect(closed).toBe(true);
});

test.each(["rss", "jackett"] as const)(
	"%s delayed initial failure cannot replace concurrently published evidence",
	async (kind) => {
		const f = await fixture();
		vi.useFakeTimers();
		const reference =
			kind === "rss"
				? f.sources.rssReference("https://example.org/feed")
				: f.reference;
		const prepared = await f.sources.refresh(reference);
		f.sources.register(reference);
		let reject!: (reason: Error) => void;
		const pending = new Promise<never>((_done, fail) => {
			reject = fail;
		});
		if (kind === "rss") f.fetch.mockImplementationOnce(() => pending);
		else f.search.mockImplementationOnce(() => pending);
		f.sources.start(
			() => [],
			async () => {},
		);
		f.sources.publish(prepared);
		reject(new SourceError("upstream_failure"));
		await vi.advanceTimersByTimeAsync(0);
		expect(f.sources.snapshot(reference.id)).toEqual(prepared);
		expect(f.database.acquisition.source(reference.id)?.failures).toBe(0);
	},
);
