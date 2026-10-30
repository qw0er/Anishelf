import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { SourcesApplication } from "../../../../src/modules/acquisition/sources/application/application.js";
import type {
	FeedRecord,
	SourceStore,
} from "../../../../src/modules/acquisition/sources/persistence.js";
import type { FeedTransport } from "../../../../src/modules/acquisition/sources/rss/ports.js";
import { rssUrl } from "../../../../src/modules/acquisition/sources/rss/transport.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
const url = "https://feeds.example.org/private/rss?key=private-key";
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function fixture() {
	const records = new Map<string, FeedRecord>();
	const store: SourceStore = {
		feed: (id) => structuredClone(records.get(id) ?? null),
		saveFeed: (feed) => {
			records.set(feed.id, structuredClone(feed));
		},
	};
	const fetch = vi.fn<FeedTransport["fetch"]>(async () => ({
		xml: "private XML",
		etag: "private-etag",
		lastModified: "private-validator",
	}));
	const transport = { fetch, close: vi.fn(async () => {}) };
	const logs: string[] = [];
	const database = ApplicationDatabase.openMemory();
	cleanup.push(async () => database.close());
	const sources = new SourcesApplication({
		store: database.acquisition,
		rss: {
			store,
			transport,
			normalizeUrl: rssUrl,
			parse: () => [
				{
					id: "release",
					observationId: "observation",
					title: "Frieren - 03",
					publishedAt: null,
					downloadUrl:
						"magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					hash: "a".repeat(40),
				},
			],
			logger: pino({ level: "debug" }, { write: (line) => logs.push(line) }),
		},
		logger: pino({ level: "debug" }, { write: (line) => logs.push(line) }),
		now: () => 1000,
	});
	cleanup.push(() => sources.close());
	return { sources, store, records, transport, logs };
}

test("prepared evidence stays isolated and immutable while protocol state remains private", async () => {
	const { sources, records, transport, logs } = fixture();
	const prepared = await sources.refresh(
		sources.referenceFor({ kind: "feed", url: url }),
	);
	expect(records.size).toBe(0);
	expect(sources.snapshot(prepared.id)).toBeNull();
	expect(prepared).toMatchObject({
		label: "https://feeds.example.org",
		entries: [{ title: "Frieren - 03" }],
	});
	expect(Object.isFrozen(prepared)).toBe(true);
	expect(Object.isFrozen(prepared.entries)).toBe(true);
	expect(Object.isFrozen(prepared.entries[0])).toBe(true);
	for (const secret of [
		"private/rss",
		"private-key",
		"private-etag",
		"private-validator",
		"private XML",
	])
		expect(JSON.stringify(prepared) + logs.join("")).not.toContain(secret);
	// Copies and saved projections cannot manufacture a publishable result.
	expect(() => sources.publish({ ...prepared })).toThrow();
	sources.publish(prepared);
	const saved = sources.snapshot(prepared.id);
	expect(saved).toEqual(prepared);
	expect(saved && sources.isCurrent(saved)).toBe(false);
	expect(transport.fetch).toHaveBeenCalledTimes(1);
	expect(records.get(prepared.id)).toMatchObject({
		etag: "private-etag",
		lastModified: "private-validator",
	});

	transport.fetch.mockResolvedValueOnce({
		xml: null,
		etag: "private-etag",
		lastModified: "private-validator",
	});
	const unchanged = await sources.refresh(sources.reference(prepared.id));
	expect(transport.fetch.mock.calls[1]?.[1]).toMatchObject({
		etag: "private-etag",
		lastModified: "private-validator",
	});
	expect(unchanged.entries).toEqual(prepared.entries);
	sources.publish(unchanged);
});

test("coalesced reads share evidence and either result can publish the same revision", async () => {
	const { sources, transport, records } = fixture();
	const [one, two] = await Promise.all([
		sources.refresh(sources.referenceFor({ kind: "feed", url: url })),
		sources.refresh(sources.referenceFor({ kind: "feed", url: url })),
	]);
	expect(transport.fetch).toHaveBeenCalledTimes(1);
	expect(one.revision).toBe(two.revision);
	sources.publish(one);
	expect(sources.isCurrent(two)).toBe(true);
	sources.publish(two);
	expect(records.size).toBe(1);
});

