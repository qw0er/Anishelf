import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toTorrentFile } from "parse-torrent";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { resolveTorrent } from "../../../../src/modules/acquisition/downloads/infrastructure/torrent.js";
import { SourcesApplication } from "../../../../src/modules/acquisition/sources/application/application.js";
import { SourceError } from "../../../../src/modules/acquisition/sources/domain/model.js";
import { JackettConnection } from "../../../../src/modules/acquisition/sources/jackett/connection.js";
import type { JackettConfiguration } from "../../../../src/modules/acquisition/sources/jackett/model.js";

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
	const reference = first.sources.referenceFor({
		kind: "search",
		connectionRevision: settings.generation,
		providerId: "nyaasi",
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
	expect(f.sources.snapshot(newer.id)).toEqual(newer);
	expect(() => f.sources.publish({ ...newer })).toThrow();
});

test("generation changes fence saved bindings and in-flight evidence without inheriting new credentials", async () => {
	const f = await fixture();
	vi.useFakeTimers();
	f.sources.bind(f.reference);
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

test.each(["rss", "jackett"] as const)(
	"%s collects only caller-owned subscriptions, persists first failures and resumes after reopen",
	async (kind) => {
		const f = await fixture();
		vi.useFakeTimers();
		const reference =
			kind === "rss"
				? f.sources.referenceFor({
						kind: "feed",
						url: "https://example.org/feed",
					})
				: f.reference;
		f.sources.bind(reference);
		expect(f.sources.snapshot(reference.id)).toMatchObject({
			checkedAt: null,
			entries: [],
		});
		const active = new Set<string>();
		const start = (sources: typeof f.sources) =>
			sources.start(
				() => [...active],
				async (previous) => {
					try {
						const publication = await sources.fetch(previous.id);
						if (active.has(previous.id)) publication.commit(() => {});
					} catch {
						/* Sources records failures itself. */
					}
				},
			);
		start(f.sources);
		await vi.advanceTimersByTimeAsync(0);
		expect(f.fetch).not.toHaveBeenCalled();
		expect(f.search).not.toHaveBeenCalled();
		if (kind === "rss")
			f.fetch.mockRejectedValueOnce(new SourceError("upstream_failure"));
		else f.search.mockRejectedValueOnce(new SourceError("upstream_failure"));
		active.add(reference.id);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(f.sources.snapshot(reference.id)).toMatchObject({
			checkedAt: null,
			error: "upstream_failure",
			nextAttemptAt: 121_000,
		});
		// The fixture shares a fake connection between source instances; retain it across this reopen.
		vi.spyOn(f.connection, "close").mockResolvedValueOnce();
		await f.sources.close();
		const reopened = f.opened();
		expect(reopened.sources.snapshot(reference.id)?.error).toBe(
			"upstream_failure",
		);
		f.setClock(121_000);
		start(reopened.sources);
		await vi.advanceTimersByTimeAsync(0);
		const saved = reopened.sources.snapshot(reference.id);
		expect(saved?.error).toBeNull();
		expect(saved?.entries).toHaveLength(1);
		active.clear();
		f.setClock(500_000);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(reopened.sources.snapshot(reference.id)).toEqual(saved);
		const download = saved?.entries[0]?.download;
		if (!download) throw new Error();
		expect(
			await reopened.sources.readDownload(
				download,
				new AbortController().signal,
			),
		).toMatchObject({ kind: "magnet" });
		expect(f.database.acquisition.subscriptions()).toEqual([]);
	},
);

test.each(["rss", "jackett"] as const)(
	"%s preview cannot resolve downloads until publication; accepted references survive later snapshots and reopen",
	async (kind) => {
		const f = await fixture();
		const reference =
			kind === "rss"
				? f.sources.referenceFor({
						kind: "feed",
						url: "https://example.org/feed",
					})
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
	// Binding/evidence retention is independent of subscription ownership.
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
				? f.sources.referenceFor({
						kind: "feed",
						url: "https://example.org/feed",
					})
				: f.reference;
		f.sources.bind(reference);
		const prepared = await f.sources.refresh(reference);
		f.setClock(61001);
		let reject!: (reason: Error) => void;
		const pending = new Promise<never>((_done, fail) => {
			reject = fail;
		});
		if (kind === "rss") f.fetch.mockImplementationOnce(() => pending);
		else f.search.mockImplementationOnce(() => pending);
		f.sources.start(
			() => [reference.id],
			async (previous) => {
				try {
					const publication = await f.sources.fetch(previous.id);
					publication.commit(() => {});
				} catch {
					/* The stale failure must remain ignored by Sources. */
				}
			},
		);
		f.sources.publish(prepared);
		reject(new SourceError("upstream_failure"));
		await vi.advanceTimersByTimeAsync(0);
		expect(f.sources.snapshot(reference.id)).toEqual(prepared);
		expect(f.database.acquisition.source(reference.id)?.failures).toBe(0);
	},
);
