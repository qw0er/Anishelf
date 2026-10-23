import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toTorrentFile } from "parse-torrent";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { builtinPolicy } from "../src/app/policy.js";
import { createAcquisitionModule } from "../src/modules/acquisition/create.js";
import { DownloadsApplication } from "../src/modules/acquisition/downloads/application/application.js";
import {
	DownloadContext,
	DownloadExecution,
} from "../src/modules/acquisition/downloads/application/context.js";
import {
	absoluteDownloadPath,
	relativeDownloadPath,
	workDirectory,
} from "../src/modules/acquisition/downloads/domain/paths.js";
import { resolveTorrent } from "../src/modules/acquisition/downloads/infrastructure/torrent.js";
import type { TorrentReader } from "../src/modules/acquisition/downloads/public.js";
import { DownloadTransfers } from "../src/modules/acquisition/downloads/transfers/application.js";
import {
	type QbittorrentApi,
	QbittorrentError,
} from "../src/modules/acquisition/qbittorrent/public.js";
import { SourceDownloads } from "../src/modules/acquisition/sources/downloads.js";
import type { AcquisitionTarget } from "../src/modules/anime/public.js";
import { createAuthenticationModule } from "../src/modules/system/create.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
const key = "anilist:anime:1",
	hash = "a".repeat(40);
