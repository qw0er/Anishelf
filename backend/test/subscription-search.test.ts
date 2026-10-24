import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createSourcesModule } from "../src/modules/acquisition/sources/create.js";
import { JackettConnection } from "../src/modules/acquisition/sources/jackett/connection.js";
import { SourceError } from "../src/modules/acquisition/sources/public.js";
import { SubscriptionsApplication } from "../src/modules/acquisition/subscriptions/application/application.js";
import type { AcquisitionTarget } from "../src/modules/anime/public.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.restoreAllMocks();
});
const workKey = "anilist:anime:1";
const attributes = {
	subtitleLanguages: [],
	subtitleFormats: [],
	resolutions: [1080],
	videoCodecs: [],
	sources: [],
	releaseGroups: [],
	revision: 1,
};
const target: AcquisitionTarget = {
	work: {
		reference: { provider: "anilist", mediaType: "anime", id: "1" },
		snapshotId: "snapshot",
		titles: ["Frieren Season 2", "Sousou no Frieren Season 2"],
		year: 2026,
		format: "TV",
		episodeCount: 12,
		season: "2",
		part: null,
	},
	availableEpisodes: [],
	revision: "metadata",
};
async function fixture() {
	const directory = await mkdtemp(
		join(tmpdir(), "anishelf-subscription-search-"),
	);
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const db = ApplicationDatabase.openMemory();
	cleanup.push(() => db.close());
	const logs: string[] = [];
	const logger = pino({ level: "debug" }, { write: (line) => logs.push(line) });
	const search = vi
		.spyOn(JackettConnection.prototype, "search")
		.mockImplementation(async (plan) => ({
			entries:
				plan.indexerId === "first"
					? []
					: [
							{
								id: "release",
								observationId: "release",
								title: "Frieren Season 2 - 03",
								publishedAt: null,
								hash: "a".repeat(40),
								downloadUrl: null,
								download: {
									kind: "magnet",
									uri: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
								},
							},
						],
			coverage: {
				limited: true,
				reason: "missing_pagination",
				pages: 1,
				queries: 1,
			},
			outcome: plan.indexerId === "first" ? "no_match" : "matches",
		}));
	let now = 1000000;
	const sources = await createSourcesModule({
		now: () => now,
		dataDir: directory,
		logger,
		store: db.acquisition,
	});
	cleanup.push(() => sources.runtime.close());
	await sources.api.connector.save({
		generation: sources.api.connector.settings().generation,
		url: "http://jackett:9117",
		apiKey: "private-key",
		origin: "external",
		providers: ["first", "second", "third"],
	});
	const anime = {
		target: vi.fn(async () => target),
		assessReleaseTitle: vi.fn((title: string) => ({
			attributes,
			episode: 3,
			eligible: !title.includes("Wrong"),
			reasons: title.includes("Wrong") ? ["identity_unconfirmed"] : [],
			version: "v1",
		})),
	};
	const subscriptions = new SubscriptionsApplication({
		store: db.acquisition,
		sources: sources.api,
		anime,
		downloads: async () => [],
		logger,
		now: () => now,
	});
	cleanup.push(() => subscriptions.close());
	return {
		db,
		sources,
		search,
		subscriptions,
		anime,
		logs,
		advance: () => {
			now += 3600000;
		},
	};
}
const input = { workKey, revision: null, startEpisode: 1 };

test("discovery checks configured sites in order, preserves title ordinals and never publishes or grants permission", async () => {
	const f = await fixture();
	const result = await f.subscriptions.search(input);
	expect(result.source).toMatchObject({
		kind: "search",
		providerId: "second",
		titles: target.work.titles,
	});
	expect(
		result.attempts.map((value) => [value.providerId, value.outcome]),
	).toEqual([
		["first", "no_match"],
		["second", "matched"],
	]);
	expect(result.attempts[0]?.limited).toBe(true);
	expect(result.releases[0]?.waiting).toBe(true);
	expect(f.search.mock.calls.map(([plan]) => plan.indexerId)).toEqual([
		"first",
		"second",
	]);
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
	expect(
		f.db.acquisition
			.sources()
			.every(
				(row) =>
					row.snapshot?.entries.length === 0 &&
					row.snapshot?.checkedAt === null,
			),
	).toBe(true);
	expect(f.db.acquisition.candidates(workKey)).toEqual([]);
	expect(JSON.stringify(result) + f.logs.join("")).not.toMatch(
		/private-key|magnet:|observationId|downloadUrl/,
	);
});

