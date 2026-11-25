import { randomUUID } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, test, vi } from "vitest";
import { ManifestPreview } from "../../../../src/modules/acquisition/manifest-preview.js";
import { JackettConnection } from "../../../../src/modules/acquisition/sources/jackett/connection.js";
import {
	type TorrentClient,
	TorrentError,
	type TorrentManifest,
} from "../../../../src/modules/acquisition/torrent-clients/public.js";
import { AnimeCatalogApplication } from "../../../../src/modules/anime/anime-catalog/application/catalog.js";
import type { CatalogMetadata } from "../../../../src/modules/anime/anime-catalog/public.js";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import { AcquisitionIngestion } from "../../../../src/modules/anime/release-assessment/ingestion.js";
import type {
	ResourceAccessApi,
	SourceIdentity,
} from "../../../../src/modules/resources/public.js";
import {
	frierenSeasonPackFixture,
	loadReleaseCorpus,
} from "../../../support/anime-release-corpus.js";
import { fixtureIdentities } from "../../../support/metadata-identities.js";
import {
	cleanup,
	fixture,
	fixturePath,
	hash,
	key,
	logger,
	setupTestLifecycle,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();
afterEach(() => vi.restoreAllMocks());

const frieren = frierenSeasonPackFixture(await loadReleaseCorpus());
const paths = [
	"01.mkv",
	"03.mkv",
	"03.zh.ass",
	"04.mkv",
	"04.zh.ass",
	"NCOP.mkv",
];
async function setup(
	packPaths = paths,
	episodeCount = frieren.target.work.episodeCount,
) {
	const files = packPaths.map((name, index) => ({
		index,
		path: `Season 2/${name}`,
		sizeBytes: 100,
	}));
	const manifest = {
		hash,
		indexSource: "client",
		files,
	} satisfies TorrentManifest;
	let preview: ManifestPreview;
	const f = await fixture(
		true,
		false,
		{ preview: (input) => preview.preview(input) },
		frieren.mapReleaseFiles,
	);
	preview = new ManifestPreview(
		{
			connectionGeneration: () => "account-1",
			withClient: (_generation, operation) => operation(f.client),
		},
		frieren.mapReleaseFiles,
		logger,
	);
	cleanup.push(async () => preview.close());
	const target = {
		...frieren.target,
		work: { ...frieren.target.work, episodeCount },
	};
	f.anime.target.mockResolvedValue(target);
	f.anime.assessReleaseTitle.mockImplementation(frieren.assessReleaseTitle);
	f.db.acquisition.remove(
		key,
		f.db.acquisition.subscription(key)?.revision ?? "",
	);
	await f.configure();
	await f.sources.connector.save({
		generation: f.sources.connector.settings().generation,
		url: "http://jackett:9117",
		apiKey: "private-key",
		origin: "external",
		providers: ["first"],
	});
	vi.spyOn(JackettConnection.prototype, "search").mockResolvedValue({
		entries: [
			{
				id: "pack",
				observationId: "pack",
				title: frieren.title,
				hash,
				publishedAt: null,
				downloadUrl: null,
				download: { kind: "magnet", uri: `magnet:?xt=urn:btih:${hash}` },
				seeders: 10,
				seedersObservedAt: 1_000_000,
			},
		],
		coverage: { limited: false, reason: null, pages: 1, queries: 1 },
		outcome: "matches",
	});
	f.probe.mockResolvedValue({
		version: "5.2.0",
		incompleteDirectory: fixturePath("incomplete"),
		selectiveFiles: true,
	});
	const priorities = files.map(() => 0);
	const progress = files.map(() => 0);
	f.client.inspectMetadata = vi.fn(async () => manifest);
	vi.spyOn(f.client, "files").mockImplementation(async () =>
		files.map((file, i) => ({
			...file,
			progress: progress[i] ?? 0,
			priority: priorities[i] ?? 0,
			selected: (priorities[i] ?? 0) > 0,
		})),
	);
	const add = f.add.getMockImplementation();
	if (!add) throw new Error("Missing fixture add.");
	const receiveAdd: TorrentClient["add"] = async (input, signal) => {
		if (!input.fileSelection) throw new Error("Expected initial priorities.");
		priorities.splice(0, priorities.length, ...input.fileSelection.priorities);
		await add(input, signal);
		if (f.state.task)
			f.state.task = {
				...f.state.task,
				name: frieren.title,
				contentPath: join(input.savePath, "Season 2"),
			};
	};
	f.add.mockImplementation(receiveAdd);
	const receiveExpansion: NonNullable<TorrentClient["enableFiles"]> = async (
		_hash,
		added,
	) => {
		for (const index of added) priorities[index] = 1;
	};
	const enable = vi.fn(receiveExpansion);
	f.client.enableFiles = enable;
	const request = (episode: number) =>
		f.worker.requestEpisode({ workKey: key, episode, commandId: randomUUID() });
	const item = (episode: number) =>
		f.worker.activity(key).items.find((item) => item.episode === episode);
	const selection = () =>
		f.db.acquisitionDownloads.ownedFileSelection(hash, "account-1");
	const complete = async (...indices: number[]) => {
		for (const index of indices) progress[index] = 1;
		f.complete();
		await f.worker.tick();
	};
	return {
		f,
		target,
		progress,
		priorities,
		enable,
		request,
		item,
		selection,
		complete,
		receiveAdd,
		receiveExpansion,
	};
}

test("requests E03 then extends its completed task for E04 and their respective sidecars", async () => {
	const { f, request, item, selection, priorities, enable, complete } =
		await setup();
	const first = await request(3);
	await f.worker.tick();
	expect(item(3)).toMatchObject({ state: "bound" });
	expect(priorities).toEqual([0, 1, 1, 0, 0, 0]);
	const transferId = selection()?.id;
	expect(transferId).toBeTruthy();
	await complete(1, 2);
	expect(item(3)).toMatchObject({ state: "available" });
	expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);

	const second = await request(4);
	await f.worker.tick();
	expect(item(4)).toMatchObject({ state: "bound" });
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(enable).toHaveBeenCalledExactlyOnceWith(
		hash,
		[3, 4],
		expect.any(AbortSignal),
	);
	expect(priorities).toEqual([0, 1, 1, 1, 1, 0]);
	expect(selection()).toMatchObject({ id: transferId, pending: null });
	expect(selection()?.observed?.map(({ priority }) => priority)).toEqual(
		priorities,
	);
	for (const request of [first, second])
		expect(f.db.acquisitionDownloads.intent(request.intentId)?.transferId).toBe(
			transferId,
		);
	await complete(3, 4);
	expect(item(3)).toMatchObject({ state: "available" });
	expect(item(4)).toMatchObject({ state: "available" });
	expect(f.ingestion.ingest).toHaveBeenCalledTimes(2);
});