const target: AcquisitionTarget = {
	work: {
		reference: { provider: "anilist", mediaType: "anime", id: "1" },
		snapshotId: "snapshot",
		titles: ["Frieren"],
		year: 2023,
		format: "TV",
		episodeCount: 28,
		season: null,
		part: null,
	},
	availableEpisodes: [],
	revision: "one",
};
const logger = pino({ level: "silent" });
function readerFor(transport: {
	read(url: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
	close(): Promise<void>;
}): TorrentReader {
	return {
		read: async (reference, signal) =>
			reference.startsWith("magnet:?")
				? { kind: "magnet", uri: reference }
				: { kind: "bytes", bytes: await transport.read(reference, signal) },
		isCurrent: () => true,
		close: () => transport.close(),
	};
}
async function fixture(persistent = false, bundled = false) {
	const dir = await mkdtemp(join(tmpdir(), "anishelf-downloads-"));
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	let db = persistent
		? ApplicationDatabase.open(dir)
		: ApplicationDatabase.openMemory();
	cleanup.push(async () => db.close());
	let now = 1_000_000,
		generation = "account-1";
	const state: { task: Awaited<ReturnType<QbittorrentApi["task"]>> } = {
		task: null,
	};
	const probe = vi.fn<QbittorrentApi["probe"]>(async () => ({
		version: "5.0.5",
		apiVersion: "2.11.4",
		defaultSavePath: "/downloads",
		incompletePathEnabled: true,
		incompletePath: "/incomplete",
	}));
	const add = vi.fn<QbittorrentApi["add"]>(async (input) => {
		state.task = {
			hash,
			v1Hash: hash,
			v2Hash: null,
			name: "Frieren - 03",
			state: "downloading",
			progress: 0.25,
			remainingBytes: 75,
			totalBytes: 100,
			downloadBytesPerSecond: 10,
			uploadBytesPerSecond: 0,
			savePath: input.savePath,
			contentPath: `${input.savePath}/Frieren - 03.mkv`,
			category: input.category,
			tags: input.tags,
		};
	});
	const client: QbittorrentApi = {
		probe,
		add,
		task: vi.fn(async () => state.task),
		tasks: vi.fn(async () => (state.task ? [state.task] : [])),
		files: vi.fn(async () => [
			{
				path: "Frieren - 03.mkv",
				sizeBytes: 100,
				progress: 1,
				priority: 1,
			},
		]),
		close: vi.fn(),
	};
	const resources = {
		roots: vi.fn(async () =>
			bundled
				? [
						{ scopeId: "other", name: "Other", path: "/other" },
						{ scopeId: "root", name: "Anime", path: "/data/media" },
					]
				: [{ scopeId: "root", name: "Anime" }],
		),
		validate: vi.fn(async () => {}),
		inspect: vi.fn(async () => ({ sizeBytes: 100, sourceVersion: "v1" })),
		refresh: vi.fn(async (_scope: string, path: string) => ({
			scopeId: "root",
			relativePath: path,
			fileId: "file",
			sourceVersion: "v1",
		})),
	};
	const anime = {
		target: vi.fn(async () => target),
		assessReleaseTitle: vi.fn(() => ({
			episode: 3,
			eligible: true,
			reasons: [] as string[],
			version: "1",
		})),
	};
	const ingestion = {
		available: vi.fn(async () => true),
		ingest: vi.fn(async () => "available" as "available" | "review"),
	};
	const transport = {
		read: vi.fn(async () => new Uint8Array()),
		close: vi.fn(async () => {}),
	};
	const sourceDownloads = () =>
		new SourceDownloads(
			db.acquisition,
			transport,
			undefined,
			new AbortController().signal,
			logger,
			(id) => {
				const feed = db.acquisition.feed(id);
				return feed ? { ...feed, label: "feed" } : null;
			},
		);
	const reader: TorrentReader = {
		read: (reference, signal) => sourceDownloads().read(reference, signal),
		isCurrent: (reference) => sourceDownloads().isCurrent(reference),
		close: () => transport.close(),
	};
	function seed() {
		seedSubscription(
			db.acquisition,
			{
				workKey: key,
				feedId: "feed",
				startEpisode: 1,
				enabled: true,
				revision: randomUUID(),
			},
			{
				id: "feed",
				revision: "feed-1",
				url: "https://example.org/feed?passkey=secret",
				etag: null,
				lastModified: null,
				checkedAt: now,
				nextAttemptAt: now + 600000,
				failures: 0,
				error: null,
				entries: [
					{
						id: "entry",
						observationId: "entry",
						title: "Frieren - 03",
						publishedAt: now,
						downloadUrl: `magnet:?xt=urn:btih:${hash}`,
						hash,
					},
				],
			},
			[
				{
					id: "candidate",
					workKey: key,
					entryId: "entry",
					title: "Frieren - 03",
					episode: 3,
					status: "selected",
					reasons: [],
					version: "1",
					snapshotId: "snapshot",
					publishedAt: now,
				},
			],
		);
	}
	seed();
	function create() {
		const worker = new DownloadsApplication({
			store: db.acquisitionDownloads,
			selection: {
				subscription: (key) => db.acquisition.subscription(key),
				subscriptions: () => db.acquisition.subscriptions(),
				candidates: (key) => db.acquisition.candidates(key),
				release: (feedId, entryId) => {
					const feed = db.acquisition.feed(feedId);
					const entry = feed?.entries.find((entry) => entry.id === entryId);
					if (!feed || !entry) return null;
					sourceDownloads().publish({ ...feed, label: "feed" }, null);
					return sourceDownloads().project(feedId, entry);
				},
				authorization: (key) => db.acquisition.authorization(key),
			},
			resources,
			anime,
			ingestion,
			transport: reader,
			connectionGeneration: () => generation,
			initializeBundled: async () => bundled,
			withClient: async (expected, operation) => {
				if (expected !== generation) throw new Error("changed");
				return operation(client);
			},
			logger,
			now: () => now,
		});
		cleanup.push(() => worker.close());
		return worker;
	}
	let worker = create();
	async function configure() {
		const saved = await worker.saveDestination({
			revision: db.acquisitionDownloads.destination()?.revision ?? null,
			scopeId: "root",
			path: "/downloads",
		});
		await worker.validate(saved.revision);
		return saved;
	}
	async function authorize() {
		const subscription = db.acquisition.subscription(key),
			destination = db.acquisitionDownloads.destination();
		if (!subscription || !destination?.validated)
			throw new Error("Invalid test authorization");
		db.acquisition.authorize({
			workKey: key,
			feedId: subscription.feedId,
			startEpisode: subscription.startEpisode,
			destinationRevision: destination.revision,
			connectionGeneration: generation,
		});
	}
	function complete() {
		if (!state.task) throw new Error("No task");
		state.task = {
			...state.task,
			state: "uploading",
			progress: 1,
			remainingBytes: 0,
		};
	}
	return {
		dir,
		get db() {
			return db;
		},
		get worker() {
			return worker;
		},
		state,
		client,
		probe,
		add,
		resources,
		anime,
		ingestion,
		transport,
		reader,
		seed,
		configure,
		authorize,
		complete,
		advance: () => {
			now += 3600000;
		},
		changeAccount: () => {
			generation = "account-2";
		},
		restart: async () => {
			if (!persistent)
				throw new Error("Restart requires a persistent fixture.");
			await worker.close();
			db.close();
			db = ApplicationDatabase.open(dir);
			worker = create();
		},
	};
}

async function connectedModule(
	f: Awaited<ReturnType<typeof fixture>>,
	autoStart = false,
) {
	const module = await createAcquisitionModule({
		dataDir: f.dir,
		logger,
		store: f.db.acquisition,
		downloadStore: f.db.acquisitionDownloads,
		resources: f.resources,
		anime: f.anime,
		ingestion: f.ingestion,
		torrentTransport: f.transport,
		createClient: () => f.client,
		transport: {
			fetch: async () => ({
				xml: `<rss version="2.0"><channel><item><title>Frieren - 03</title><guid>entry</guid><enclosure url="magnet:?xt=urn:btih:${hash}" type="application/x-bittorrent"/></item></channel></rss>`,
				etag: null,
				lastModified: null,
			}),
			close: async () => {},
		},
		autoStart,
	});
	cleanup.push(() => module.close());
	await module.api.connection.save({
		generation: module.api.connection.settings().generation,
		url: "http://downloader:8080",
		username: "user",
		password: "password",
	});
	return module;
}

test("old subscriptions stay discovery-only until scoped confirmation and destination validation", async () => {
	const f = await fixture();
	await f.worker.tick();
	expect(f.add).not.toHaveBeenCalled();
	const config = await f.configure();
	await f.worker.tick();
	expect(f.add).not.toHaveBeenCalled();
	await f.authorize();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.add.mock.calls[0]?.[0]).toMatchObject({
		savePath: "/downloads/Frieren [anilist-1]",
		category: "anishelf",
		tags: [expect.stringMatching(/^anishelf-/)],
	});
	expect(f.worker.activity(key).authorized).toBe(true);
	const settings = await f.worker.saveDestination({
		revision: config.revision,
		scopeId: "root",
		path: "/new",
	});
	await f.worker.validate(settings.revision);
	expect(f.worker.activity(key).authorized).toBe(false);
});
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
test("remote add success followed by a timeout binds after restart without resending", async () => {
	const f = await fixture(true);
	await f.configure();
	await f.authorize();
	const actual = f.add.getMockImplementation();
	f.add.mockImplementationOnce(async (input) => {
		await actual?.(input);
		throw new QbittorrentError("timeout", "unknown");
	});
	await f.worker.tick();
	expect(f.db.acquisitionDownloads.activity(key, 1, 100).items[0]?.state).toBe(
		"unknown",
	);
	await f.restart();
	f.advance();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.db.acquisitionDownloads.activity(key, 1, 100).items[0]?.state).toBe(
		"bound",
	);
});
test("successful add without a matching remote task stays unknown and is not resent", async () => {
	const f = await fixture(true);
	await f.configure();
	await f.authorize();
	f.add.mockResolvedValueOnce(undefined);
	await f.worker.tick();
	expect(f.db.acquisitionDownloads.activity(key, 1, 100).items[0]?.state).toBe(
		"unknown",
	);
	await f.restart();
	f.advance();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.db.acquisitionDownloads.activity(key, 1, 100).items[0]?.state).toBe(
		"unknown",
	);
});
test("uncertain absent submissions are not retried automatically; explicit retry is idempotent", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.add.mockRejectedValueOnce(new QbittorrentError("timeout", "unknown"));
	await f.worker.tick();
	f.advance();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error();
	f.worker.retry(item.id, item.revision, "manual", "acquisition");
	f.worker.retry(item.id, item.revision, "manual", "acquisition");
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(2);
});
test("external pause remains paused and external removal suppresses acquisition across restart", async () => {
	const f = await fixture(true);
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	if (!f.state.task) throw new Error();
	f.state.task.state = "stoppedDL";
	await f.worker.tick();
	expect(f.state.task.state).toBe("stoppedDL");
	f.state.task = null;
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.state).toBe("missing");
	await f.restart();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
});
test("completed files become available only after confined refresh and Anime ingestion", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	await f.worker.tick();
	expect(f.resources.inspect).toHaveBeenCalledWith(
		"root",
		"Frieren [anilist-1]/Frieren - 03.mkv",
	);
	expect(f.resources.refresh).toHaveBeenCalled();
	expect(f.ingestion.ingest).toHaveBeenCalled();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		state: "available",
		ingestion: "available",
	});
	expect((await f.worker.settings()).destination?.visibilityVerified).toBe(
		true,
	);
});
test("missing completed file is an import failure and retry imports without downloading again", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	f.resources.inspect.mockRejectedValueOnce(new Error("missing"));
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.ingestion).toBe("failed");
	expect(f.ingestion.ingest).not.toHaveBeenCalled();
	const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error();
	f.worker.retry(item.id, item.revision, "retry-import", "import");
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.worker.activity(key).items[0]?.state).toBe("available");
});
test("unsupported multi-video layouts and association conflicts remain reviewable", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	vi.mocked(f.client.files).mockResolvedValue([
		{ path: "01.mkv", sizeBytes: 50, priority: 1, progress: 1 },
		{ path: "02.mkv", sizeBytes: 50, priority: 1, progress: 1 },
	]);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		ingestion: "review",
		error: "unsupported_file_layout",
	});
	expect(f.ingestion.ingest).not.toHaveBeenCalled();
});
test("disconnection is not task removal and account replacement does not control new account tasks", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	vi.mocked(f.client.task).mockRejectedValueOnce(
		new QbittorrentError("unavailable", "read"),
	);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.state).toBe("bound");
	f.changeAccount();
	f.advance();
	await f.worker.tick();
	expect(f.worker.activity(key).authorized).toBe(false);
	expect(f.add).toHaveBeenCalledTimes(1);
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
test("invalid incomplete directories and removed resource roots prevent validation", async () => {
	const f = await fixture();
	const saved = await f.worker.saveDestination({
		revision: null,
		scopeId: "root",
		path: "/downloads",
	});
	f.probe.mockResolvedValueOnce({
		version: "5",
		apiVersion: "2",
		defaultSavePath: "/downloads",
		incompletePathEnabled: true,
		incompletePath: "/downloads/partial",
	});
	await expect(f.worker.validate(saved.revision)).rejects.toThrow();
	expect((await f.worker.settings()).destination?.validated).toBe(false);
});
test("torrent parser verifies canonical magnet identity and rejects pure v2 and mismatched feed hashes", async () => {
	const transport = { read: vi.fn(), close: vi.fn() };
	const signal = new AbortController().signal;
	expect(
		(
			await resolveTorrent(
				{ download: `magnet:?xt=urn:btih:${hash.toUpperCase()}`, hash },
				readerFor(transport),
				signal,
			)
		).hash,
	).toBe(hash);
	await expect(
		resolveTorrent(
			{ download: `magnet:?xt=urn:btih:${hash}`, hash: "b".repeat(40) },
			readerFor(transport),
			signal,
		),
	).rejects.toMatchObject({ code: "torrent_identity_conflict" });
	await expect(
		resolveTorrent(
			{ download: `magnet:?xt=urn:btmh:1220${"a".repeat(64)}`, hash: null },
			readerFor(transport),
			signal,
		),
	).rejects.toThrow();
});
test("destination and torrent paths reject escapes and directory names remain bounded", () => {
	for (const path of ["../x", "/x", "a/../x", "a\\x", "a//x"])
		expect(() => relativeDownloadPath(path)).toThrow();
	for (const path of ["relative", "/a/../b", "C:\\media"])
		expect(() => absoluteDownloadPath(path)).toThrow();
	expect(workDirectory(key, "Frieren")).toBe("Frieren [anilist-1]");
	expect(
		Buffer.byteLength(workDirectory(key, "动画".repeat(200))),
	).toBeLessThanOrEqual(240);
	expect(workDirectory("anilist:anime:2", "Frieren")).not.toBe(
		workDirectory(key, "Frieren"),
	);
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
test("v1 and hybrid torrent bytes resolve consistently and reject unsafe original path components", async () => {
	const bytes = (hybrid = false, name = "Frieren - 03.mkv") =>
		toTorrentFile({
			infoHash: "",
			announce: [],
			urlList: [],
			info: {
				name: Buffer.from(name),
				length: 100,
				"piece length": 16384,
				pieces: Buffer.alloc(20),
				...(hybrid
					? {
							"meta version": 2,
							"file tree": {
								[name]: {
									"": { length: 100, "pieces root": Buffer.alloc(32) },
								},
							},
						}
					: {}),
			},
		});
	const transport = {
		read: vi.fn(async () => new Uint8Array(bytes())),
		close: async () => {},
	};
	const first = await resolveTorrent(
		{ download: "https://example.org/episode.torrent", hash: null },
		readerFor(transport),
		new AbortController().signal,
	);
	expect(first.hash).toMatch(/^[a-f0-9]{40}$/);
	transport.read.mockResolvedValueOnce(new Uint8Array(bytes(true)));
	const hybrid = await resolveTorrent(
		{ download: "https://example.org/episode.torrent", hash: null },
		readerFor(transport),
		new AbortController().signal,
	);
	expect(hybrid.hash).toMatch(/^[a-f0-9]{40}$/);
	transport.read.mockResolvedValueOnce(
		new Uint8Array(bytes(false, "../escape.mkv")),
	);
	await expect(
		resolveTorrent(
			{ download: "https://example.org/episode.torrent", hash: null },
			readerFor(transport),
			new AbortController().signal,
		),
	).rejects.toMatchObject({ code: "invalid_file_path" });
});
test("download endpoints enforce authentication, CSRF, revision checks and safe projections", async () => {
	const f = await fixture();
	const module = await createAcquisitionModule({
		dataDir: f.dir,
		logger,
		store: f.db.acquisition,
		downloadStore: f.db.acquisitionDownloads,
		resources: f.resources,
		anime: f.anime,
		ingestion: f.ingestion,
		torrentTransport: f.transport,
		createClient: () => f.client,
		transport: { fetch: vi.fn(), close: async () => {} },
		autoStart: false,
	});
	cleanup.push(() => module.close());
	const auth = await createAuthenticationModule({
		logger,
		dataDir: f.dir,
		store: f.db.authentication,
		secure: false,
		sources: { version: async () => "one" },
	});
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		policy: builtinPolicy,
		configure: auth.registerHttp,
		registrations: [module.registerHttp],
		closeDependencies: async () => {},
	});
	cleanup.push(() => app.close());
	const headers = { host: "127.0.0.1:3000" },
		url = "/api/acquisition/downloads/settings";
	expect((await app.inject({ url, headers })).statusCode).toBe(401);
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
		},
		mutation = { ...signed, "x-csrf-token": login.json().csrfToken };
	expect(
		(
			await app.inject({
				method: "PUT",
				url,
				headers: signed,
				payload: { revision: null, scopeId: "root", path: "/downloads" },
			})
		).statusCode,
	).toBe(403);
	const result = await app.inject({
		method: "PUT",
		url,
		headers: mutation,
		payload: { revision: null, scopeId: "root", path: "/downloads" },
	});
	expect(result.statusCode).toBe(200);
	expect(
		(
			await app.inject({
				method: "PUT",
				url,
				headers: mutation,
				payload: { revision: null, scopeId: "root", path: "/other" },
			})
		).statusCode,
	).toBe(409);
	const activity = await app.inject({
		url: `/api/acquisition/downloads?workKey=${key}`,
		headers: signed,
	});
	expect(activity.statusCode).toBe(200);
	expect(activity.json()).toMatchObject({ authorized: false, items: [] });
	expect(activity.body).not.toContain("secret");
});

