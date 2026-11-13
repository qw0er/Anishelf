import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { AnimeCatalogApplication } from "../../../../src/modules/anime/anime-catalog/application/catalog.js";
import type { CatalogMetadata } from "../../../../src/modules/anime/anime-catalog/ports.js";
import type {
	CachedMetadata,
	WorkDetails,
} from "../../../../src/modules/anime/external-works/metadata/domain/source-model.js";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import { AnimeReleaseAssessment } from "../../../../src/modules/anime/release-assessment/application.js";
import { AcquisitionIngestion } from "../../../../src/modules/anime/release-assessment/ingestion.js";
import { AutomaticIdentificationCoordinator } from "../../../../src/modules/anime/workflows/automatic-identification.js";
import { LibraryIndex } from "../../../../src/modules/resources/library/infrastructure/index.js";
import { createLibraryModule } from "../../../support/library.js";
import { fixtureIdentities } from "../../../support/metadata-identities.js";
import { settingsStore } from "../../../support/settings-store.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
const logger = pino({ enabled: false });
async function fixture() {
	const base = await mkdtemp(join(tmpdir(), "anishelf-ingestion-"));
	cleanup.push(() => rm(base, { recursive: true, force: true }));
	const root = join(base, "media");
	await mkdir(root);
	const db = ApplicationDatabase.openMemory();
	cleanup.push(async () => db.close());
	const config = settingsStore(root),
		library = createLibraryModule({
			configuration: config,
			index: new LibraryIndex(),
			logger,
		});
	cleanup.push(() => library.close());
	await library.startScan();
	await library.waitForCompletion();
	const scopeId = (await library.downloadRoots())[0]?.scopeId;
	if (!scopeId) throw new Error();
	const data: WorkDetails = {
		reference: { provider: "fixture", mediaType: "anime", id: "1" },
		unavailableFields: [],
		titles: [{ value: "Frieren", kind: "romaji", language: "en" }],
		year: 2023,
		format: "TV",
		status: "FINISHED",
		episodeCount: 28,
		nextAiringEpisode: null,
		airingSeason: "FALL",
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
		episodeCatalog: "unavailable",
	};
	const snapshot: CachedMetadata<
		import("../../../../src/modules/anime/external-works/metadata/domain/model.js").WorkDetails
	> = {
		snapshotId: "snapshot",
		fetchedAt: Date.now(),
		stale: false,
		refreshing: false,
		refreshError: null,
		data: { ...data, provider: data.reference.provider },
	};
	db.metadata.save({
		id: "snapshot",
		key: "fixture:anime:1",
		kind: "detail",
		data: {
			...data,
			reference: { provider: "metadata", mediaType: "anime", id: "1" },
		},
		fetchedAt: Date.now(),
		expiresAt: Date.now() + 600000,
		accessedAt: Date.now(),
		failure: null,
	});
	const metadata: CatalogMetadata = {
		current: () => snapshot,
		get: async () => snapshot,
		snapshot: () => ({ kind: "detail", ...snapshot }),
		retain: (id, owner) => db.metadata.retain(id, owner),
		release: (id, owner) => db.metadata.release(id, owner),
		snapshotArtwork: async () => ({
			status: "missing",
			id: null,
			failure: null,
		}),
		readArtwork: async () => {
			throw new Error();
		},
	};
	const catalog = new AnimeCatalogApplication({
		store: db.catalog,
		metadata,
		sources: library.sources,
		logger,
	});
	cleanup.push(async () => catalog.close());
	const parser = new AnitomyIdentificationParser();
	const assessment = new AnimeReleaseAssessment(
			parser,
			metadata as never,
			catalog,
			fixtureIdentities(),
		),
		ingestion = new AcquisitionIngestion(
			metadata,
			fixtureIdentities(),
			parser,
			catalog,
			library.sources,
		);
	async function file(path = "Frieren [fixture-1]/Frieren - 03.mkv") {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), "original");
		if (!scopeId) throw new Error("Missing root scope.");
		return library.refreshDownload(scopeId, path);
	}
	return {
		base,
		root,
		scopeId,
		library,
		config,
		catalog,
		ingestion,
		file,
		metadata,
		db,
		assessment,
		parser,
	};
}
test("targeted refresh and acquisition ingest create real source associations idempotently", async () => {
	const f = await fixture(),
		identity = await f.file();
	const signal = new AbortController().signal;
	expect(await f.ingestion.ingest("fixture:anime:1", 3, identity, signal)).toBe(
		"available",
	);
	expect(await f.ingestion.ingest("fixture:anime:1", 3, identity, signal)).toBe(
		"available",
	);
	const source = await f.catalog.source(identity.fileId);
	expect(source.associations).toHaveLength(1);
	expect(source.associations[0]).toMatchObject({
		reference: { id: "1" },
		number: "3",
		kind: "regular",
	});
});
test("a filename episode contradiction is advisory and the accepted target is ingested", async () => {
	const f = await fixture(),
		identity = await f.file();
	expect(
		await f.ingestion.ingest(
			"fixture:anime:1",
			4,
			identity,
			new AbortController().signal,
		),
	).toBe("available");
	expect(
		(await f.catalog.source(identity.fileId)).associations[0],
	).toMatchObject({ number: "4" });
	const review = (await f.catalog.fileReviews([identity.fileId]))[0];
	expect(review).toMatchObject({
		decisionOrigin: "acquisition",
		acquisition: {
			warnings: ["filename_target_unconfirmed"],
			target: { episode: 4 },
		},
	});
});

