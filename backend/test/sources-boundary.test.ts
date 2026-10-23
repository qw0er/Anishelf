import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createSourcesModule } from "../src/modules/acquisition/sources/create.js";
import { SourceError } from "../src/modules/acquisition/sources/domain/model.js";
import { JackettConnection } from "../src/modules/acquisition/sources/jackett/connection.js";
import type { SourceInput } from "../src/modules/acquisition/sources/public.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.restoreAllMocks();
});
const hash = "a".repeat(40);
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-source-boundary-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const database = ApplicationDatabase.openMemory();
	cleanup.push(async () => database.close());
	const fetch = vi.fn(async () => ({
		xml: `<rss version="2.0"><channel><item><title>Example - 03</title><guid>release</guid><enclosure type="application/x-bittorrent" url="magnet:?xt=urn:btih:${hash}"/></item></channel></rss>`,
		etag: "private-validator",
		lastModified: null,
	}));
	const search = vi
		.spyOn(JackettConnection.prototype, "search")
		.mockResolvedValue({
			entries: [
				{
					id: "release",
					observationId: "release",
					title: "Example - 03",
					publishedAt: null,
					hash,
					downloadUrl: null,
					download: { kind: "magnet", uri: `magnet:?xt=urn:btih:${hash}` },
				},
			],
			coverage: { limited: false, reason: null, pages: 1, queries: 1 },
			outcome: "matches",
		});
	vi.spyOn(JackettConnection.prototype, "readTorrent").mockResolvedValue({
		kind: "magnet",
		uri: `magnet:?xt=urn:btih:${hash}`,
	});
	const logs: string[] = [];
	const module = await createSourcesModule({
		dataDir: directory,
		store: database.acquisition,
		logger: pino({ level: "debug" }, { write: (line) => logs.push(line) }),
		transport: { fetch, close: async () => {} },
		now: () => 1000,
	});
	cleanup.push(() => module.runtime.close());
	const connector = await module.api.connector.save({
		generation: module.api.connector.settings().generation,
		url: "http://jackett:9117",
		apiKey: "private-api-key",
		origin: "external",
		providers: ["example"],
	});
	return { module, database, fetch, search, logs, connector };
}

test.each(["feed", "search"] as const)(
	"%s uses the same ID-based collection, atomic publication and content interfaces",
	async (kind) => {
		const f = await fixture();
		const input: SourceInput =
			kind === "feed"
				? { kind, url: "https://example.org/private/rss?key=private-feed-key" }
				: {
						kind,
						connectionRevision: f.connector.generation,
						providerId: "example",
						titles: ["Example"],
					};
		expect(Object.keys(f.module.catalog).sort()).toEqual([
			"configure",
			"snapshot",
		]);
		expect(Object.keys(f.module.content).sort()).toEqual(["isCurrent", "read"]);
		expect(Object.keys(f.module.collection)).toEqual(["collect"]);
		expect(Object.keys(f.module.api).sort()).toEqual([
			"configure",
			"connector",
			"snapshot",
			"test",
		]);
		const diagnostic = await f.module.api.test(input);
		expect(diagnostic.entries).toHaveLength(1);
		expect(JSON.stringify(diagnostic)).not.toMatch(
			/downloadUrl|magnet:|private-api-key|private-feed-key|generation/,
		);
		expect(f.database.acquisition.sources()).toEqual([]);
		const count = f.fetch.mock.calls.length + f.search.mock.calls.length;
		const id = f.module.catalog.configure(input);
		expect(f.fetch.mock.calls.length + f.search.mock.calls.length).toBe(count);
		const initial = f.module.catalog.snapshot(id);
		expect(initial).toMatchObject({ checkedAt: null, entries: [] });
		const byId = await f.module.api.test(id);
		expect(byId.entries).toEqual(diagnostic.entries);
		expect(f.module.catalog.snapshot(id)).toEqual(initial);
		const prepared = await f.module.collection.collect(id);
		expect(f.module.catalog.snapshot(id)).toEqual(initial);
		const subscription = {
			workKey: "anilist:anime:1",
			feedId: id,
			startEpisode: 1,
			enabled: true,
			revision: "subscription",
		};
		expect(() =>
			prepared.commit(() => {
				f.database.acquisition.saveSubscription(subscription, []);
				throw new Error("candidate storage failed");
			}),
		).toThrow("candidate storage failed");
		expect(f.module.catalog.snapshot(id)).toEqual(initial);
		expect(
			f.database.acquisition.subscription(subscription.workKey),
		).toBeNull();
		prepared.commit(() =>
			f.database.acquisition.saveSubscription(subscription, []),
		);
		expect(f.module.catalog.snapshot(id)).toEqual(prepared.snapshot);
		const reference = prepared.snapshot.entries[0]?.download;
		if (!reference) throw new Error("Missing content reference");
		expect(f.module.content.isCurrent(reference)).toBe(true);
		expect(
			await f.module.content.read(reference, new AbortController().signal),
		).toMatchObject({ kind: "magnet" });
		if (kind === "feed")
			f.fetch.mockRejectedValueOnce(new SourceError("upstream_failure"));
		else f.search.mockRejectedValueOnce(new SourceError("upstream_failure"));
		await expect(f.module.collection.collect(id)).rejects.toMatchObject({
			code: "upstream_failure",
		});
		expect(f.module.catalog.snapshot(id)).toMatchObject({
			entries: prepared.snapshot.entries,
			checkedAt: 1000,
			error: "upstream_failure",
			nextAttemptAt: 121000,
		});
		expect(f.logs.join("")).not.toMatch(
			/private-api-key|private-feed-key|private-validator/,
		);
		if (kind === "search") {
			await f.module.api.connector.clear(f.connector.generation);
			expect(f.module.content.isCurrent(reference)).toBe(false);
			await expect(f.module.collection.collect(id)).rejects.toMatchObject({
				code: "source_conflict",
			});
		}
	},
);