test("an ingested resource leaves the worker and remains historical activity during later outages or removal", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	await f.worker.tick();
	const calls = vi.mocked(f.client.task).mock.calls.length;
	vi.mocked(f.client.task).mockRejectedValue(
		new QbittorrentError("unavailable", "read"),
	);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.state).toBe("available");
	expect(vi.mocked(f.client.task).mock.calls).toHaveLength(calls);
	f.ingestion.available.mockResolvedValueOnce(false);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		state: "available",
		ingestion: "available",
		error: null,
	});
	expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);
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
			category: "external",
			tags: [],
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

test("account changes block stale bindings until explicit recovery reconciles the owned hash in the new connection", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.changeAccount();
	await f.worker.tick();
	let item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error();
	expect(item).toMatchObject({
		state: "blocked",
		error: "downloader_configuration_changed",
	});
	expect((await f.worker.settings()).destination?.validated).toBe(false);
	await f.configure();
	await f.authorize();
	item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error();
	f.worker.retry(item.id, item.revision, "recover-connection", "acquisition");
	await f.worker.tick();
	expect(
		f.db.acquisitionDownloads.activity(key, 1, 100).items[0],
	).toMatchObject({
		state: "bound",
		destination: { connectionGeneration: "account-2" },
	});
	expect(f.add).toHaveBeenCalledTimes(1);
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
test("download activity paginates one work with stable ordering and summaries across every page", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	const original = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!original) throw new Error();
	const records = [original];
	for (let index = 0; index < 25; index++) {
		const item = {
			...original,
			id: `page-${String(index).padStart(2, "0")}`,
			hash: `unresolved:page-${index}`,
			episode: index + 100,
			candidateId: `candidate-${index}`,
			createdAt: original.createdAt + Math.floor(index / 2),
			state: index % 2 ? ("blocked" as const) : ("available" as const),
			error: index % 2 ? "test_failure" : null,
		};
		expect(f.db.acquisitionDownloads.reserve(item)).toBe(true);
		records.push(item);
	}
	expect(
		f.db.acquisitionDownloads.reserve({
			...original,
			id: "foreign",
			workKey: "anilist:anime:2",
			hash: "unresolved:foreign",
		}),
	).toBe(true);
	const expected = records.sort(
		(a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
	);
	const pages = [1, 2, 3, 4].map((page) =>
		f.db.acquisitionDownloads.activity(key, page, 7),
	);
	expect(pages.flatMap((page) => page.items.map((item) => item.id))).toEqual(
		expected.map((item) => item.id),
	);
	for (const page of pages) {
		expect(page).toMatchObject({ total: 26, active: 1, attention: 12 });
		expect(page.candidateIds).toHaveLength(26);
	}
	expect(f.worker.activity(key, 2).items).toHaveLength(6);
	expect(
		f.db.acquisitionDownloads.activity("anilist:anime:999", 1, 20),
	).toEqual({ items: [], total: 0, active: 0, attention: 0, candidateIds: [] });
});