test.each(["add", "expand"] as const)(
	"lost %s response is reconciled across restart without a duplicate submission",
	async (kind) => {
		const {
			f,
			request,
			item,
			selection,
			priorities,
			enable,
			receiveAdd,
			receiveExpansion,
		} = await setup();
		const episode = kind === "add" ? 3 : 4;
		if (kind === "add") {
			f.add.mockImplementationOnce(async (...args) => {
				await receiveAdd(...args);
				throw new TorrentError("timeout", "unknown");
			});
		} else {
			await request(3);
			await f.worker.tick();
			enable.mockImplementationOnce(async (...args) => {
				await receiveExpansion(...args);
				throw new TorrentError("timeout", "unknown");
			});
		}
		const accepted = await request(episode);
		await f.worker.tick();
		expect(item(episode)).toMatchObject({ state: "unknown" });
		expect(selection()?.pending).toMatchObject({
			kind,
			requestId: accepted.intentId,
			sentAt: expect.any(Number),
		});
		await f.restart();
		f.advance();
		await f.worker.tick();
		expect(item(episode)).toMatchObject({ state: "bound" });
		expect(selection()?.pending).toBeNull();
		expect(selection()?.observed?.map(({ priority }) => priority)).toEqual(
			priorities,
		);
		expect(f.add).toHaveBeenCalledTimes(1);
		expect(enable).toHaveBeenCalledTimes(kind === "expand" ? 1 : 0);
	},
);

