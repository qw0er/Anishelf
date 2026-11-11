import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { SourcesApplication } from "../../../../src/modules/acquisition/sources/application/application.js";
import { SourceError } from "../../../../src/modules/acquisition/sources/domain/model.js";
import { JackettConnection } from "../../../../src/modules/acquisition/sources/jackett/connection.js";
import type { SourceInput } from "../../../../src/modules/acquisition/sources/public.js";
import { parseRss } from "../../../../src/modules/acquisition/sources/rss/parser.js";
import type { FeedTransport } from "../../../../src/modules/acquisition/sources/rss/ports.js";
import { rssUrl } from "../../../../src/modules/acquisition/sources/rss/transport.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.restoreAllMocks();
});
const logger = pino({ level: "silent" });
const hash = "a".repeat(40);
const magnet = `magnet:?xt=urn:btih:${hash}`;
const xml = (title = "Example - 03") =>
	`<rss version="2.0"><channel><item><title>${title}</title><guid>release</guid><enclosure type="application/x-bittorrent" url="${magnet}"/></item></channel></rss>`;
const searchEntry = {
	id: "release",
	observationId: "release",
	title: "Example - 03",
	publishedAt: null,
	hash,
	downloadUrl: null,
	download: { kind: "magnet" as const, uri: magnet },
};
const searchResult = () => ({
	entries: [searchEntry],
	coverage: { limited: false, reason: null, pages: 1, queries: 1 },
	outcome: "matches" as const,
});

async function fixture() {
	let now = 1000;
	const database = ApplicationDatabase.openMemory();
	cleanup.push(async () => database.close());
	const fetch = vi.fn<FeedTransport["fetch"]>().mockResolvedValue({
		xml: xml(),
		etag: "validator",
		lastModified: null,
	});
	const search = vi
		.spyOn(JackettConnection.prototype, "search")
		.mockResolvedValue(searchResult());
	const connection = new JackettConnection(
		{ read: async () => null, write: async () => {} },
		() => {
			throw new Error("Mocked searches should not construct a transport.");
		},
		logger,
	);
	await connection.initialize();
	const settings = await connection.save({
		generation: connection.settings().generation,
		url: "http://jackett:9117",
		apiKey: "private-key",
		origin: "external",
		indexers: ["example"],
	});
	const application = new SourcesApplication({
		store: database.acquisition,
		rss: {
			store: database.acquisition,
			transport: { fetch, close: async () => {} },
			parse: parseRss,
			normalizeUrl: rssUrl,
			logger,
		},
		jackett: connection,
		logger,
		now: () => now,
	});
	cleanup.push(() => application.close());
	const input = (kind: "feed" | "search"): SourceInput =>
		kind === "feed"
			? { kind, url: "https://example.org/rss?key=private-key" }
			: {
					kind,
					connectionRevision: settings.generation,
					providerId: "example",
					titles: ["Example"],
				};
	return {
		application,
		database,
		fetch,
		search,
		connection,
		settings,
		input,
		now: () => now,
		advance: (milliseconds: number) => {
			now += milliseconds;
		},
	};
}

test.each(["feed", "search"] as const)(
	"fresh %s evidence is reused while every caller can commit new candidate decisions",
	async (kind) => {
		const f = await fixture();
		const first = await f.application.fetch(f.input(kind));
		first.commit(() => {});
		f.advance(60_000);
		let currentPreference = "first";
		const decisions: string[] = [];
		const second = await f.application.fetch(f.input(kind));
		second.commit(() => decisions.push(currentPreference));
		currentPreference = "changed";
		const third = await f.application.fetch(first.snapshot.id);
		third.commit(() => decisions.push(currentPreference));
		expect(decisions).toEqual(["first", "changed"]);
		expect(second.snapshot.checkedAt).toBe(1000);
		expect(third.snapshot.revision).toBe(first.snapshot.revision);
		expect(f.fetch.mock.calls.length + f.search.mock.calls.length).toBe(1);
		f.advance(29 * 60_000);
		const expired = await f.application.fetch(first.snapshot.id);
		expect(expired.snapshot.checkedAt).toBe(f.now());
		expect(f.fetch.mock.calls.length + f.search.mock.calls.length).toBe(2);
	},
);