test("worker queries use bounded cursors, retain reservations and redact only expired terminal evidence", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	const original = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!original) throw new Error();
	const states = [
		"bound",
		"available",
		"pending",
		"unknown",
		"missing",
		"blocked",
	] as const;
	for (const [index, state] of states.entries()) {
		f.db.acquisitionDownloads.reserve({
			...original,
			id: `!batch-${index}`,
			hash: `unresolved:!batch-${index}`,
			episode: index + 100,
			state,
			nextAttemptAt: index === 2 ? original.updatedAt + 1000 : 0,
		});
	}
	const batch = f.db.acquisitionDownloads.workBatch("", 2, original.updatedAt);
	expect(batch.map((item) => item.id)).toEqual(["!batch-0", "!batch-3"]);
	const next = f.db.acquisitionDownloads.workBatch(
		"!batch-3",
		2,
		original.updatedAt,
	);
	expect(next.map((item) => item.id)).toEqual([original.id]);
	expect(f.db.acquisitionDownloads.hasActive()).toBe(true);
	expect(f.db.acquisitionDownloads.reservedEpisode(key, 104)).toBe(true);
	expect(
		f.db.acquisitionDownloads.hashOwner("unresolved:!batch-4", "other"),
	).toBe(true);
	expect(
		f.db.acquisitionDownloads.hashOwner("unresolved:!batch-4", "!batch-4"),
	).toBe(false);
	f.db.acquisitionDownloads.prune(original.updatedAt + 1);
	expect(f.db.acquisitionDownloads.intent("!batch-1")).toMatchObject({
		source: "",
		title: "",
		transfer: null,
		error: null,
		state: "available",
	});
	expect(f.db.acquisitionDownloads.intent("!batch-4")).toMatchObject({
		source: "",
		state: "missing",
	});
	expect(f.db.acquisitionDownloads.intent("!batch-5")?.source).toBe(
		original.source,
	);
	expect(f.db.acquisitionDownloads.reservedEpisode(key, 104)).toBe(true);
	expect(
		f.db.acquisitionDownloads.reserve({
			...original,
			id: "duplicate",
			hash: "another",
			episode: 104,
		}),
	).toBe(false);
});