test("saving pins the chosen site; no-match refreshes never fall back to another provider", async () => {
	const f = await fixture();
	const result = await f.subscriptions.search(input);
	const saved = await f.subscriptions.save({
		...input,
		source: result.source,
		target: null,
	});
	expect(saved.subscription).toMatchObject({
		sourceKind: "search",
		source: "second",
		checkedAt: null,
	});
	expect(f.search).toHaveBeenCalledTimes(2);
	await f.subscriptions.refresh(workKey, saved.subscription?.revision ?? "");
	expect(f.db.acquisition.candidates(workKey)).toHaveLength(1);
	const stored = f.db.acquisition.subscription(workKey);
	f.advance();
	f.search.mockResolvedValue({
		entries: [],
		coverage: { limited: false, reason: null, pages: 1, queries: 1 },
		outcome: "no_match",
	});
	await f.subscriptions.refresh(workKey, saved.subscription?.revision ?? "");
	expect(f.search.mock.calls.map(([plan]) => plan.indexerId)).toEqual([
		"first",
		"second",
		"second",
	]);
	expect(f.db.acquisition.subscription(workKey)?.sourceInput).toEqual(
		stored?.sourceInput,
	);
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
});

test("identity uncertainty and episode scope cannot select a source", async () => {
	const f = await fixture();
	f.anime.assessReleaseTitle.mockReturnValue({
		attributes,
		episode: 3,
		eligible: false,
		reasons: ["identity_unconfirmed"],
		version: "v1",
	});
	const uncertain = await f.subscriptions.search(input);
	expect(uncertain.source).toBeNull();
	expect(uncertain.attempts.at(-1)?.reasons).toContain("identity_unconfirmed");
	expect(uncertain.attempts.at(-1)?.outcome).toBe("no_eligible");
	f.anime.assessReleaseTitle.mockReturnValue({
		attributes,
		episode: 3,
		eligible: true,
		reasons: [],
		version: "v1",
	});
	const scoped = await f.subscriptions.search({ ...input, startEpisode: 4 });
	expect(scoped.source).toBeNull();
});

test("provider failures are explained while later configured sites may still qualify", async () => {
	const f = await fixture();
	f.search.mockRejectedValueOnce(new SourceError("authentication_failed"));
	const result = await f.subscriptions.search(input);
	expect(result.attempts[0]).toMatchObject({
		providerId: "first",
		outcome: "unavailable",
		code: "authentication_failed",
	});
	expect(result.source?.providerId).toBe("second");
});

test("a changed connector rejects a previously returned choice", async () => {
	const f = await fixture();
	const result = await f.subscriptions.search(input);
	await f.sources.api.connector.clear(
		f.sources.api.connector.settings().generation,
	);
	await expect(
		f.subscriptions.save({ ...input, source: result.source, target: null }),
	).rejects.toMatchObject({ code: "ACQUISITION_CONFLICT" });
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
});

test("a late search response cannot replace an edited subscription and duplicate searches are bounded", async () => {
	const f = await fixture();
	let done: (() => void) | undefined;
	f.search.mockImplementationOnce(async () => {
		await new Promise<void>((resolve) => {
			done = resolve;
		});
		return {
			entries: [],
			coverage: { limited: false, reason: null, pages: 1, queries: 1 },
			outcome: "no_match",
		};
	});
	const pending = f.subscriptions.search(input);
	await vi.waitFor(() => expect(done).toBeTypeOf("function"));
	expect(() => f.subscriptions.search(input)).toThrow("busy");
	await f.subscriptions.save({
		...input,
		source: { kind: "feed", url: "https://example.org/rss" },
		target: null,
	});
	done?.();
	await expect(pending).rejects.toMatchObject({ code: "ACQUISITION_CONFLICT" });
	expect(f.db.acquisition.subscription(workKey)?.sourceInput?.kind).toBe(
		"feed",
	);
});
