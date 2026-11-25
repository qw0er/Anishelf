import { createHash, randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { QBittorrent } from "@ctrl/qbittorrent";
import { toTorrentFile } from "parse-torrent";
import { afterEach, expect, test, vi } from "vitest";
import { workDirectory } from "../../../../src/modules/acquisition/downloads/domain/paths.js";
import { inspectTorrentContent } from "../../../../src/modules/acquisition/downloads/infrastructure/torrent.js";
import { ManifestPreview } from "../../../../src/modules/acquisition/manifest-preview.js";
import { JackettConnection } from "../../../../src/modules/acquisition/sources/jackett/connection.js";
import { createQbittorrentClient } from "../../../../src/modules/acquisition/torrent-clients/create.js";
import { TorrentError } from "../../../../src/modules/acquisition/torrent-clients/public.js";
import {
	frierenSeasonPackFixture,
	loadReleaseCorpus,
} from "../../../support/anime-release-corpus.js";
import {
	cleanup,
	fixture,
	key,
	logger,
	setupTestLifecycle,
} from "./support/acquisition-downloads-fixture.js";

import { packCatalog } from "./support/season-pack-catalog.js";

setupTestLifecycle();
afterEach(() => vi.restoreAllMocks());

const url = process.env.ANISHELF_TEST_QBITTORRENT_URL;

test.skipIf(!url)(
	"a live qBittorrent task expands from E03 to a season and recovers after restart",
	async () => {
		if (!url) throw new Error("Missing isolated qBittorrent URL.");
		const username = process.env.ANISHELF_TEST_QBITTORRENT_USERNAME ?? "";
		const password = process.env.ANISHELF_TEST_QBITTORRENT_PASSWORD ?? "";
		const client = createQbittorrentClient({
			url,
			username,
			password,
			logger,
			timeoutMs: 5_000,
		});
		const sdk = new QBittorrent({
			baseUrl: url,
			username,
			password,
			timeout: 5_000,
		});
		cleanup.push(() => client.close());
		const probe = await client.probe();
		expect(probe.selectiveFiles).toBe(true);
		expect(probe.incompleteDirectory).toBeTruthy();

		const pack = frierenSeasonPackFixture(await loadReleaseCorpus());
		const target = {
			...pack.target,
			work: { ...pack.target.work, episodeCount: 12 },
		};
		const episodes = Array.from({ length: 12 }, (_, index) => index + 1);
		const name = "Sousou no Frieren Season 2";
		const files = episodes.flatMap((episode) => {
			const stem = String(episode).padStart(2, "0");
			return [`${stem}.mkv`, `${stem}.zh.ass`].map((path, index) => ({
				path,
				episode,
				bytes: Buffer.alloc(16384, episode * 2 + index),
			}));
		});
		const bytes = new Uint8Array(
			toTorrentFile({
				infoHash: "",
				announce: [],
				urlList: [],
				info: {
					name: Buffer.from(name),
					files: files.map(({ path, bytes }) => ({
						path: [Buffer.from(path)],
						length: bytes.length,
					})),
					"piece length": 16384,
					pieces: Buffer.concat(
						files.map(({ bytes }) => createHash("sha1").update(bytes).digest()),
					),
					private: 1,
					source: Buffer.from(randomUUID()),
				},
			}),
		);
		const { hash } = await inspectTorrentContent(
			{ kind: "bytes", bytes },
			null,
		);

		const preview = new ManifestPreview(
			{
				connectionGeneration: () => "account-1",
				withClient: (_generation, operation) => operation(client),
			},
			pack.mapReleaseFiles,
			logger,
		);
		cleanup.push(async () => preview.close());
		const f = await fixture(true, false, preview, pack.mapReleaseFiles);
		cleanup.push(async () => {
			if ((await client.task(hash))?.ownerKey)
				await sdk.removeTorrent(hash, false);
		});
		f.db.acquisition.remove(
			key,
			f.db.acquisition.subscription(key)?.revision ?? "",
		);
		f.anime.target.mockResolvedValue(target);
		f.anime.assessReleaseTitle.mockImplementation(pack.assessReleaseTitle);
		f.probe.mockImplementation(client.probe.bind(client));
		f.add.mockImplementation(client.add.bind(client));
		vi.spyOn(f.client, "tasks").mockImplementation(client.tasks.bind(client));
		vi.spyOn(f.client, "task").mockImplementation(client.task.bind(client));
		vi.spyOn(f.client, "files").mockImplementation(client.files.bind(client));
		if (!client.inspectMetadata) throw new Error("Missing metadata API.");
		f.client.inspectMetadata = client.inspectMetadata.bind(client);
		const enable = client.enableFiles?.bind(client);
		if (!enable) throw new Error("Missing selective download API.");
		f.client.enableFiles = enable;
		vi.spyOn(JackettConnection.prototype, "readTorrent").mockResolvedValue({
			kind: "bytes",
			bytes,
		});
		await f.sources.connector.save({
			generation: f.sources.connector.settings().generation,
			url: "http://jackett:9117",
			apiKey: "test",
			origin: "external",
			providers: ["site"],
		});
		vi.spyOn(JackettConnection.prototype, "search").mockResolvedValue({
			entries: [
				{
					id: "pack",
					observationId: "pack",
					title: pack.title,
					hash,
					publishedAt: null,
					downloadUrl: "https://fixtures.example/season.torrent",
					download: {
						kind: "public-torrent",
						url: "https://fixtures.example/season.torrent",
					},
				},
			],
			coverage: { limited: false, reason: null, pages: 1, queries: 1 },
			outcome: "matches",
		});

		const destination = join(f.dir, "library");
		await mkdir(destination);
		const { connect, reference } = await packCatalog(f, target, {
			destination,
			sizeBytes: 16384,
		});
		let catalog = connect();
		const savePath = join(
			destination,
			workDirectory(key, target.work.titles[0] ?? "Anime"),
		);
		let broken = false;
		f.resources.inspect.mockImplementation(async (_scope, relativePath) => {
			if (!relativePath || (broken && relativePath.endsWith("/08.mkv")))
				throw new Error("unreadable test file");
			return {
				sizeBytes: (await stat(join(destination, relativePath))).size,
				sourceVersion: "v1",
			};
		});
		f.resources.inspectSubtitle.mockImplementation(
			async (_scope, relativePath) => ({
				sizeBytes: (await stat(join(destination, relativePath))).size,
				sourceVersion: "v1",
			}),
		);
		const available = async () =>
			(await catalog.availableEpisodes(reference)).episodes;
		f.anime.target.mockImplementation(async () => ({
			...target,
			availableEpisodes: await available(),
		}));

		const deposit = async (selected: readonly number[]) => {
			for (const file of files.filter(({ episode }) =>
				selected.includes(episode),
			)) {
				const path = join(savePath, name, file.path);
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, file.bytes);
			}
		};
		const request = (episode: number) =>
			f.worker.requestEpisode({
				workKey: key,
				episode,
				commandId: randomUUID(),
			});
		const activity = () => f.worker.activity(key).items;
		const priorities = async () =>
			(await client.files(hash))
				.filter(({ selected }) => selected)
				.map(({ path }) => path)
				.sort();
		const pending = () =>
			f.db.acquisitionDownloads.ownedFileSelection(hash, "account-1")?.pending;

		await deposit([3]);
		const original = await request(3);
		await vi.waitFor(
			async () => {
				f.advance();
				await f.worker.tick();
				expect(
					activity().find(({ id }) => id === original.intentId),
				).toMatchObject({ state: "available", error: null });
				expect(await priorities()).toEqual([
					`${name}/03.mkv`,
					`${name}/03.zh.ass`,
				]);
			},
			{ timeout: 12_000, interval: 100 },
		);

		expect(await available()).toEqual([3]);
		const originalIdentity = f.db.acquisitionDownloads.intent(
			original.intentId,
		)?.sourceIdentity;
		if (!originalIdentity) throw new Error("Missing verified E03 source.");
		const originalAssociation = await catalog.source(originalIdentity.fileId);

		let subscriptions = f.subscriptions(preview);
		const view = await subscriptions.save({
			workKey: key,
			revision: null,
			startEpisode: 1,
			target: null,
			source: { kind: "automatic" },
		});
		const revision = view.subscription?.revision;
		if (!revision) throw new Error("Missing subscription revision.");
		await subscriptions.refresh(key, revision);
		await f.authorize();
		f.advance();
		const bound = subscriptions.get(key).subscription;
		if (!bound?.feedId) throw new Error("Verified pack did not bind a source.");
		await subscriptions.refresh(key, bound.revision);

		let joined: Awaited<ReturnType<typeof request>> | undefined;
		f.client.enableFiles = async (...args) => {
			joined = await request(4);
			await enable(...args);
			throw new TorrentError("timeout", "unknown");
		};
		await f.worker.tick();
		expect(joined?.existing).toBe(true);
		expect(joined?.intentId).toBe(
			activity().find(({ episode }) => episode === 4)?.id,
		);
		expect(pending()).toMatchObject({
			kind: "expand",
			sentAt: expect.any(Number),
		});
		expect(await priorities()).toEqual(
			files.map(({ path }) => `${name}/${path}`).sort(),
		);

		await subscriptions.close();
		catalog.close();
		await f.restart();
		catalog = connect();
		subscriptions = f.subscriptions(preview);
		f.client.enableFiles = enable;
		f.advance();
		await f.worker.tick();
		expect(pending()).toBeNull();
		expect(
			(await client.tasks()).filter((task) => task.hash === hash),
		).toHaveLength(1);
		expect(f.add).toHaveBeenCalledTimes(1);

		broken = true;
		await deposit(episodes);
		await sdk.version();
		await sdk.recheckTorrent(hash);
		await vi.waitFor(
			async () => {
				f.advance();
				await f.worker.tick();
				expect((await available()).sort((a, b) => a - b)).toEqual(
					episodes.filter((episode) => episode !== 8),
				);
				expect(activity().find(({ episode }) => episode === 8)?.ingestion).toBe(
					"failed",
				);
			},
			{ timeout: 12_000, interval: 100 },
		);
		await subscriptions.checkCompletion();
		expect(subscriptions.get(key).subscription?.runState).toBe("active");

		broken = false;
		const failed = activity().find(({ episode }) => episode === 8);
		if (!failed) throw new Error("Missing failed import.");
		f.worker.retry(failed.id, failed.revision, randomUUID(), "import");
		await vi.waitFor(
			async () => {
				f.advance();
				await f.worker.tick();
				expect((await available()).sort((a, b) => a - b)).toEqual(episodes);
			},
			{ timeout: 12_000, interval: 100 },
		);
		await subscriptions.checkCompletion();
		expect(subscriptions.get(key).subscription?.runState).toBe("completed");
		expect(activity().find(({ episode }) => episode === 3)?.id).toBe(
			original.intentId,
		);
		expect(await catalog.source(originalIdentity.fileId)).toEqual(
			originalAssociation,
		);
		expect(
			f.ingestion.ingest.mock.calls.filter(([, episode]) => episode === 3),
		).toHaveLength(1);
	},
	35_000,
);