test("manual associations survive acquisition retries for a different episode", async () => {
	const f = await fixture(),
		identity = await f.file(),
		signal = new AbortController().signal;
	await f.ingestion.ingest("fixture:anime:1", 3, identity, signal);
	const review = (await f.catalog.fileReviews([identity.fileId]))[0];
	if (!review) throw Error();
	const preview = await f.catalog.preview({
		reference: { id: "1" },
		rows: [
			{
				reviewId: review.id,
				revision: review.revision,
				targets: [{ kind: "regular", number: "3" }],
				reason: "Manual confirmation",
			},
		],
	});
	await f.catalog.confirm({
		previewId: preview.id,
		operationKey: "manual-confirm",
		replace: true,
	});
	expect(await f.ingestion.ingest("fixture:anime:1", 4, identity, signal)).toBe(
		"review",
	);
	expect(
		(await f.catalog.source(identity.fileId)).associations[0]?.number,
	).toBe("3");
});
test("confined completed-file access rejects symlinks, removed roots and incomplete paths within watched roots", async () => {
	const f = await fixture();
	const outside = join(f.base, "outside.mkv");
	await writeFile(outside, "outside");
	await symlink(outside, join(f.root, "escape.mkv"));
	await expect(
		f.library.inspectDownload(f.scopeId, "escape.mkv"),
	).rejects.toThrow();
	await expect(
		f.library.refreshDownload(f.scopeId, "../outside.mkv"),
	).rejects.toThrow();
	await expect(
		f.library.validateDownloadRoot(f.scopeId, join(f.root, "partial")),
	).rejects.toThrow();
	await f.config.update({ resourceRoots: [] });
	await expect(
		f.library.inspectDownload(f.scopeId, "file.mkv"),
	).rejects.toThrow();
});

test.each(["video.mkv", "Unknown - 09.mkv", "Frieren - 03.mkv"])(
	"accepted downloads ingest %s without metadata requests",
	async (path) => {
		const f = await fixture(),
			identity = await f.file(path),
			signal = new AbortController().signal;
		const target = await f.ingestion.captureTarget(
			"fixture:anime:1",
			3,
			signal,
		);
		f.ingestion.retainTarget(target, "download-1");
		const get = vi
			.spyOn(f.metadata, "get")
			.mockRejectedValue(new Error("provider offline"));
		expect(
			await f.ingestion.ingest(target.workKey, 3, identity, signal, {
				intentId: "download-1",
				candidateId: "release",
				title: "Frieren 03",
				hash: "hash",
				transfer: "transfer",
				target,
				warnings: [],
			}),
		).toBe("available");
		expect(get).not.toHaveBeenCalled();
		expect(
			(await f.catalog.source(identity.fileId)).associations[0]?.number,
		).toBe("3");
		expect(await f.catalog.reusableAcquisitions([identity])).toHaveLength(1);
		f.ingestion.releaseTarget(target, "download-1");
		expect(f.metadata.snapshot(target.snapshotId).kind).toBe("detail"); // Catalog retains its own pin.
	},
);

test("parser failure does not revoke the accepted download target", async () => {
	const f = await fixture(),
		identity = await f.file("video.mkv");
	vi.spyOn(f.parser, "extractRelease").mockImplementation(() => {
		throw Error("parse failed");
	});
	expect(
		await f.ingestion.ingest(
			"fixture:anime:1",
			3,
			identity,
			new AbortController().signal,
		),
	).toBe("available");
});

