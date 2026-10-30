import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, vi } from "vitest";
import { ApplicationDatabase } from "../../../../../src/app/bootstrap/database.js";
import { createAcquisitionModule } from "../../../../../src/modules/acquisition/create.js";
import { DownloadsApplication } from "../../../../../src/modules/acquisition/downloads/application/application.js";
import type { TorrentReader } from "../../../../../src/modules/acquisition/downloads/public.js";
import { SourceContent } from "../../../../../src/modules/acquisition/sources/application/content.js";
import type { TorrentClient } from "../../../../../src/modules/acquisition/torrent-clients/public.js";
import type { AcquisitionTarget } from "../../../../../src/modules/anime/public.js";

export const cleanup: (() => Promise<unknown>)[] = [];

export const key = "anilist:anime:1",
	hash = "a".repeat(40);

export const target: AcquisitionTarget = {
	work: {
		reference: { id: "1" },
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

export const logger = pino({ level: "silent" });

export function readerFor(transport: {
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

export async function fixture(persistent = false, bundled = false) {
	const dir = await mkdtemp(join(tmpdir(), "anishelf-downloads-"));
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	let db = persistent
		? ApplicationDatabase.open(dir)
		: ApplicationDatabase.openMemory();
	cleanup.push(async () => db.close());
	let now = 1_000_000,
		generation = "account-1";
	const state: { task: Awaited<ReturnType<TorrentClient["task"]>> } = {
		task: null,
	};
	const probe = vi.fn<TorrentClient["probe"]>(async () => ({
		version: "5.0.5",
		incompleteDirectory: "/incomplete",
	}));
	const add = vi.fn<TorrentClient["add"]>(async (input) => {
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
			ownerKey: input.ownerKey,
		};
	});
	const client: TorrentClient = {
		probe,
		add,
		task: vi.fn(async () => state.task),
		tasks: vi.fn(async () => (state.task ? [state.task] : [])),
		files: vi.fn(async () => [
			{
				path: "Frieren - 03.mkv",
				sizeBytes: 100,
				progress: 1,
				selected: true,
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
		new SourceContent(
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
		if (!subscription?.feedId || !destination?.validated)
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
			state: "seeding",
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

export async function connectedModule(
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

export function seedSubscription(
	store: import("../../../../../src/modules/acquisition/persistence.js").AcquisitionStore,
	subscription: Parameters<typeof store.saveSubscription>[0],
	feed: import("../../../../../src/modules/acquisition/sources/persistence.js").FeedRecord,
	candidates: Parameters<typeof store.saveSubscription>[1],
) {
	store.transaction(() => {
		store.saveFeed(feed);
		store.saveSubscription(subscription, candidates);
	});
}

export function setupTestLifecycle() {
	afterEach(async () => {
		for (const close of cleanup.splice(0).reverse()) await close();
	});
}