test.each(["feed", "search"] as const)(
	"empty %s evidence is shared for five minutes, then checked again",
	async (kind) => {
		const f = await fixture();
		if (kind === "feed")
			f.fetch.mockResolvedValue({
				xml: '<rss version="2.0"><channel><title>Empty feed</title></channel></rss>',
				etag: null,
				lastModified: null,
			});
		else
			f.search.mockResolvedValue({
				...searchResult(),
				entries: [],
				outcome: "no_match",
			});
		const first = await f.application.fetch(f.input(kind));
		first.commit(() => {});
		f.advance(5 * 60_000 - 1);
		expect((await f.application.fetch(f.input(kind))).snapshot.entries).toEqual(
			[],
		);
		expect(f.fetch.mock.calls.length + f.search.mock.calls.length).toBe(1);
		f.advance(1);
		await f.application.fetch(f.input(kind));
		expect(f.fetch.mock.calls.length + f.search.mock.calls.length).toBe(2);
	},
);

test.each(["feed", "search"] as const)(
	"concurrent %s consumers share collection and retain independent commit callbacks",
	async (kind) => {
		const f = await fixture();
		let finish!: () => void;
		const waiting = new Promise<void>((resolve) => {
			finish = resolve;
		});
		if (kind === "feed")
			f.fetch.mockImplementationOnce(async () => {
				await waiting;
				return { xml: xml(), etag: null, lastModified: null };
			});
		else
			f.search.mockImplementationOnce(async () => {
				await waiting;
				return searchResult();
			});
		const first = f.application.fetch(f.input(kind));
		const second = f.application.fetch(f.input(kind));
		finish();
		const [a, b] = await Promise.all([first, second]);
		expect(a.snapshot).toEqual(b.snapshot);
		const decisions: string[] = [];
		a.commit(() => decisions.push("first"));
		b.commit(() => decisions.push("second"));
		expect(decisions).toEqual(["first", "second"]);
		expect(f.fetch.mock.calls.length + f.search.mock.calls.length).toBe(1);
	},
);

test.each(["feed", "search"] as const)(
	"%s rate-limit cooldown rejects repeated manual collection without a network request",
	async (kind) => {
		const f = await fixture();
		const retryAt = f.now() + 10 * 60_000;
		if (kind === "feed")
			f.fetch.mockRejectedValueOnce(new SourceError("rate_limited", retryAt));
		else
			f.search.mockRejectedValueOnce(new SourceError("rate_limited", retryAt));
		await expect(f.application.fetch(f.input(kind))).rejects.toMatchObject({
			code: "rate_limited",
		});
		const failed = f.application.snapshot(f.input(kind));
		expect(failed).toMatchObject({
			error: "rate_limited",
			nextAttemptAt: retryAt,
		});
		f.advance(60_000);
		await expect(f.application.fetch(f.input(kind))).rejects.toMatchObject({
			code: "rate_limited",
			retryAt,
		});
		await expect(
			f.application.collect(f.application.referenceFor(f.input(kind))),
		).rejects.toMatchObject({ code: "rate_limited", retryAt });
		expect(f.application.snapshot(f.input(kind))).toEqual(failed);
		expect(f.fetch.mock.calls.length + f.search.mock.calls.length).toBe(1);
		f.advance(9 * 60_000);
		await f.application.fetch(f.input(kind));
		expect(f.fetch.mock.calls.length + f.search.mock.calls.length).toBe(2);
	},
);

test.each(["feed", "search"] as const)(
	"unpublished %s diagnostic evidence can be reused without authorizing content",
	async (kind) => {
		const f = await fixture();
		const prepared = await f.application.collect(
			f.application.referenceFor(f.input(kind)),
		);
		const reference = prepared.entries[0]?.download;
		if (!reference) throw new Error("Missing content reference.");
		expect(f.database.acquisition.sources()).toEqual([]);
		expect(f.application.isDownloadCurrent(reference)).toBe(false);
		await expect(
			f.application.readDownload(reference, new AbortController().signal),
		).rejects.toMatchObject({ code: "download_missing" });
		const publication = await f.application.fetch(f.input(kind));
		expect(publication.snapshot.revision).toBe(prepared.revision);
		expect(f.fetch.mock.calls.length + f.search.mock.calls.length).toBe(1);
		expect(f.application.isDownloadCurrent(reference)).toBe(false);
		publication.commit(() => {});
		expect(f.application.isDownloadCurrent(reference)).toBe(true);
	},
);

