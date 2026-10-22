import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { MockAgent } from "undici";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { builtinPolicy } from "../src/app/policy.js";
import { rssConstraints } from "../src/contracts/defaults.js";
import {
	createAcquisitionModule,
	createQbittorrentClient,
} from "../src/modules/acquisition/create.js";
import { parseRss } from "../src/modules/acquisition/sources/infrastructure/rss.js";
import {
	isPublicAddress,
	RssTransport,
	rssUrl,
} from "../src/modules/acquisition/sources/infrastructure/transport.js";
import type { FeedTransport } from "../src/modules/acquisition/sources/public.js";
import { AnitomyIdentificationParser } from "../src/modules/anime/identification/infrastructure/parser.js";
import type { AcquisitionTarget } from "../src/modules/anime/public.js";
import { AnimeReleaseAssessment } from "../src/modules/anime/release-assessment/application.js";
import { createAuthenticationModule } from "../src/modules/system/create.js";

vi.mock("node:fs/promises", async () => {
	const { memoryFs } = await import("./support/memory-filesystem.js");
	return memoryFs.promises;
});

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	vi.useRealTimers();
	for (const close of cleanup.splice(0).reverse()) await close();
});
const key = "anilist:anime:1";
function missingDiscovery(): never {
	throw new Error("Missing discovery.");
}
const hash = "a".repeat(40),
	secondHash = "b".repeat(40);