test("a lost add with no identifiable task stays uncertain across restart", async () => {
	const { f, request, item, selection } = await setup();
	f.add.mockRejectedValueOnce(new TorrentError("timeout", "unknown"));
	await request(3);
	await f.worker.tick();
	await f.restart();
	f.advance();
	await f.worker.tick();
	expect(item(3)).toMatchObject({
		state: "unknown",
		error: "submission_unconfirmed",
	});
	expect(selection()?.pending).toMatchObject({
		kind: "add",
		sentAt: expect.any(Number),
	});
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("a lost expansion is retried only after reading the same original priorities", async () => {
	const { f, request, item, enable, priorities } = await setup();
	await request(3);
	await f.worker.tick();
	enable.mockRejectedValueOnce(new TorrentError("timeout", "unknown"));
	await request(4);
	await f.worker.tick();
	expect(item(4)).toMatchObject({ state: "unknown" });
	expect(priorities).toEqual([0, 1, 1, 0, 0, 0]);
	await f.restart();
	await f.worker.tick();
	expect(enable).toHaveBeenCalledTimes(1);
	f.advance();
	await f.worker.tick();
	expect(item(4)).toMatchObject({ state: "bound" });
	expect(priorities).toEqual([0, 1, 1, 1, 1, 0]);
	expect(enable.mock.calls.map(([, indices]) => indices)).toEqual([
		[3, 4],
		[3, 4],
	]);
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("confirmed removal releases a completed transfer while preserving its imported episode", async () => {
	const { f, request, item, selection, priorities, enable, complete } =
		await setup();
	await request(3);
	await f.worker.tick();
	await complete(1, 2);
	const previous = selection()?.id;
	expect(previous).toBeTruthy();
	f.state.task = null;
	await request(4);
	await f.worker.tick();
	expect(item(3)).toMatchObject({ state: "available" });
	expect(item(4)).toMatchObject({ state: "bound" });
	expect(selection()?.id).not.toBe(previous);
	expect(f.add).toHaveBeenCalledTimes(2);
	expect(enable).not.toHaveBeenCalled();
	expect(priorities).toEqual([0, 0, 0, 1, 1, 0]);
});

test("competing episode commands serialize and duplicate claims join", async () => {
	const { f, request, item, selection, enable, priorities } = await setup();
	const [first, second, duplicate] = await Promise.all([
		request(3),
		request(4),
		request(4),
	]);
	expect(duplicate.intentId).toBe(second.intentId);
	expect(first.intentId).not.toBe(second.intentId);
	for (let index = 0; index < 3; index++) {
		await f.worker.tick();
		f.advance();
	}
	expect(item(3)).toMatchObject({ state: "bound" });
	expect(item(4)).toMatchObject({ state: "bound" });
	expect(selection()?.pending).toBeNull();
	expect(priorities).toEqual([0, 1, 1, 1, 1, 0]);
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(enable).toHaveBeenCalledTimes(1);
});

test("a same-hash task with a foreign owner is left untouched", async () => {
	const { f, request, item, selection, enable, receiveAdd, priorities } =
		await setup();
	await receiveAdd({
		source: { magnet: `magnet:?xt=urn:btih:${hash}` },
		savePath: fixturePath("downloads"),
		ownerKey: "external",
		fileSelection: { hash, priorities: [1, 0, 0, 0, 0, 0] },
	});
	await request(3);
	await f.worker.tick();
	expect(item(3)).toMatchObject({
		state: "blocked",
		error: "external_task_conflict",
	});
	expect(selection()).toBeNull();
	expect(f.add).not.toHaveBeenCalled();
	expect(enable).not.toHaveBeenCalled();
	expect(priorities).toEqual([1, 0, 0, 0, 0, 0]);
});

test.each(["destination", "authorization", "priorities"] as const)(
	"expansion preserves E03 when %s changes before the write",
	async (change) => {
		const { f, request, item, selection, enable, priorities, complete } =
			await setup();
		await request(3);
		await f.worker.tick();
		await complete(1, 2);
		await request(4);
		const probe = f.probe.getMockImplementation();
		if (!probe) throw new Error("Missing fixture probe.");
		f.probe
			.mockImplementationOnce(probe)
			.mockImplementationOnce(async (...args) => {
				if (change === "destination") {
					await f.worker.saveDestination({
						revision: f.db.acquisitionDownloads.destination()?.revision ?? null,
						scopeId: "root",
						path: fixturePath("other"),
					});
				} else if (change === "authorization") {
					f.setDefaultProfileId("changed");
				} else {
					priorities[0] = 1;
				}
				return probe(...args);
			});
		await f.worker.tick();
		expect(item(3)).toMatchObject({ state: "available" });
		expect(item(4)).toMatchObject({
			state: "blocked",
			error:
				change === "priorities"
					? "file_selection_changed"
					: "acquisition_configuration_changed",
		});
		expect(f.add).toHaveBeenCalledTimes(1);
		expect(enable).not.toHaveBeenCalled();
		expect(selection()?.pending).toBeNull();
		expect(priorities).toEqual([
			change === "priorities" ? 1 : 0,
			1,
			1,
			0,
			0,
			0,
		]);
	},
);

test("a client without initial priority support cannot submit a pack", async () => {
	const { f, request, item, selection, enable } = await setup();
	f.probe.mockResolvedValue({
		version: "5.0.5",
		incompleteDirectory: fixturePath("incomplete"),
	});
	await request(3);
	await f.worker.tick();
	expect(item(3)).toMatchObject({
		state: "blocked",
		error: "metadata_unsupported",
	});
	expect(selection()).toBeNull();
	expect(f.add).not.toHaveBeenCalled();
	expect(enable).not.toHaveBeenCalled();
});

test("a completed planned file can import while a sibling is still downloading", async () => {
	const { f, request, item, progress } = await setup();
	await request(3);
	await f.worker.tick();
	await request(4);
	await f.worker.tick();
	progress[1] = 1;
	progress[2] = 1;
	progress[3] = 0.4;
	await f.worker.tick();
	expect(f.state.task?.progress).toBeLessThan(1);
	expect(item(3)).toMatchObject({ state: "available", ingestion: "available" });
	expect(item(4)).toMatchObject({
		state: "bound",
		progress: 0,
		selectedFiles: [
			{ path: "Season 2/04.mkv", role: "video", progress: 0.4 },
			{ path: "Season 2/04.zh.ass", role: "subtitle", progress: 0 },
		],
	});
	expect(f.ingestion.ingest.mock.calls.map(([, episode]) => episode)).toEqual([
		3,
	]);
});

test("a selection revision change during import triggers fresh verification", async () => {
	const { f, request, item, selection, complete } = await setup();
	await request(3);
	await f.worker.tick();
	f.ingestion.ingest.mockImplementationOnce(
		async (_work, _episode, _file, _signal, _receipt, guard) => {
			const current = selection();
			if (!current?.observed) throw new Error("Missing managed task.");
			expect(
				f.db.acquisitionDownloads.updateFileSelection({
					transferId: current.id,
					revision: current.revision,
					observed: current.observed,
				}),
			).toBe(true);
			await guard?.verify();
			throw new Error("An outdated plan was accepted.");
		},
	);
	await complete(1, 2);
	expect(item(3)).toMatchObject({
		state: "bound",
		ingestion: "pending",
		error: "file_import_selection_changed",
	});
	f.advance();
	await f.worker.tick();
	expect(item(3)).toMatchObject({ state: "available", error: null });
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("a changed sidecar version prevents the video association until import is retried", async () => {
	const { f, request, item, complete } = await setup();
	await request(3);
	await f.worker.tick();
	f.resources.inspectSubtitle
		.mockResolvedValueOnce({ sizeBytes: 100, sourceVersion: "old" })
		.mockResolvedValue({ sizeBytes: 100, sourceVersion: "new" });
	await complete(1, 2);
	expect(item(3)).toMatchObject({
		ingestion: "failed",
		error: "subtitle_source_changed",
	});
	expect(f.ingestion.ingest).not.toHaveBeenCalled();
	const failed = item(3);
	if (!failed) throw new Error("Missing failed episode.");
	f.worker.retry(failed.id, failed.revision, "recheck-sidecar", "import");
	await f.worker.tick();
	expect(item(3)).toMatchObject({ state: "available" });
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("explicit import retry re-verifies a repaired video version", async () => {
	const { f, request, item, complete } = await setup();
	const accepted = await request(3);
	await f.worker.tick();
	f.ingestion.ingest.mockRejectedValueOnce(new Error("Catalog unavailable"));
	await complete(1, 2);
	expect(f.db.acquisitionDownloads.intent(accepted.intentId)).toMatchObject({
		ingestion: "failed",
		sourceIdentity: { sourceVersion: "v1" },
	});
	f.resources.inspect.mockResolvedValue({
		sizeBytes: 100,
		sourceVersion: "v2",
	});
	f.resources.refresh.mockImplementation(async (_scope, relativePath) => ({
		scopeId: "root",
		fileId: "file",
		relativePath,
		sourceVersion: "v2",
	}));
	const failed = item(3);
	if (!failed) throw new Error("Missing failed video.");
	f.worker.retry(failed.id, failed.revision, "repair-video", "import");
	await f.worker.tick();
	expect(f.db.acquisitionDownloads.intent(accepted.intentId)).toMatchObject({
		ingestion: "available",
		sourceIdentity: { sourceVersion: "v2" },
	});
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("an explicit Catalog rejection releases the claim and skips the rejected pack file on retry", async () => {
	const { f, request, item, complete } = await setup();
	const accepted = await request(3);
	await f.worker.tick();
	f.ingestion.ingest.mockResolvedValueOnce("review");
	f.ingestion.reviewAcquisition.mockResolvedValueOnce({
		id: "review",
		decisionKey: "manual-rejection",
		disposition: "rejected",
	});
	await complete(1, 2);
	expect(item(3)).toMatchObject({
		state: "blocked",
		error: "association_rejected",
		reviewId: "review",
	});
	expect(f.db.acquisitionDownloads.reservedEpisode(key, 3)).toBe(false);
	const blocked = item(3);
	if (!blocked) throw new Error("Missing rejected episode.");
	f.worker.retry(
		blocked.id,
		blocked.revision,
		"try-another-release",
		"acquisition",
	);
	await f.worker.tick();
	expect(f.db.acquisitionDownloads.intent(accepted.intentId)).toMatchObject({
		state: "blocked",
		error: "no_eligible_release",
	});
	expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);
	expect(f.add).toHaveBeenCalledTimes(1);
});

async function packCatalog(
	f: Awaited<ReturnType<typeof setup>>["f"],
	target: Awaited<ReturnType<typeof setup>>["target"],
) {
	const scopeId = "r".repeat(43);
	f.resources.roots.mockResolvedValue([{ scopeId, name: "Anime" }]);
	await f.configure(scopeId);
	const identities = new Map<string, SourceIdentity>();
	const identityFor = (path: string) => {
		const identity = {
			fileId: path,
			relativePath: path,
			scopeId,
			sourceVersion: "v1",
		};
		identities.set(identity.fileId, identity);
		return identity;
	};
	f.resources.refresh.mockImplementation(async (_scope, path) =>
		identityFor(path),
	);
	const resolveSource: ResourceAccessApi["resolveSource"] = async (id) => {
		const identity = identities.get(id);
		if (!identity) throw new Error("Missing fixture source.");
		return {
			identity,
			file: {
				id,
				name: id,
				kind: "file",
				parentId: "directory",
				sizeBytes: 100,
				modifiedAt: new Date(0).toISOString(),
				mimeType: "video/x-matroska",
			},
			accessRevision: 0,
		};
	};
	const sources: ResourceAccessApi = {
		hasSnapshot: true,
		accessRevision: 0,
		getScope: async () => ({ ids: [scopeId], revision: 0 }),
		resolveSource,
		revalidateSource: ({ identity }) => resolveSource(identity.fileId),
		assertAccessRevision: vi.fn(),
		filePath: vi.fn(),
		getFile: vi.fn(),
		openMedia: vi.fn(),
		openResources: vi.fn(),
	};
	const reference = {
		provider: "metadata",
		mediaType: "anime",
		id: target.work.reference.id,
	} as const;
	const data = {
		...target.work,
		reference,
		provider: "metadata",
		unavailableFields: [],
		titles: [{ value: "Frieren", kind: "romaji" as const, language: "en" }],
		status: "FINISHED" as const,
		nextAiringEpisode: null,
		airingSeason: null,
		coverUrl: null,
		bannerUrl: null,
		description: null,
		startDate: null,
		endDate: null,
		durationMinutes: null,
		country: null,
		source: null,
		genres: [],
		tags: [],
		studios: [],
		averageScore: null,
		siteUrl: null,
		providerUpdatedAt: null,
		streamingEpisodes: [],
		episodeCatalog: "unavailable" as const,
	};
	const snapshot = {
		snapshotId: target.work.snapshotId,
		fetchedAt: Date.now(),
		stale: false,
		refreshing: false,
		refreshError: null,
		data,
	};
	f.db.metadata.save({
		id: snapshot.snapshotId,
		key: `metadata:anime:${reference.id}`,
		kind: "detail",
		data,
		fetchedAt: snapshot.fetchedAt,
		expiresAt: snapshot.fetchedAt + 600000,
		accessedAt: snapshot.fetchedAt,
		failure: null,
	});
	const metadata: CatalogMetadata = {
		current: () => snapshot,
		get: async () => snapshot,
		snapshot: () => ({ kind: "detail", ...snapshot }),
		retain: (id, owner) => f.db.metadata.retain(id, owner),
		release: (id, owner) => f.db.metadata.release(id, owner),
		snapshotArtwork: async () => ({
			status: "missing",
			id: null,
			failure: null,
		}),
		readArtwork: vi.fn(),
	};
	const parser = new AnitomyIdentificationParser();
	function connect() {
		const catalog = new AnimeCatalogApplication({
			store: f.db.catalog,
			metadata,
			sources,
			logger,
		});
		cleanup.push(async () => catalog.close());
		const ingestion = new AcquisitionIngestion(
			metadata,
			fixtureIdentities(),
			parser,
			catalog,
			sources,
		);
		f.ingestion.ingest.mockImplementation(ingestion.ingest.bind(ingestion));
		f.ingestion.reviewAcquisition.mockImplementation(
			ingestion.reviewAcquisition.bind(ingestion),
		);
		return catalog;
	}
	return { connect, identityFor, parser, reference };
}

test("one pack imports independently and survives receipt replay, a broken sidecar and protected Review", async () => {
	const episodes = Array.from({ length: 12 }, (_, index) => index + 1);
	const number = (episode: number) => String(episode).padStart(2, "0");
	const { f, request, item, progress, selection, target } = await setup(
		episodes.flatMap((episode) => [
			`${number(episode)}.mkv`,
			`${number(episode)}.zh.ass`,
		]),
		12,
	);
	const { connect, identityFor, parser, reference } = await packCatalog(
		f,
		target,
	);
	let catalog = connect();
	for (const episode of episodes) {
		await request(episode);
		await f.worker.tick();
		expect(item(episode)).toMatchObject({ state: "bound" });
	}
	const managed = selection();
	if (!managed) throw new Error("Missing shared transfer.");
	const identity = (episode: number) =>
		identityFor(`${managed.directory}/Season 2/${number(episode)}.mkv`);

	const protectedFile = identity(5);
	await catalog.publish(
		[
			{
				source: protectedFile,
				evidence: {
					...parser.extractRelease("Frieren - 05.mkv"),
					relativePath: protectedFile.relativePath,
				},
				status: "unresolved",
				metadataStatus: "not-configured",
				proposals: [],
				unresolved: [],
			},
		],
		[protectedFile.scopeId],
	);
	const review = (await catalog.fileReviews([protectedFile.fileId]))[0];
	if (!review) throw new Error("Missing manual review.");
	const confirmManual = async (revision: number, episode: number) => {
		const preview = await catalog.preview({
			reference,
			rows: [
				{
					reviewId: review.id,
					revision,
					targets: [{ kind: "regular", number: String(episode) }],
					reason: "Manual decision",
				},
			],
		});
		await catalog.confirm({
			previewId: preview.id,
			operationKey: `manual-${episode}`,
			replace: true,
		});
	};
	await confirmManual(review.revision, 2);

	let broken = true;
	f.resources.inspectSubtitle.mockImplementation(async (_scope, path) => ({
		sizeBytes: broken && path.endsWith("/04.zh.ass") ? 23 : 100,
		sourceVersion: "v1",
	}));
	const original = f.ingestion.ingest.getMockImplementation();
	if (!original) throw new Error("Missing Catalog ingestion.");
	let announceCommit = () => {};
	const committed = new Promise<void>((resolve) => {
		announceCommit = resolve;
	});
	let continueAcknowledgment = () => {};
	const acknowledge = new Promise<void>((resolve) => {
		continueAcknowledgment = resolve;
	});
	f.ingestion.ingest.mockImplementation(async (...args) => {
		const result = await original(...args);
		if (args[1] === 6 && result === "available") {
			announceCommit();
			await acknowledge;
		}
		return result;
	});

	progress.fill(1);
	f.complete();
	let interrupted = false;
	for (let pass = 0; pass < 20 && !interrupted; pass++) {
		const tick = f.worker.tick();
		interrupted = await Promise.race([
			tick.then(() => false),
			committed.then(() => true),
		]);
		if (interrupted) {
			const unacknowledged = item(6);
			const restart = f.restart();
			continueAcknowledgment();
			await Promise.all([tick, restart]);
			expect(unacknowledged).toMatchObject({ ingestion: "validating" });
		} else f.advance();
	}
	expect(interrupted).toBe(true);
	catalog.close();
	catalog = connect();

	for (let pass = 0; pass < 15; pass++) {
		f.advance();
		await f.worker.tick();
	}
	for (const episode of episodes.filter(
		(episode) => episode !== 4 && episode !== 5,
	)) {
		expect(item(episode)).toMatchObject({
			state: "available",
			ingestion: "available",
		});
		expect(
			(await catalog.source(identity(episode).fileId)).associations.map(
				({ number }) => number,
			),
		).toEqual([String(episode)]);
	}
	expect(item(4)).toMatchObject({
		state: "bound",
		ingestion: "failed",
		error: "subtitle_size_conflict",
	});
	expect(item(5)).toMatchObject({
		state: "bound",
		ingestion: "review",
		reviewId: review.id,
	});
	expect(f.db.acquisitionDownloads.reservedEpisode(key, 5)).toBe(true);
	expect(
		(await catalog.source(protectedFile.fileId)).associations.map(
			({ number }) => number,
		),
	).toEqual(["2"]);

	broken = false;
	const failed = item(4);
	if (!failed) throw new Error("Missing failed file.");
	f.worker.retry(failed.id, failed.revision, "repair-broken-sidecar", "import");
	await f.worker.tick();
	expect(item(4)).toMatchObject({ state: "available" });
	const currentReview = await catalog.review(review.id);
	await confirmManual(currentReview.revision, 7);
	await f.worker.tick();
	expect(item(5)).toMatchObject({
		state: "blocked",
		error: "association_reassigned",
	});
	expect(f.db.acquisitionDownloads.reservedEpisode(key, 5)).toBe(false);
	const after = await request(5);
	await f.worker.tick();
	expect(f.db.acquisitionDownloads.intent(after.intentId)).toMatchObject({
		state: "blocked",
		error: "no_eligible_release",
	});
	expect(f.add).toHaveBeenCalledTimes(1);

	const raw = new Database(join(f.dir, "anishelf.sqlite"), { readonly: true });
	try {
		expect(
			raw
				.prepare(
					"SELECT count(*) AS receipts FROM catalog_operations WHERE key LIKE 'acquisition:%'",
				)
				.get(),
		).toEqual({ receipts: 11 });
		expect(
			raw
				.prepare(
					"SELECT count(*) AS verified FROM acquisition_transfer_files WHERE role = 'subtitle' AND ingestion = 'available' AND source_identity IS NOT NULL",
				)
				.get(),
		).toEqual({ verified: 12 });
	} finally {
		raw.close();
	}
});