async function automaticallyAssociate(
	f: Awaited<ReturnType<typeof fixture>>,
	identity: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["file"]>>,
) {
	const target = await f.assessment.target("fixture:anime:1");
	const result = {
		source: identity,
		evidence: f.parser.extractRelease("Frieren - 03.mkv"),
		status: "proposed" as const,
		metadataStatus: "searched" as const,
		proposals: [
			{
				candidate: {
					work: target.work,
					score: 100,
					reasons: [],
					conflicts: [],
					matcherVersion: "test",
				},
				mapping: {
					targets: [{ kind: "regular" as const, number: "3" }],
					reasons: [],
					unresolved: [],
				},
			},
		],
		unresolved: [],
	};
	result.evidence.relativePath = identity.relativePath;
	await f.catalog.publish([result], [identity.scopeId]);
	return result;
}
test("accepted target corrects an automatic association and a late scan cannot replace it", async () => {
	const f = await fixture(),
		identity = await f.file();
	const scan = await automaticallyAssociate(f, identity);
	expect(
		(await f.catalog.fileReviews([identity.fileId]))[0]?.decisionOrigin,
	).toBe("identification");
	expect(
		await f.ingestion.ingest(
			"fixture:anime:1",
			4,
			identity,
			new AbortController().signal,
		),
	).toBe("available");
	await f.catalog.publish([scan], [identity.scopeId]);
	const review = (await f.catalog.fileReviews([identity.fileId]))[0];
	expect(review).toMatchObject({
		decisionOrigin: "acquisition",
		acquisition: { target: { episode: 4 } },
		associations: [{ number: "4" }],
	});
});
test.each(["manual", "legacy"])(
	"%s decisions are protected from accepted-target replacement",
	async (origin) => {
		const f = await fixture(),
			identity = await f.file();
		await automaticallyAssociate(f, identity);
		const review = (await f.catalog.fileReviews([identity.fileId]))[0];
		if (!review) throw Error();
		f.db.catalog.decide(
			review.id,
			review.revision,
			"confirmed",
			"Protected decision",
			origin as "manual" | "legacy",
		);
		expect(
			await f.ingestion.ingest(
				"fixture:anime:1",
				4,
				identity,
				new AbortController().signal,
			),
		).toBe("review");
		expect(
			(await f.catalog.source(identity.fileId)).associations[0]?.number,
		).toBe("3");
	},
);
test("manual rejection and a competing acquisition target remain protected", async () => {
	const f = await fixture(),
		identity = await f.file();
	await f.ingestion.ingest(
		"fixture:anime:1",
		3,
		identity,
		new AbortController().signal,
	);
	expect(
		await f.ingestion.ingest(
			"fixture:anime:1",
			4,
			identity,
			new AbortController().signal,
		),
	).toBe("review");
	const review = (await f.catalog.fileReviews([identity.fileId]))[0];
	if (!review) throw Error();
	await f.catalog.remove(
		review.id,
		review.revision,
		"Do not associate this file",
	);
	expect(
		await f.ingestion.ingest(
			"fixture:anime:1",
			3,
			identity,
			new AbortController().signal,
		),
	).toBe("review");
});

test("routine scans reuse a confirmed acquisition without filename recognition or metadata search", async () => {
	const f = await fixture(),
		identity = await f.file("video.mkv");
	await f.ingestion.ingest(
		"fixture:anime:1",
		3,
		identity,
		new AbortController().signal,
	);
	const identify = vi.fn(async () => {
		throw Error("Downloaded source must not be identified again");
	});
	const automatic = new AutomaticIdentificationCoordinator({
		library: f.library,
		sources: f.library.sources,
		identification: { version: "test", identify },
		catalog: f.catalog,
		onPublication: f.catalog.publish,
		logger,
	});
	cleanup.push(() => automatic.close());
	automatic.start();
	await automatic.waitForCompletion();
	expect(identify).not.toHaveBeenCalled();
	expect(automatic.getResults()).toHaveLength(1);
	expect(
		(await f.catalog.source(identity.fileId)).associations[0]?.number,
	).toBe("3");
});
test("a manually changed decision during acquisition preview is fenced", async () => {
	const f = await fixture(),
		identity = await f.file();
	const revalidate = f.library.sources.revalidateSource.bind(f.library.sources);
	let changed = false;
	vi.spyOn(f.library.sources, "revalidateSource").mockImplementation(
		async (input) => {
			const source = f.db.catalog.registerSource(identity);
			const record = f.db.catalog.review(source.id);
			if (record && !changed) {
				changed = true;
				f.db.catalog.decide(
					record.id,
					record.revision,
					"rejected",
					"Concurrent manual rejection",
					"manual",
				);
			}
			return revalidate(input);
		},
	);
	await expect(
		f.ingestion.ingest(
			"fixture:anime:1",
			3,
			identity,
			new AbortController().signal,
		),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	expect((await f.catalog.fileReviews([identity.fileId]))[0]).toMatchObject({
		decision: "rejected",
		decisionOrigin: "manual",
	});
	expect((await f.catalog.source(identity.fileId)).associations).toHaveLength(
		0,
	);
});