test("late remote failures cannot overwrite a newer explicit acquisition retry", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.add.mockRejectedValueOnce(new QbittorrentError("timeout", "unknown"));
	await f.worker.tick();
	f.advance();
	vi.mocked(f.client.task).mockImplementationOnce(async () => {
		const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
		if (!item) throw new Error();
		f.worker.retry(item.id, item.revision, "newer-command", "acquisition");
		throw new QbittorrentError("unavailable", "read");
	});
	await f.worker.tick();
	expect(
		f.db.acquisitionDownloads.activity(key, 1, 100).items[0],
	).toMatchObject({
		state: "pending",
		error: null,
		nextAttemptAt: 0,
		lastCommand: { id: "newer-command" },
	});
	expect(f.add).toHaveBeenCalledTimes(1);
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(2);
});

test("definitive submission failures retain retryable intent after the submitting revision is persisted", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.add.mockRejectedValueOnce(new QbittorrentError("unavailable", "rejected"));
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

test("completed downloads are excluded from all subsequent worker batches", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	await f.worker.tick();
	const original = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!original) throw new Error();
	for (let index = 0; index < 7; index++) {
		expect(
			f.db.acquisitionDownloads.reserve({
				...original,
				id: `available-${index}`,
				hash: `reserved-${index}`,
				episode: index + 100,
			}),
		).toBe(true);
	}
	const read = vi.spyOn(f.db.acquisitionDownloads, "workBatch");
	const first = f.worker.tick(),
		second = f.worker.tick();
	expect(first).toBe(second);
	await first;
	expect(f.ingestion.available).not.toHaveBeenCalled();
	expect(read).toHaveReturnedWith([]);
	expect(f.db.acquisitionDownloads.hasActive()).toBe(false);
});