test("old business-accepted evidence is recollected before reuse", async () => {
	const f = await fixture();
	f.search.mockResolvedValueOnce({
		...searchResult(),
		coverage: { ...searchResult().coverage, limited: true, reason: "accepted" },
	});
	const partial = await f.application.fetch(f.input("search"));
	partial.commit(() => {});
	const full = await f.application.fetch(f.input("search"));
	expect(full.snapshot.coverage?.limited).toBe(false);
	expect(f.search).toHaveBeenCalledTimes(2);
	const reused = await f.application.fetch(f.input("search"));
	expect(reused.snapshot.revision).toBe(full.snapshot.revision);
	expect(f.search).toHaveBeenCalledTimes(2);
});

test("connection changes invalidate prepared evidence and already cached content references", async () => {
	const f = await fixture();
	const first = await f.application.fetch(f.input("search"));
	first.commit(() => {});
	const reference = first.snapshot.entries[0]?.download;
	if (!reference) throw new Error("Missing content reference.");
	await f.connection.clear(f.settings.generation);
	expect(f.application.isCurrent(first.snapshot)).toBe(false);
	expect(f.application.isDownloadCurrent(reference)).toBe(false);
	await expect(f.application.fetch(first.snapshot.id)).rejects.toMatchObject({
		code: "source_conflict",
	});
	expect(f.search).toHaveBeenCalledTimes(1);
});

test("a newer published revision wins over prepared evidence with the same timestamp", async () => {
	const f = await fixture();
	const first = await f.application.fetch(f.input("feed"));
	first.commit(() => {});
	const saved = f.database.acquisition.feed(first.snapshot.id);
	if (!saved) throw new Error("Missing feed record.");
	f.database.acquisition.saveFeed({
		...saved,
		revision: "newer-revision",
		entries: saved.entries.map((entry) => ({ ...entry, title: "Newer title" })),
	});
	const next = await f.application.fetch(first.snapshot.id);
	expect(next.snapshot.revision).toBe("newer-revision");
	expect(next.snapshot.entries[0]?.title).toBe("Newer title");
	next.commit(() => {});
	expect(f.application.snapshot(first.snapshot.id)?.revision).toBe(
		"newer-revision",
	);
	expect(f.fetch).toHaveBeenCalledTimes(1);
});

test("a source change during collection fences its eventual publication", async () => {
	const f = await fixture();
	let finish!: () => void;
	const waiting = new Promise<void>((resolve) => {
		finish = resolve;
	});
	f.fetch.mockImplementationOnce(async () => {
		await waiting;
		return { xml: xml(), etag: null, lastModified: null };
	});
	const pending = f.application.fetch(f.input("feed"));
	const id = f.application.snapshot(f.input("feed"))?.id;
	const saved = id ? f.database.acquisition.source(id) : null;
	if (!saved?.snapshot) throw new Error("Missing pending source.");
	f.database.acquisition.saveSource({
		...saved,
		snapshot: { ...saved.snapshot, revision: "changed-during-request" },
	});
	finish();
	const result = await pending;
	expect(f.application.isCurrent(result.snapshot)).toBe(false);
	expect(() => result.commit(() => {})).toThrow(
		expect.objectContaining({ code: "source_conflict" }),
	);
	expect(f.application.snapshot(f.input("feed"))?.revision).toBe(
		"changed-during-request",
	);
});

test("unpublished prepared evidence is bounded across distinct source definitions", async () => {
	const f = await fixture();
	for (let index = 0; index < 65; index++)
		await f.application.collect(
			f.application.referenceFor({
				kind: "feed",
				url: `https://example.org/rss/${index}`,
			}),
		);
	expect(f.fetch).toHaveBeenCalledTimes(65);
	expect(f.database.acquisition.sources()).toEqual([]);
	await f.application.collect(
		f.application.referenceFor({
			kind: "feed",
			url: "https://example.org/rss/64",
		}),
	);
	expect(f.fetch).toHaveBeenCalledTimes(65);
	await f.application.collect(
		f.application.referenceFor({
			kind: "feed",
			url: "https://example.org/rss/0",
		}),
	);
	expect(f.fetch).toHaveBeenCalledTimes(66);
});

test("concurrent consumers share the same merged collection", async () => {
	const f = await fixture();
	let finish!: () => void;
	const waiting = new Promise<void>((resolve) => {
		finish = resolve;
	});
	f.search.mockImplementationOnce(async () => {
		await waiting;
		return searchResult();
	});
	const discovery = f.application.fetch(f.input("search"));
	const full = f.application.fetch(f.input("search"));
	finish();
	const [first, second] = await Promise.all([discovery, full]);
	expect(second.snapshot).toBe(first.snapshot);
	expect(first.snapshot.entries).toHaveLength(1);
	expect(f.search).toHaveBeenCalledTimes(1);
});
