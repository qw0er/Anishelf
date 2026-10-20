import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { AnimeCatalogApplication } from "../src/modules/anime/anime-catalog/application/catalog.js";
import type { CatalogMetadata } from "../src/modules/anime/anime-catalog/ports.js";
import { AnitomyIdentificationParser } from "../src/modules/anime/identification/infrastructure/parser.js";
import type {
	CachedMetadata,
	WorkDetails,
} from "../src/modules/anime/metadata/public.js";
import { AnimeReleaseAssessment } from "../src/modules/anime/release-assessment/application.js";
import { AcquisitionIngestion } from "../src/modules/anime/release-assessment/ingestion.js";
import { createLibraryModule } from "../src/modules/resources/composition/library.js";
import { LibraryIndex } from "../src/modules/resources/library/infrastructure/index.js";
import { settingsStore } from "./settings-store.js";

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
	const db = ApplicationDatabase.open(join(base, "data"));
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
	const snapshot: CachedMetadata<WorkDetails> = {
		snapshotId: "snapshot",
		fetchedAt: Date.now(),
		stale: false,
		refreshing: false,
		refreshError: null,
		data,
	};
	db.metadata.save({
		id: "snapshot",
		key: "fixture:anime:1",
		kind: "detail",
		data,
		raw: {},
		fetchedAt: Date.now(),
		expiresAt: Date.now() + 600000,
		accessedAt: Date.now(),
		failure: null,
	});
	const metadata: CatalogMetadata = {
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
		),
		ingestion = new AcquisitionIngestion(
			assessment,
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
	return { base, root, scopeId, library, config, catalog, ingestion, file };
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
		reference: { provider: "fixture", id: "1" },
		number: "3",
		kind: "regular",
	});
});
test("actual numbering conflict enters local Review rather than associating the expected release", async () => {
	const f = await fixture(),
		identity = await f.file();
	expect(
		await f.ingestion.ingest(
			"fixture:anime:1",
			4,
			identity,
			new AbortController().signal,
		),
	).toBe("review");
	expect((await f.catalog.source(identity.fileId)).associations).toHaveLength(
		0,
	);
	expect(
		(await f.catalog.fileReviews([identity.fileId]))[0]?.unresolved,
	).toContain("download_target_conflict");
});
test("manual associations survive acquisition retries for a different episode", async () => {
	const f = await fixture(),
		identity = await f.file(),
		signal = new AbortController().signal;
	await f.ingestion.ingest("fixture:anime:1", 3, identity, signal);
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