test("transfer completion returns evidence without invoking resource verification or Anime ingestion", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error("Missing intent");
	const context = new DownloadContext({
		store: f.db.acquisitionDownloads,
		transport: f.reader,
		connectionGeneration: () => item.destination.connectionGeneration,
		withClient: async (_generation, operation) => operation(f.client),
		logger,
	});
	const authorize = vi.fn(async () => item.subscriptionRevision);
	const transfer = new DownloadTransfers(context, { authorize });
	const completed = await transfer.run(new DownloadExecution(context, item));
	expect(completed?.files).toHaveLength(1);
	expect(f.resources.inspect).not.toHaveBeenCalled();
	expect(f.resources.refresh).not.toHaveBeenCalled();
	expect(f.ingestion.ingest).not.toHaveBeenCalled();
	expect(authorize).not.toHaveBeenCalled();
	expect(await completed?.verify()).toBe(true);
	vi.mocked(f.client.files).mockResolvedValueOnce([]);
	expect(await completed?.verify()).toBe(false);
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("transfer reconciles uncertain attempts without consulting subscription admission or resending", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	f.add.mockRejectedValueOnce(new QbittorrentError("timeout", "unknown"));
	await f.worker.tick();
	const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error("Missing intent");
	expect(item.state).toBe("unknown");
	const context = new DownloadContext({
		store: f.db.acquisitionDownloads,
		transport: f.reader,
		connectionGeneration: () => item.destination.connectionGeneration,
		withClient: async (_generation, operation) => operation(f.client),
		logger,
	});
	const authorize = vi.fn(async () => {
		throw new Error("Admission must not run for uncertain attempts");
	});
	const transfer = new DownloadTransfers(context, { authorize });
	expect(await transfer.run(new DownloadExecution(context, item))).toBeNull();
	expect(authorize).not.toHaveBeenCalled();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.db.acquisitionDownloads.intent(item.id)?.state).toBe("unknown");
});