test("a coalesced in-flight request cannot inherit a newer saved revision", async () => {
	const { sources, transport, store } = fixture();
	const original = await sources.refresh(
		sources.referenceFor({ kind: "feed", url: url }),
	);
	sources.publish(original);
	const pending = deferred<Awaited<ReturnType<FeedTransport["fetch"]>>>();
	transport.fetch.mockImplementationOnce(() => pending.promise);
	const first = sources.refresh(sources.reference(original.id));
	const saved = store.feed(original.id);
	if (!saved) throw new Error("Missing saved source.");
	store.saveFeed({
		...saved,
		revision: "newer-publication",
		etag: "newer-etag",
	});
	const second = sources.refresh(sources.reference(original.id));
	pending.resolve({
		xml: "old response",
		etag: "old-etag",
		lastModified: null,
	});
	const results = await Promise.all([first, second]);
	for (const result of results) {
		expect(sources.isCurrent(result)).toBe(false);
		expect(() => sources.publish(result)).toThrow();
	}
	expect(store.feed(original.id)?.etag).toBe("newer-etag");
	// Delayed failures must not replace newer refresh state either.
	expect(store.feed(original.id)?.error).toBeNull();
});

test("source references hide configuration and cannot be forged or reused across instances", async () => {
	const one = fixture(),
		two = fixture();
	const reference = one.sources.referenceFor({ kind: "feed", url: url });
	expect(Object.keys(reference)).toEqual(["id"]);
	expect(JSON.stringify(reference)).not.toContain("private-key");
	expect(one.records.size).toBe(0);
	expect(one.transport.fetch).not.toHaveBeenCalled();
	await expect(one.sources.refresh({ ...reference })).rejects.toMatchObject({
		code: "invalid_source_reference",
	});
	await expect(two.sources.refresh(reference)).rejects.toMatchObject({
		code: "invalid_source_reference",
	});
	const result = await one.sources.refresh(reference);
	one.sources.publish(result);
	const savedReference = one.sources.reference(result.id);
	one.records.delete(result.id);
	// The durable binding can recover an absent RSS evidence row.
	expect((await one.sources.refresh(savedReference)).id).toBe(result.id);
});

test("shutdown aborts and drains in-flight reads and closes the transport once", async () => {
	const { sources, transport, records } = fixture();
	const aborted = deferred<void>();
	const released = deferred<void>();
	transport.fetch.mockImplementationOnce(async (_url, _validators, signal) => {
		signal.addEventListener("abort", () => aborted.resolve(), { once: true });
		await released.promise;
		return { xml: "response after shutdown", etag: null, lastModified: null };
	});
	const reference = sources.referenceFor({ kind: "feed", url: url });
	const reading = sources.refresh(reference);
	const rejected = expect(reading).rejects.toMatchObject({
		code: "ACQUISITION_UNAVAILABLE",
	});
	let closed = false;
	const closing = sources.close();
	void closing.then(() => {
		closed = true;
	});
	await aborted.promise;
	expect(closed).toBe(false);
	expect(sources.close()).toBe(closing);
	released.resolve();
	await closing;
	await rejected;
	expect(transport.close).toHaveBeenCalledTimes(1);
	expect(records.size).toBe(0);
	await expect(sources.refresh(reference)).rejects.toMatchObject({
		code: "ACQUISITION_UNAVAILABLE",
	});
});

test("invalid RSS input is rejected before transport or persistence", async () => {
	const { sources, transport, records } = fixture();
	expect(() =>
		sources.referenceFor({ kind: "feed", url: "http://127.0.0.1/rss" }),
	).toThrowError();
	expect(transport.fetch).not.toHaveBeenCalled();
	expect(records.size).toBe(0);
});