function item(
	title = "[Group] Frieren - 03 [1080p]",
	id = hash,
	date = "Tue, 20 Oct 2026 10:00:00 GMT",
) {
	return `<item><title>${title}</title><guid>${id}</guid><pubDate>${date}</pubDate><enclosure url="magnet:?xt=urn:btih:${id}" type="application/x-bittorrent" length="100"/></item>`;
}
function feed(items = item()) {
	return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${items}</channel></rss>`;
}
const target: AcquisitionTarget = {
	work: {
		reference: { provider: "anilist", mediaType: "anime", id: "1" },
		snapshotId: "snapshot",
		titles: ["Frieren"],
		titleVariants: [{ value: "Frieren", kind: "primary", language: "en" }],
		year: 2023,
		format: "TV",
		episodeCount: 28,
		season: null,
		part: null,
	},
	availableEpisodes: [],
	revision: "catalog-1",
};
const assessor = new AnimeReleaseAssessment(
	new AnitomyIdentificationParser(),
	{} as never,
	undefined,
);

async function fixture(
	createClient?: Parameters<typeof createAcquisitionModule>[0]["createClient"],
) {
	const dataDir = await mkdtemp(join(tmpdir(), "anishelf-rss-"));
	cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
	const database = ApplicationDatabase.openMemory();
	cleanup.push(async () => database.close());
	let clock = 1_000_000;
	const state = {
		target: structuredClone(target),
		refreshIntervalMinutes: undefined as number | undefined,
		profileId: undefined as string | undefined,
	};
	const fetch = vi.fn<FeedTransport["fetch"]>(async () => ({
		xml: feed(),
		etag: "etag-1",
		lastModified: null as string | null,
	}));
	const logs: string[] = [];
	const logger = pino({ level: "debug" }, { write: (line) => logs.push(line) });
	const options = {
		dataDir,
		logger,
		store: database.acquisition,
		downloadStore: database.acquisitionDownloads,
		anime: {
			target: vi.fn(async () => state.target),
			assessReleaseTitle: (title: string, target: AcquisitionTarget) =>
				assessor.assessReleaseTitle(title, target),
		},
		transport: { fetch, close: async () => {} },
		now: () => clock,
		rssRefreshIntervalMinutes: () => state.refreshIntervalMinutes,
		defaultAcquisitionProfileId: () => state.profileId,
		autoStart: false,
		...(createClient ? { createClient } : {}),
	};
	const module = await createAcquisitionModule(options);
	cleanup.push(() => module.close());
	const discovery = module.api.discovery ?? missingDiscovery();
	async function subscribe(
		workKey = key,
		startEpisode = 1,
		rss = "https://feeds.example.org/rss?passkey=private-feed-token",
	) {
		const preview = await discovery.preview("session", {
			workKey,
			rssUrl: rss,
			startEpisode,
			revision: discovery.get(workKey).subscription?.revision ?? null,
		});
		return discovery.confirm("session", workKey, preview.token);
	}
	return {
		dataDir,
		database,
		module,
		discovery,
		fetch,
		state,
		logs,
		options,
		subscribe,
		advance: (
			milliseconds = rssConstraints.defaultRefreshIntervalMinutes * 60_000,
		) => {
			clock += milliseconds;
		},
	};
}

test("RSS parser extracts torrent enclosures, CDATA and known hash extensions without confusing page links", () => {
	const xml = `<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa"><channel><item><title><![CDATA[[G] Frieren - 03 [A&B]]]></title><link>https://example.org/view/1</link><guid>1</guid><nyaa:infoHash>${hash}</nyaa:infoHash><enclosure url="https://example.org/a.torrent?x=1&amp;y=2" type="application/x-bittorrent" length="100"/></item></channel></rss>`;
	const entries = parseRss(xml);
	expect(entries[0]).toMatchObject({
		title: "[G] Frieren - 03 [A&B]",
		hash,
		downloadUrl: "https://example.org/a.torrent?x=1&y=2",
	});
	expect(
		parseRss(
			`<rss version="2.0"><channel><item><title>Frieren - 03</title><link>https://example.org/view/1</link></item></channel></rss>`,
		)[0]?.downloadUrl,
	).toBeNull();
	expect(parseRss(feed(item() + item()))).toHaveLength(1);
});
test("rejects declarations, malformed feeds, unsupported formats and oversized item batches", () => {
	for (const xml of [
		"<rss>",
		"<feed/>",
		`<!DOCTYPE rss [<!ENTITY x SYSTEM 'file:///etc/passwd'>]>${feed()}`,
		feed("<item><title></title></item>"),
	])
		expect(() => parseRss(xml)).toThrow();
	expect(() =>
		parseRss(
			feed(
				Array.from({ length: 1001 }, (_, index) =>
					item("Frieren - 03", String(index)),
				).join(""),
			),
		),
	).toThrow();
});
test("public destination validation rejects loopback, private, mapped and alternate IP spellings", () => {
	for (const url of [
		"file:///etc/passwd",
		"http://127.0.0.1/rss",
		"http://2130706433/rss",
		"http://[::1]/",
		"http://[::ffff:127.0.0.1]/",
		"http://192.168.1.2/rss",
		"http://169.254.169.254/",
		"http://localhost/rss",
		"https://u:p@example.org/rss",
		"https://example.org/rss#token",
	])
		expect(() => rssUrl(url)).toThrow();
	for (const address of [
		"10.1.2.3",
		"172.16.2.3",
		"::1",
		"fd00::1",
		"::ffff:127.0.0.1",
	])
		expect(isPublicAddress(address)).toBe(false);
	expect(isPublicAddress("8.8.8.8")).toBe(true);
	expect(rssUrl("https://feeds.example.org/rss?passkey=private")).toContain(
		"passkey=private",
	);
});
test("actual RSS transport handles conditional responses and rejects private redirects and excess bytes", async () => {
	const agent = new MockAgent();
	agent.disableNetConnect();
	const pool = agent.get("https://feeds.example.org");
	const transport = new RssTransport(agent);
	cleanup.push(() => transport.close());
	pool
		.intercept({ path: "/rss", headers: { "if-none-match": "etag-1" } })
		.reply(304, "");
	expect(
		(
			await transport.fetch(
				"https://feeds.example.org/rss",
				{ etag: "etag-1", lastModified: null },
				new AbortController().signal,
			)
		).xml,
	).toBeNull();
	pool
		.intercept({ path: "/redirect" })
		.reply(302, "", { headers: { location: "http://127.0.0.1/private" } });
	await expect(
		transport.fetch(
			"https://feeds.example.org/redirect",
			{ etag: null, lastModified: null },
			new AbortController().signal,
		),
	).rejects.toMatchObject({ code: "invalid_url" });
	pool
		.intercept({ path: "/large" })
		.reply(200, "x".repeat(5 * 1024 * 1024 + 1));
	await expect(
		transport.fetch(
			"https://feeds.example.org/large",
			{ etag: null, lastModified: null },
			new AbortController().signal,
		),
	).rejects.toMatchObject({ code: "feed_too_large" });
});
test("release assessment uses leaf evidence only and skips identity, season, pack and numbering ambiguity", () => {
	expect(
		assessor.assessReleaseTitle("[G] Frieren - 03 [1080p]", target),
	).toMatchObject({
		eligible: true,
		episode: 3,
	});
	for (const title of [
		"Other Anime - 03",
		"Frieren S02 - 03",
		"Frieren - 01-12",
		"Frieren OVA - 01",
		"Frieren - 00",
		"Frieren - 29",
		"Frieren Complete Batch",
	])
		expect(assessor.assessReleaseTitle(title, target).eligible, title).toBe(
			false,
		);
	const extraction = new AnitomyIdentificationParser().extractRelease(
		"[G] Frieren / Extra - 03",
	);
	expect(extraction.inputs.map((input) => input.mode)).toEqual(["basename"]);
});
test("subscriptions preview without writes, confirm explicit scope and rank versions before reservation without review", async () => {
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
	const preview = await f.discovery.preview("session", {
		workKey: key,
		rssUrl: "https://feeds.example.org/rss?passkey=private-feed-token",
		startEpisode: 2,
		revision: null,
	});
	expect(f.discovery.get(key).subscription).toBeNull();
	expect(
		preview.candidates.filter((candidate) => candidate.status === "selected"),
	).toHaveLength(0);
	expect(
		preview.candidates.find(
			(candidate) => candidate.status === "skipped" && candidate.episode === 3,
		)?.reasons,
	).toContain("waiting_for_level");
	const saved = await f.discovery.confirm("session", key, preview.token);
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
			state: "downloading",
			progress: 0.5,
			remainingBytes: 1,
			totalBytes: 2,
			downloadBytesPerSecond: 0,
			uploadBytesPerSecond: 0,
			savePath: "/data/media",
			contentPath: "/data/media/file.mkv",
			category: "",
			tags: [] as string[],
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
test("session-bound previews expire and reject scope, metadata and local availability changes", async () => {
	const f = await fixture();
	const input = {
		workKey: key,
		rssUrl: "https://feeds.example.org/rss",
		startEpisode: 1,
		revision: null,
	};
	const preview = await f.discovery.preview("session", input);
	await expect(
		f.discovery.confirm("other", key, preview.token),
	).rejects.toMatchObject({ code: "ACQUISITION_CONFLICT" });
	f.state.target.revision = "changed";
	await expect(
		f.discovery.confirm("session", key, preview.token),
	).rejects.toMatchObject({ code: "ACQUISITION_CONFLICT" });
	f.state.target.revision = target.revision;
	f.advance();
	await expect(
		f.discovery.confirm("session", key, preview.token),
	).rejects.toMatchObject({ code: "ACQUISITION_CONFLICT" });
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
				secure: false,
				path: "/",
				httpOnly: true,
				domain: null,
			},
		}),
		9_999_999,
	);
	const reopened = await createAcquisitionModule(f.options);
	cleanup.push(() => reopened.close());
	expect(reopened.api.discovery?.get(key)).toEqual(paused);
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
test("shared RSS is fetched once for concurrent previews and can bind multiple works", async () => {
	const f = await fixture();
	const input = {
		rssUrl: "https://feeds.example.org/shared",
		startEpisode: 1,
		revision: null,
	};
	const [one, two] = await Promise.all([
		f.discovery.preview("session", { ...input, workKey: key }),
		f.discovery.preview("session", { ...input, workKey: "anilist:anime:2" }),
	]);
	expect(f.fetch).toHaveBeenCalledTimes(1);
	await f.discovery.confirm("session", key, one.token);
	await f.discovery.confirm("session", "anilist:anime:2", two.token);
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

test("a newer source preview cannot be overwritten by an older in-flight poll", async () => {
	const f = await fixture();
	const saved = await f.subscribe();
	f.advance();
	let finish: (value: AcquisitionTarget) => void = () => {};
	const waiting = new Promise<AcquisitionTarget>((resolve) => {
		finish = resolve;
	});
	f.options.anime.target.mockImplementationOnce(() => waiting);
	const refreshing = f.discovery.refresh(
		key,
		saved.subscription?.revision ?? "",
	);
	await vi.waitFor(() =>
		expect(f.options.anime.target).toHaveBeenCalledTimes(3),
	);
	f.fetch.mockResolvedValueOnce({
		xml: feed(item("Frieren - 04", secondHash)),
		etag: "new-source",
		lastModified: null,
	});
	const newer = await f.subscribe();
	finish(f.state.target);
	await refreshing;
	expect(f.discovery.get(key)).toEqual(newer);
	expect(
		f.database.acquisition.feed(newer.subscription?.feedId ?? "")?.etag,
	).toBe("new-source");
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
test("subscription HTTP routes are authenticated, CSRF protected and redact private RSS addresses", async () => {
	const f = await fixture();
	const auth = await createAuthenticationModule({
		logger: f.options.logger,
		dataDir: f.dataDir,
		store: f.database.authentication,
		secure: false,
		sources: { version: async () => "one" },
	});
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: f.options.logger,
		policy: builtinPolicy,
		configure: auth.registerHttp,
		registrations: [f.module.registerHttp],
		closeDependencies: async () => {},
	});
	cleanup.push(() => app.close());
	const headers = { host: "127.0.0.1:3000" },
		path = "/api/acquisition/subscriptions";
	expect(
		(await app.inject({ url: `${path}?workKey=${key}`, headers })).statusCode,
	).toBe(401);
	const session = await app.inject({ url: "/api/auth/session", headers });
	const login = await app.inject({
		method: "POST",
		url: "/api/auth/login",
		headers: {
			...headers,
			cookie: session.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
			"x-csrf-token": session.json().csrfToken,
		},
		payload: { password: auth.initialPassword },
	});
	const signed = {
		...headers,
		cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
	};
	const mutation = { ...signed, "x-csrf-token": login.json().csrfToken };
	const payload = {
		workKey: key,
		rssUrl: "https://feeds.example.org/private-token/rss?passkey=private-token",
		startEpisode: 1,
		revision: null,
	};
	expect(
		(
			await app.inject({
				url: `${path}/preview`,
				method: "POST",
				headers: signed,
				payload,
			})
		).statusCode,
	).toBe(403);
	const preview = await app.inject({
		url: `${path}/preview`,
		method: "POST",
		headers: mutation,
		payload,
	});
	expect(preview.statusCode).toBe(200);
	expect(preview.body).not.toContain("private-token");
	const saved = await app.inject({
		url: `${path}/confirm`,
		method: "POST",
		headers: mutation,
		payload: { workKey: key, token: preview.json().token },
	});
	expect(saved.statusCode).toBe(200);
	expect(saved.json().candidates[0].status).toBe("skipped");
	expect(saved.json().candidates[0].reasons).toContain("waiting_for_level");
	expect(saved.body).not.toContain("private-token");
	expect(saved.body).not.toContain("downloadUrl");
	expect(
		(
			await app.inject({
				url: `${path}?workKey=${key}&page=0`,
				headers: signed,
			})
		).statusCode,
	).toBe(400);
	expect(f.logs.join("")).not.toContain("private-token");
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

test("changing the inherited profile invalidates a pending preview", async () => {
	const f = await fixture();
	const preview = await f.discovery.preview("session", {
		workKey: key,
		rssUrl: "https://example.org/rss",
		startEpisode: 1,
		revision: null,
	});
	f.state.profileId = "builtin:efficient";
	await expect(
		f.discovery.confirm("session", key, preview.token),
	).rejects.toMatchObject({ code: "ACQUISITION_CONFLICT" });
	expect(f.discovery.get(key).subscription).toBeNull();
});