test("account replacement during ingestion cannot acknowledge the old download as available", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	f.ingestion.ingest.mockImplementationOnce(async () => {
		f.changeAccount();
		return "available";
	});
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		state: "bound",
		ingestion: "failed",
		error: "downloader_configuration_changed",
	});
	expect(f.db.acquisitionDownloads.destination()?.visibilityVerified).toBe(
		false,
	);
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("bundled destination selects the matching root, retries failed validation, and keeps its revision", async () => {
	const f = await fixture(false, true);
	f.probe.mockRejectedValueOnce(new QbittorrentError("unavailable", "read"));
	await f.worker.tick();
	const pending = (await f.worker.settings()).destination;
	expect(pending).toMatchObject({
		scopeId: "root",
		path: "/data/media",
		validated: false,
	});
	await f.worker.tick();
	const ready = (await f.worker.settings()).destination;
	expect(ready).toMatchObject({
		revision: pending?.revision,
		validated: true,
		visibilityVerified: false,
	});
	await f.worker.tick();
	expect((await f.worker.settings()).destination?.revision).toBe(
		ready?.revision,
	);
	expect(f.add).not.toHaveBeenCalled();
});

function seedSubscription(
	store: import("../src/modules/acquisition/persistence.js").AcquisitionStore,
	subscription: Parameters<typeof store.saveSubscription>[0],
	feed: import("../src/modules/acquisition/sources/persistence.js").FeedRecord,
	candidates: Parameters<typeof store.saveSubscription>[1],
) {
	store.transaction(() => {
		store.saveFeed(feed);
		store.saveSubscription(subscription, candidates);
	});
}

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

test("direct save flows through background selection, one download and verified ingestion", async () => {
	const f = await fixture();
	f.db.acquisition.remove(
		key,
		f.db.acquisition.subscription(key)?.revision ?? "",
	);
	await writeFile(
		join(f.dir, "acquisition-profiles.yaml"),
		"version: 1\nprofiles:\n  - id: custom:any\n    name: Any\n    levels:\n      - name: Any\n        match: {}\n        acceptAfterMinutes: 0\n",
	);
	vi.useFakeTimers();
	let module: Awaited<ReturnType<typeof connectedModule>> | undefined;
	try {
		module = await connectedModule(f, true);
		const downloads = module.api.downloads;
		if (!downloads) throw new Error();
		const destination = await downloads.saveDestination({
			revision: null,
			scopeId: "root",
			path: "/downloads",
		});
		await downloads.validate(destination.revision);
		const calls = f.anime.target.mock.calls.length;
		const saved = await module.api.subscriptions.save({
			workKey: key,
			source: { kind: "feed" as const, url: "https://example.org/automatic" },
			startEpisode: 1,
			profileId: "custom:any",
			revision: null,
			destinationRevision: destination.revision,
			connectionGeneration: module.api.connection.settings().generation,
		});
		expect(saved.candidates).toEqual([]);
		expect(f.anime.target).toHaveBeenCalledTimes(calls);
		expect(f.add).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f.add).toHaveBeenCalledTimes(1);
		expect(downloads.activity(key).items[0]?.state).toBe("bound");
		f.complete();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);
		expect(downloads.activity(key).items[0]).toMatchObject({
			state: "available",
			ingestion: "available",
		});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f.add).toHaveBeenCalledTimes(1);
		expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);
	} finally {
		await module?.close();
		vi.useRealTimers();
	}
});
