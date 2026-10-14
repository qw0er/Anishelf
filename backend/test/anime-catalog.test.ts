import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { AnimeCatalogApplication } from "../src/modules/anime/anime-catalog/application/catalog.js";
import type { MappingSelection } from "../src/modules/anime/anime-catalog/public.js";
import { createIdentificationModule } from "../src/modules/anime/composition/identification.js";
import { createIdentificationMetadata } from "../src/modules/anime/composition/metadata.js";
import { MetadataApplication } from "../src/modules/anime/metadata/application/metadata.js";
import { MetadataArtworkCache } from "../src/modules/anime/metadata/infrastructure/artwork.js";
import type { MetadataProvider } from "../src/modules/anime/metadata/ports.js";
import type { WorkDetails } from "../src/modules/anime/metadata/public.js";
import { LibraryIndex } from "../src/modules/resources/library/infrastructure/index.js";
import { DomainError } from "../src/shared/errors.js";
import { settingsStore } from "./settings-store.js";
import { createHttpApp } from "./support/http.js";
import { createLibraryModule } from "./support/library.js";

const logger = pino({ enabled: false });
const reference = { provider: "fixture", mediaType: "anime", id: "1" } as const;
function details(id = "1"): WorkDetails {
	return {
		reference: { ...reference, id },
		unavailableFields: [],
		titles: [
			{ value: `Anime ${id}`, kind: "romaji", language: null },
			{ value: "葬送のフリーレン", kind: "native", language: null },
		],
		year: 2023,
		format: "TV",
		status: "FINISHED",
		episodeCount: 12,
		airingSeason: "FALL",
		coverUrl: null,
		description: "Original provider text",
		bannerUrl: null,
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
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing fixture value");
	return value;
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(
	paths = ["Anime - 01.mkv"],
	artworkFetch?: typeof fetch,
) {
	const base = await mkdtemp(join(tmpdir(), "anishelf-catalog-"));
	cleanups.push(() => rm(base, { recursive: true, force: true }));
	const requestedRoot = join(base, "media");
	await mkdir(requestedRoot);
	const root = await realpath(requestedRoot);
	for (const path of paths) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), "original");
	}
	let database = ApplicationDatabase.open(join(base, "data"));
	let providerData = details();
	const get = vi.fn<MetadataProvider["get"]>(async (ref) => ({
		data: {
			...providerData,
			reference: { ...reference, id: ref.id },
			titles:
				ref.id === providerData.reference.id
					? providerData.titles
					: details(ref.id).titles,
		},
		raw: {},
	}));
	const provider: MetadataProvider = {
		capabilities: {
			key: "fixture",
			version: "1",
			search: true,
			details: true,
			relations: false,
			airing: false,
			streamingLinks: false,
			canonicalEpisodes: false,
		},
		get,
		search: async () => ({
			data: { items: [providerData], page: 1, perPage: 10, hasNextPage: false },
			raw: {},
		}),
		relations: async () => ({
			data: { items: [], page: 1, perPage: 10, hasNextPage: false },
			raw: {},
		}),
		airing: async () => ({
			data: { items: [], page: 1, perPage: 10, hasNextPage: false },
			raw: {},
		}),
	};
	const index = new LibraryIndex();
	const configuration = settingsStore(root);
	const library = createLibraryModule({ configuration, index, logger });
	async function makeMetadata() {
		const artwork = new MetadataArtworkCache({
			dataDir: join(base, "data"),
			store: database.metadata,
			...(artworkFetch ? { fetch: artworkFetch } : {}),
		});
		await artwork.initialize();
		return new MetadataApplication({
			store: database.metadata,
			providers: [provider],
			artwork,
			logger,
		});
	}
	let metadata = await makeMetadata();
	function makeCatalog() {
		return new AnimeCatalogApplication({
			store: database.catalog,
			metadata,
			sources: library.sources,
			logger,
		});
	}
	let catalog = makeCatalog();
	const automatic = createIdentificationModule({
		library,
		sources: library.sources,
		logger,
		onPublication: (results, canonicalRoot) =>
			catalog.publish(results, canonicalRoot),
	});
	cleanups.push(async () => {
		await automatic.close();
		catalog.close();
		await metadata.close();
		await library.close();
		database.close();
	});
	async function scan() {
		await library.startScan();
		await library.waitForCompletion();
		await automatic.waitForCompletion();
	}
	async function restart() {
		catalog.close();
		await metadata.close();
		database.close();
		database = ApplicationDatabase.open(join(base, "data"));
		metadata = await makeMetadata();
		catalog = makeCatalog();
	}
	await scan();
	return {
		root,
		base,
		library,
		configuration,
		automatic,
		get,
		scan,
		restart,
		setData: (value: WorkDetails) => {
			providerData = value;
		},
		get catalog() {
			return catalog;
		},
		get database() {
			return database;
		},
		get metadata() {
			return metadata;
		},
	};
}
async function rows(
	f: Awaited<ReturnType<typeof fixture>>,
	numbers = ["1"],
): Promise<MappingSelection[]> {
	const result = await f.catalog.reviews();
	return result.items.map((item, index) => ({
		reviewId: item.id,
		revision: item.revision,
		reason: "User confirmed numbering",
		targets: [{ kind: "regular", number: numbers[index] ?? "1" }],
	}));
}
async function confirm(
	f: Awaited<ReturnType<typeof fixture>>,
	selected = rows(f),
	id = "1",
) {
	const preview = await f.catalog.preview({
		reference: { ...reference, id },
		rows: await selected,
	});
	return f.catalog.confirm({
		operationKey: `operation-${preview.id}`,
		previewId: preview.id,
		replace: false,
	});
}

test("published scans create durable reviews, and confirmation establishes a local library", async () => {
	const f = await fixture(["Season/Anime - 01.mkv", "Season/Anime - 02.mkv"]);
	const reviews = await f.catalog.reviews();
	expect(reviews.items).toHaveLength(2);
	expect(
		reviews.items.every(
			(item) => item.available && item.decision === "pending",
		),
	).toBe(true);
	expect(JSON.stringify(reviews)).not.toContain(f.root);
	expect((await f.catalog.list()).items).toEqual([]);
	const result = await confirm(f, rows(f, ["1", "2"]));
	expect(result.workId).not.toBe("1");
	const list = await f.catalog.list();
	expect(list.items).toHaveLength(1);
	expect(list.items[0]?.availableEpisodes).toBe(2);
	const detail = await f.catalog.detail(result.workId);
	expect(
		detail.episodes
			.filter((item) => item.versions.length)
			.map((item) => item.number),
	).toEqual(["1", "2"]);
	expect(
		detail.episodes.filter((item) => item.provenance === "count-derived"),
	).toHaveLength(10);
	expect(detail.episodes[2]?.availability).toBe("missing");
	expect(
		detail.episodes
			.filter((item) => item.versions.length)
			.every((item) => item.versions[0]?.available),
	).toBe(true);
	expect(detail.metadata.data.description).toBe("Original provider text");
	expect(await readFile(join(f.root, "Season/Anime - 01.mkv"), "utf8")).toBe(
		"original",
	);
});

test("multiple versions count once and one source can map to multiple explicit episodes", async () => {
	const f = await fixture(["Anime v1 - 01.mkv", "Anime v2 - 01.mkv"]);
	const selected = await rows(f);
	const first = selected[0];
	if (!first) throw new Error("Missing review");
	first.targets.push({ kind: "regular", number: "2" });
	const result = await confirm(f, Promise.resolve(selected));
	const detail = await f.catalog.detail(result.workId);
	expect(detail.work.availableEpisodes).toBe(2);
	expect(detail.episodes[0]?.versions).toHaveLength(2);
	expect(detail.episodes[1]?.versions).toHaveLength(1);
});

test("offset previews preserve release numbering and reject invalid or implicit special targets", async () => {
	const f = await fixture(["Anime - 29.mkv"]);
	const selected = await rows(f, ["29"]);
	required(selected[0]).offset = -24;
	const preview = await f.catalog.preview({ reference, rows: selected });
	expect(preview.rows[0]).toMatchObject({
		rawNumbers: ["29"],
		targets: [{ kind: "regular", number: "5" }],
		offset: -24,
	});
	expect((await f.catalog.reviews()).items[0]?.decision).toBe("pending");
	await expect(
		f.catalog.preview({ reference, rows: await rows(f, ["29"]) }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	const invalid = await rows(f);
	required(invalid[0]).targets = [{ kind: "special", number: "12.5" }];
	await expect(
		f.catalog.preview({ reference, rows: invalid }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	required(required(invalid[0]).targets[0]).label = "Special 12.5";
	await confirm(f, Promise.resolve(invalid));
	expect((await f.catalog.list()).items[0]?.availableEpisodes).toBe(1);
});

test("stable episode IDs, mappings and source progress survive rescan refresh and restart", async () => {
	const f = await fixture();
	const result = await confirm(f);
	let detail = await f.catalog.detail(result.workId);
	const episodeId = required(detail.episodes[0]).id;
	await f.catalog.editEpisode(
		result.workId,
		episodeId,
		detail.work.revision,
		"1",
		"Custom episode title",
	);
	const review = required((await f.catalog.reviews()).items[0]);
	f.database.playback.openGeneration(review.sourceId);
	const progress = f.database.playback.get(review.sourceId);
	await f.scan();
	detail = await f.catalog.detail(result.workId);
	expect(detail.episodes[0]).toMatchObject({
		id: episodeId,
		number: "1",
		label: "Custom episode title",
	});
	f.setData({ ...details(), description: "Updated provider text" });
	await f.catalog.refresh(result.workId, detail.work.revision);
	await f.restart();
	f.get.mockRejectedValue(new Error("offline"));
	detail = await f.catalog.detail(result.workId);
	expect(detail.work.displayTitle).toBe(details().titles[0]?.value);
	expect(detail.metadata.data.description).toBe("Updated provider text");
	expect(f.database.playback.get(review.sourceId)).toEqual(progress);
	expect((await f.catalog.list({ query: "Anime" })).items).toHaveLength(1);
});

test("confirmation operation keys survive restart and cannot be reused for different input", async () => {
	const f = await fixture();
	const preview = await f.catalog.preview({ reference, rows: await rows(f) });
	const request = {
		operationKey: "retry-key",
		previewId: preview.id,
		replace: false,
	};
	const result = await f.catalog.confirm(request);
	await f.restart();
	expect(await f.catalog.confirm(request)).toEqual(result);
	await expect(
		f.catalog.confirm({ ...request, replace: true }),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	expect((await f.catalog.list()).items).toHaveLength(1);
});

test("stale review and work revisions block confirmation and explicit replacement previews affected links", async () => {
	const f = await fixture();
	const selected = await rows(f);
	const first = await f.catalog.preview({ reference, rows: selected });
	const stale = await f.catalog.preview({ reference, rows: selected });
	const confirmed = await f.catalog.confirm({
		operationKey: "first",
		previewId: first.id,
		replace: false,
	});
	await expect(
		f.catalog.confirm({
			operationKey: "stale",
			previewId: stale.id,
			replace: true,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	const second = await f.catalog.preview({
		reference: { ...reference, id: "2" },
		rows: await rows(f, ["2"]),
	});
	expect(second.rows[0]?.before[0]?.workId).toBe(confirmed.workId);
	await expect(
		f.catalog.confirm({
			operationKey: "replace",
			previewId: second.id,
			replace: false,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	const replacement = await f.catalog.confirm({
		operationKey: "replace-explicit",
		previewId: second.id,
		replace: true,
	});
	expect(replacement.workId).not.toBe(confirmed.workId);
	expect((await f.catalog.list()).items).toHaveLength(1);
});

test("atomic confirmation rolls back all associations and decisions when a later row fails", async () => {
	const f = await fixture(["Anime - 01.mkv", "Anime - 02.mkv"]);
	const preview = await f.catalog.preview({
		reference,
		rows: await rows(f, ["1", "2"]),
	});
	const original = f.database.catalog.transaction.bind(f.database.catalog);
	vi.spyOn(f.database.catalog, "transaction").mockImplementation((operation) =>
		original((store) => {
			const decide = store.decide.bind(store);
			let calls = 0;
			store.decide = (...args) => {
				if (++calls === 2) throw new Error("simulated disk write failure");
				return decide(...args);
			};
			return operation(store);
		}),
	);
	await expect(
		f.catalog.confirm({
			operationKey: "atomic",
			previewId: preview.id,
			replace: false,
		}),
	).rejects.toThrow("simulated disk write failure");
	expect((await f.catalog.list()).items).toEqual([]);
	expect(
		(await f.catalog.reviews()).items.every(
			(item) => item.decision === "pending",
		),
	).toBe(true);
	for (const item of (await f.catalog.reviews()).items)
		expect(f.database.catalog.associations(item.id)).toEqual([]);
});

test("rejection survives repeat scans and removal does not erase source history", async () => {
	const f = await fixture();
	let review = required((await f.catalog.reviews()).items[0]);
	await f.catalog.reject(review.id, review.revision, "Wrong title");
	await f.scan();
	await f.restart();
	review = required(
		(await f.catalog.reviews({ decision: "rejected" })).items[0],
	);
	expect(review.reason).toBe("Wrong title");
	const result = await confirm(f);
	review = required((await f.catalog.reviews()).items[0]);
	f.database.playback.openGeneration(review.sourceId);
	await expect(
		f.catalog.reject(review.id, review.revision, "Reject"),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	await f.catalog.remove(review.id, review.revision, "Remove association");
	expect((await f.catalog.list()).items).toEqual([]);
	expect(f.database.playback.get(review.sourceId)).toBeDefined();
	expect(f.database.catalog.work(result.workId)).not.toBeNull();
});

test("replaced sources require new confirmation and missing files retain unavailable historical links", async () => {
	const f = await fixture();
	const result = await confirm(f);
	const before = required(
		required((await f.catalog.detail(result.workId)).episodes[0]).versions[0],
	);
	await writeFile(
		join(f.root, "Anime - 01.mkv"),
		"replacement with different size",
	);
	expect(
		(await f.catalog.detail(result.workId)).episodes[0]?.versions[0]?.available,
	).toBe(false);
	await f.scan();
	const reviews = await f.catalog.reviews();
	expect(reviews.items).toHaveLength(2);
	expect(
		reviews.items.find((item) => item.id === before.reviewId)?.available,
	).toBe(false);
	expect(
		reviews.items.find((item) => item.id !== before.reviewId)?.decision,
	).toBe("pending");
	expect(
		(await f.catalog.list({ availability: "unavailable" })).items[0]?.id,
	).toBe(result.workId);
	await rm(join(f.root, "Anime - 01.mkv"));
	await f.scan();
	expect((await f.catalog.detail(result.workId)).work.availableEpisodes).toBe(
		0,
	);
	expect((await f.catalog.list()).items).toHaveLength(1);
});

test("changed files and root switches invalidate pending previews without deleting other roots", async () => {
	const f = await fixture();
	const initial = await confirm(f);
	const preview = await f.catalog.preview({ reference, rows: await rows(f) });
	await writeFile(join(f.root, "Anime - 01.mkv"), "changed");
	await expect(
		f.catalog.confirm({
			operationKey: "changed",
			previewId: preview.id,
			replace: true,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	const otherRoot = join(f.base, "other");
	await mkdir(otherRoot);
	await f.library.updateResourceSettings({ resourceRoot: otherRoot });
	await f.library.waitForCompletion();
	await f.automatic.waitForCompletion();
	expect((await f.catalog.list()).items).toEqual([]);
	await expect(f.catalog.detail(initial.workId)).rejects.toMatchObject({
		code: "CATALOG_NOT_FOUND",
	});
	await expect(
		f.catalog.confirm({
			operationKey: "root",
			previewId: preview.id,
			replace: true,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	await f.library.updateResourceSettings({ resourceRoot: f.root });
	await f.library.waitForCompletion();
	await f.automatic.waitForCompletion();
	expect((await f.catalog.list()).items).toHaveLength(1);
});

test("cached browsing stays offline and refresh failures preserve confirmed metadata and manual data", async () => {
	const f = await fixture();
	const result = await confirm(f);
	const before = await f.catalog.detail(result.workId);
	f.get.mockRejectedValue(new Error("provider outage"));
	expect(
		(await f.catalog.refresh(result.workId, before.work.revision)).metadata
			.refreshError?.code,
	).toBe("unavailable");
	const after = await f.catalog.detail(result.workId);
	expect(after.work).toEqual(before.work);
	expect(after.metadata.data).toEqual(before.metadata.data);
	expect(f.get).toHaveBeenCalledTimes(2);
	await f.catalog.list();
	await f.catalog.detail(result.workId);
	expect(f.get).toHaveBeenCalledTimes(2);
	f.database.metadata.prune(0, 0);
	expect((await f.catalog.detail(result.workId)).metadata.data).toEqual(
		before.metadata.data,
	);
});

test("preview expiry requires a new preview without keeping transient snapshots pinned", async () => {
	const f = await fixture();
	const preview = await f.catalog.preview({ reference, rows: await rows(f) });
	vi.spyOn(Date, "now").mockReturnValue(preview.expiresAt + 1);
	await expect(
		f.catalog.confirm({
			operationKey: "expired",
			previewId: preview.id,
			replace: false,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	f.database.metadata.prune(0, 0);
	expect(f.database.metadata.get(preview.metadata.snapshotId)).toBeNull();
});

test("local search filters paginate deterministically over confirmed works", async () => {
	const f = await fixture(["A - 01.mkv", "B - 01.mkv", "C - 01.mkv"]);
	const selected = await rows(f);
	for (const [index, row] of selected.entries())
		await confirm(f, Promise.resolve([row]), String(index + 1));
	const first = await f.catalog.list({ perPage: 2 });
	const second = await f.catalog.list({ page: 2, perPage: 2 });
	expect(first.items).toHaveLength(2);
	expect(first.hasNextPage).toBe(true);
	expect(second.items).toHaveLength(1);
	expect(second.hasNextPage).toBe(false);
	expect(
		new Set([...first.items, ...second.items].map((item) => item.id)).size,
	).toBe(3);
	expect((await f.catalog.list({ query: "葬送" })).items).toHaveLength(3);
	expect((await f.catalog.list({ format: "MOVIE" })).items).toEqual([]);
	expect((await f.catalog.list({ year: 2022 })).items).toEqual([]);
	await expect(f.catalog.list({ perPage: 51 })).rejects.toMatchObject({
		code: "INVALID_REQUEST",
	});
});

test("HTTP exposes safe typed DTOs, explicit confirmations and actionable validation/conflicts", async () => {
	const f = await fixture();
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());
	const reviewResponse = await app.inject({ url: "/api/catalog/reviews" });
	expect(reviewResponse.statusCode).toBe(200);
	expect(reviewResponse.headers["cache-control"]).toBe("no-store");
	expect(reviewResponse.body).not.toContain(f.root);
	const selected = await rows(f);
	const preview = await app.inject({
		method: "POST",
		url: "/api/catalog/previews",
		payload: { reference, rows: selected },
	});
	expect(preview.statusCode).toBe(200);
	const response = await app.inject({
		method: "POST",
		url: "/api/catalog/confirmations",
		payload: {
			previewId: preview.json().id,
			operationKey: "http",
			replace: false,
		},
	});
	expect(response.statusCode).toBe(200);
	const detail = await app.inject({
		url: `/api/catalog/works/${response.json().workId}`,
	});
	expect(detail.statusCode).toBe(200);
	expect(detail.body).not.toContain(f.root);
	expect(detail.json().work).not.toHaveProperty("title");
	expect(detail.json().work).not.toHaveProperty("aliases");
	const removedEdit = await app.inject({
		method: "PATCH",
		url: `/api/catalog/works/${response.json().workId}`,
		payload: {
			revision: response.json().revision,
			title: "Override",
			aliases: [],
		},
	});
	expect(removedEdit.statusCode).toBe(404);
	const invalid = await app.inject({
		method: "POST",
		url: "/api/catalog/confirmations",
		payload: { previewId: preview.json().id, operationKey: "http" },
	});
	expect(invalid.statusCode).toBe(400);
	const stale = await app.inject({
		method: "POST",
		url: "/api/catalog/previews",
		payload: { reference, rows: selected },
	});
	expect(stale.statusCode).toBe(409);
	expect(stale.json().error.code).toBe("CATALOG_CONFLICT");
	const missing = await app.inject({ url: "/api/catalog/works/missing" });
	expect(missing.statusCode).toBe(404);
	const malformed = await app.inject({ url: "/api/catalog/works?perPage=100" });
	expect(malformed.statusCode).toBe(400);
});

test("root epoch conflicts remain visible rather than being disguised as unavailable sources", async () => {
	const f = await fixture();
	const result = await confirm(f);
	vi.spyOn(f.library.sources, "revalidateSource").mockImplementation(
		async () => {
			throw new DomainError("INTERNAL_ERROR", "unexpected storage fault");
		},
	);
	await expect(f.catalog.detail(result.workId)).rejects.toMatchObject({
		code: "INTERNAL_ERROR",
	});
});

test("separate confirmations reuse provider identity and disjoint stale previews cannot overwrite corrections", async () => {
	const f = await fixture(["Anime - 01.mkv", "Anime - 02.mkv"]);
	const selected = await rows(f, ["1", "2"]);
	const first = await confirm(f, Promise.resolve([required(selected[0])]));
	const pending = required(
		(await f.catalog.reviews({ decision: "pending" })).items[0],
	);
	const request = {
		reference,
		rows: [
			{
				reviewId: pending.id,
				revision: pending.revision,
				targets: [{ kind: "regular" as const, number: "2" }],
				reason: "Second source",
			},
		],
	};
	const stale = await f.catalog.preview(request);
	const editedEpisode = required(
		(await f.catalog.detail(first.workId)).episodes[0],
	);
	await f.catalog.editEpisode(
		first.workId,
		editedEpisode.id,
		first.revision,
		editedEpisode.number,
		"Corrected episode",
	);
	await expect(
		f.catalog.confirm({
			operationKey: "disjoint-stale",
			previewId: stale.id,
			replace: false,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	const fresh = await f.catalog.preview(request);
	const second = await f.catalog.confirm({
		operationKey: "second-source",
		previewId: fresh.id,
		replace: false,
	});
	expect(second.workId).toBe(first.workId);
	expect((await f.catalog.list()).items).toHaveLength(1);
	expect((await f.catalog.detail(first.workId)).work).toMatchObject({
		availableRegularEpisodes: 2,
	});
});

test("movies and unknown counts preserve explicit targets without inventing canonical episode records", async () => {
	const f = await fixture();
	f.setData({ ...details(), format: "MOVIE", episodeCount: 1 });
	const selected = await rows(f);
	required(selected[0]).targets = [{ kind: "movie", number: "whole" }];
	const movie = await confirm(f, Promise.resolve(selected));
	expect((await f.catalog.detail(movie.workId)).episodes).toHaveLength(1);
	expect((await f.catalog.detail(movie.workId)).episodes[0]).toMatchObject({
		kind: "movie",
		number: "whole",
		provenance: "confirmed",
	});
	f.setData({ ...details(), episodeCount: null });
	const regularRows = await rows(f, ["75"]);
	const preview = await f.catalog.preview({
		reference: { ...reference, id: "2" },
		rows: regularRows,
	});
	const unknown = await f.catalog.confirm({
		operationKey: "unknown-count",
		previewId: preview.id,
		replace: true,
	});
	const detail = await f.catalog.detail(unknown.workId);
	expect(detail.episodes).toHaveLength(1);
	expect(detail.episodeCountProvenance).toBe("unknown");
	expect(detail.episodes[0]?.number).toBe("75");
});

test("confirmation fails safely if unconfirmed metadata was evicted after preview", async () => {
	const f = await fixture();
	const preview = await f.catalog.preview({ reference, rows: await rows(f) });
	f.database.metadata.prune(0, 0);
	await expect(
		f.catalog.confirm({
			operationKey: "evicted",
			previewId: preview.id,
			replace: false,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	expect((await f.catalog.reviews()).items[0]?.decision).toBe("pending");
	expect((await f.catalog.list()).items).toEqual([]);
});

test("failed refresh after an intervening local edit cannot overwrite the edit", async () => {
	const f = await fixture();
	const result = await confirm(f);
	let resolve:
		| ((value: Awaited<ReturnType<MetadataProvider["get"]>>) => void)
		| undefined;
	f.get.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const refreshing = f.catalog.refresh(result.workId, result.revision);
	await vi.waitFor(() => expect(resolve).toBeDefined());
	const episode = required((await f.catalog.detail(result.workId)).episodes[0]);
	await f.catalog.editEpisode(
		result.workId,
		episode.id,
		result.revision,
		episode.number,
		"Concurrent correction",
	);
	required(resolve)({
		data: { ...details(), description: "Refreshed" },
		raw: {},
	});
	await expect(refreshing).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	expect((await f.catalog.detail(result.workId)).episodes[0]?.label).toBe(
		"Concurrent correction",
	);
});

test("literal wildcard provider titles remain literal local search text", async () => {
	const f = await fixture();
	f.setData({
		...details(),
		titles: [
			{ value: "100% Anime", language: "en", kind: "romaji" },
			{ value: "[release]_special", language: null, kind: "alias" },
		],
	});
	await confirm(f);
	expect((await f.catalog.list({ query: "100%" })).items).toHaveLength(1);
	expect((await f.catalog.list({ query: "_special" })).items).toHaveLength(1);
	expect((await f.catalog.list({ query: "not_found%" })).items).toHaveLength(0);
});

test("concurrent confirmation retries share one result and do not leak metadata pins", async () => {
	const f = await fixture();
	const preview = await f.catalog.preview({ reference, rows: await rows(f) });
	const request = {
		operationKey: "concurrent",
		previewId: preview.id,
		replace: false,
	};
	const results = await Promise.all([
		f.catalog.confirm(request),
		f.catalog.confirm(request),
	]);
	expect(results[0]).toEqual(results[1]);
	f.setData({ ...details(), description: "New snapshot" });
	const detail = await f.catalog.detail(required(results[0]).workId);
	await f.catalog.refresh(detail.work.id, detail.work.revision);
	f.database.metadata.prune(0, 0);
	expect(f.database.metadata.get(preview.metadata.snapshotId)).toBeNull();
	expect(
		(await f.catalog.detail(detail.work.id)).metadata.data.description,
	).toBe("New snapshot");
});

test("closing Catalog stops every composed use case before reading or mutating state", async () => {
	const f = await fixture();
	const committed = await confirm(f);
	const selected = await rows(f);
	const row = required(selected[0]);
	const preview = await f.catalog.preview({ reference, rows: selected });
	const before = f.database.catalog.work(committed.workId);
	const providerCalls = f.get.mock.calls.length;
	f.catalog.close();
	f.catalog.close();

	await expect(f.catalog.publish([], f.root)).rejects.toThrowError(
		expect.objectContaining({ code: "CATALOG_UNAVAILABLE" }),
	);
	const calls = [
		() => f.catalog.list(),
		() => f.catalog.detail(committed.workId),
		() => f.catalog.reviews(),
		() => f.catalog.fileReviews([]),
		() => f.catalog.preview({ reference, rows: selected }),
		() =>
			f.catalog.confirm({
				operationKey: "closed",
				previewId: preview.id,
				replace: true,
			}),
		() => f.catalog.reject(row.reviewId, row.revision, "Rejected"),
		() => f.catalog.remove(row.reviewId, row.revision, "Removed"),
		() =>
			f.catalog.editEpisode(
				committed.workId,
				"unused",
				committed.revision,
				"1",
				"Changed",
			),
		() => f.catalog.refresh(committed.workId, committed.revision),
	];
	for (const call of calls)
		await expect(call()).rejects.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
	expect(f.database.catalog.work(committed.workId)).toEqual(before);
	expect(f.database.catalog.operation("closed")).toBeNull();
	expect(f.get.mock.calls).toHaveLength(providerCalls);
});

test("poster artwork uses retained snapshots, delivers cached images offline and enforces active-root access", async () => {
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
		"base64",
	);
	const fetchArtwork = vi.fn<typeof fetch>(async () => new Response(png));
	const f = await fixture(undefined, fetchArtwork);
	f.setData({
		...details(),
		coverUrl:
			"https://s4.anilist.co/file/anilistcdn/media/anime/cover/fixture.png",
		bannerUrl: null,
	});
	const confirmed = await confirm(f);
	const before = f.get.mock.calls.length;
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());
	const list = await app.inject({ url: "/api/catalog/works" });
	const cover = `/api/catalog/works/${confirmed.workId}/artwork/cover`;
	expect(list.json().items[0].coverUrl).toBe(cover);
	expect(fetchArtwork).not.toHaveBeenCalled();
	const image = await app.inject({ url: cover });
	expect(image.statusCode).toBe(200);
	expect(image.headers["content-type"]).toBe("image/png");
	expect(image.headers["x-content-type-options"]).toBe("nosniff");
	expect(image.rawPayload).toEqual(png);
	fetchArtwork.mockRejectedValue(new Error("offline"));
	f.get.mockRejectedValue(new Error("provider offline"));
	expect((await app.inject({ url: cover })).statusCode).toBe(200);
	expect(fetchArtwork).toHaveBeenCalledTimes(1);
	expect(f.get).toHaveBeenCalledTimes(before);
	expect(
		(
			await app.inject({
				url: `/api/catalog/works/${confirmed.workId}/artwork/banner`,
			})
		).statusCode,
	).toBe(404);
	expect(
		(
			await app.inject({
				url: `/api/catalog/works/${confirmed.workId}/artwork/anything`,
			})
		).statusCode,
	).toBe(400);
	const nextRoot = join(f.base, "other-root");
	await mkdir(nextRoot);
	await f.library.updateResourceSettings({
		resourceRoot: nextRoot,
		scanIntervalMinutes: 0,
	});
	await f.library.waitForCompletion();
	await f.automatic.waitForCompletion();
	expect((await app.inject({ url: cover })).statusCode).toBe(404);
});

async function enableAutomatic(f: Awaited<ReturnType<typeof fixture>>) {
	// Replace the local-only fixture coordinator so two publishers cannot race.
	await f.automatic.close();
	f.setData({
		...details(),
		titles: [{ value: "Anime", kind: "romaji", language: null }],
	});
	const search = f.metadata.search.bind(f.metadata);
	const searchSpy = vi
		.spyOn(f.metadata, "search")
		.mockImplementation((query, options) =>
			search({ ...query, provider: "fixture" }, options),
		);
	cleanups.push(async () => {
		searchSpy.mockRestore();
	});
	const automatic = createIdentificationModule({
		library: f.library,
		sources: f.library.sources,
		logger,
		metadata: createIdentificationMetadata(f.metadata),
		onPublication: (results, root, signal) =>
			f.catalog.publish(results, root, signal),
	});
	cleanups.push(() => automatic.close());
	await automatic.waitForCompletion();
	return automatic;
}

test("unambiguous scanner identification automatically admits sources and preserves corrections across rescan/restart", async () => {
	const f = await fixture(["Anime - 01.mkv", "Anime - 02.mkv"]);
	const automatic = await enableAutomatic(f);
	const list = await f.catalog.list();
	expect(list.items).toHaveLength(1);
	expect(list.items[0]?.availableEpisodes).toBe(2);
	const work = required(list.items[0]);
	const review = required((await f.catalog.reviews()).items[0]);
	expect(review.decision).toBe("confirmed");
	expect(review.reason).toContain("Automatically identified");
	expect((await f.catalog.review(review.id)).associations[0]?.workId).toBe(
		work.id,
	);
	const preview = await f.catalog.preview({
		reference,
		rows: [
			{
				reviewId: review.id,
				revision: review.revision,
				targets: [{ kind: "regular", number: "3" }],
				reason: "Manual episode correction",
			},
		],
	});
	await f.catalog.confirm({
		previewId: preview.id,
		operationKey: "manual-over-auto",
		replace: true,
	});
	await f.scan();
	await automatic.waitForCompletion();
	expect((await f.catalog.review(review.id)).associations[0]?.number).toBe("3");
	expect((await f.catalog.list()).items[0]?.displayTitle).toBe(
		work.displayTitle,
	);
	await automatic.close();
	await f.restart();
	await f.scan();
	expect((await f.catalog.list()).items).toHaveLength(1);
	expect((await f.catalog.review(review.id)).associations[0]?.number).toBe("3");
});

test("ambiguous candidates, specials and provider failure remain pending rather than auto-associated", async () => {
	const f = await fixture(["Anime - 01.mkv", "Anime - SP01.mkv"]);
	f.setData({
		...details(),
		titles: [{ value: "Anime", kind: "romaji", language: null }],
	});
	const results = f.automatic.getResults();
	for (const result of results) {
		result.metadataStatus = "searched";
		result.proposals = [
			{
				candidate: {
					work: {
						reference,
						snapshotId: "search",
						titles: ["Anime"],
						year: 2023,
						format: "TV",
						episodeCount: 12,
						season: null,
						part: null,
					},
					score: 70,
					reasons: [],
					conflicts: [],
					matcherVersion: "test",
				},
				mapping: {
					targets: [{ kind: "regular", number: "1" }],
					reasons: [],
					unresolved: [],
				},
			},
		];
	}
	const first = required(results[0]);
	const original = structuredClone(first.proposals[0]);
	if (!original) throw new Error("Missing proposal");
	first.proposals.push({
		...original,
		candidate: {
			...original.candidate,
			work: {
				...original.candidate.work,
				reference: { ...reference, id: "2" },
			},
			score: 69,
		},
	});
	await f.catalog.publish(results, f.root);
	expect((await f.catalog.list()).items).toHaveLength(0);
	first.proposals = [original];
	first.metadataStatus = "failed";
	await f.catalog.publish(results, f.root);
	expect((await f.catalog.list()).items).toHaveLength(0);
	first.metadataStatus = "searched";
	required(first.proposals[0]).candidate.conflicts = ["Year differs"];
	await f.catalog.publish(results, f.root);
	expect((await f.catalog.list()).items).toHaveLength(0);
});

test("manual rejection and removal prevent later successful identification from re-admitting sources", async () => {
	const f = await fixture();
	const automatic = await enableAutomatic(f);
	const item = required((await f.catalog.reviews()).items[0]);
	await f.catalog.remove(item.id, item.revision, "Not this work");
	await f.scan();
	await automatic.waitForCompletion();
	expect((await f.catalog.review(item.id)).decision).toBe("rejected");
	expect((await f.catalog.list()).items).toHaveLength(0);
});

test("automatic hydration failure remains reviewable and a later scan can retry without duplicates", async () => {
	const f = await fixture();
	f.get.mockRejectedValueOnce(new Error("provider unavailable"));
	const automatic = await enableAutomatic(f);
	expect((await f.catalog.list()).items).toHaveLength(0);
	expect((await f.catalog.reviews()).items[0]?.decision).toBe("pending");
	await f.scan();
	await automatic.waitForCompletion();
	expect((await f.catalog.list()).items).toHaveLength(1);
	await f.scan();
	await automatic.waitForCompletion();
	expect((await f.catalog.list()).items).toHaveLength(1);
});

test("source playback metadata follows local edits, removal and replacement", async () => {
	const f = await fixture();
	const review = required((await f.catalog.reviews()).items[0]);
	expect((await f.catalog.source(review.fileId)).associations).toEqual([]);
	f.setData({ ...details(), episodeCount: null });
	const confirmed = await confirm(f);
	const detail = await f.catalog.detail(confirmed.workId);
	const episode = required(
		detail.episodes.find((item) => item.versions.length),
	);
	await f.catalog.editEpisode(
		detail.work.id,
		episode.id,
		detail.work.revision,
		"3",
		"Local episode",
	);
	expect(await f.catalog.source(review.fileId)).toEqual({
		sourceVersion: review.sourceVersion,
		associations: [
			{
				workId: confirmed.workId,
				workTitle: detail.work.providerTitle,
				episodeId: episode.id,
				kind: "regular",
				number: "3",
				label: "Local episode",
			},
		],
	});
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());
	const response = await app.inject({
		url: `/api/catalog/sources/${review.fileId}`,
	});
	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual(await f.catalog.source(review.fileId));
	expect(response.headers["cache-control"]).toBe("no-store");
	expect(response.body).not.toContain(f.root);
	const current = await f.catalog.review(review.id);
	await f.catalog.remove(current.id, current.revision, "Remove match");
	expect((await f.catalog.source(review.fileId)).associations).toEqual([]);
	await confirm(f);
	await writeFile(
		join(f.root, review.relativePath),
		"replaced source contents",
	);
	await f.scan();
	expect((await f.catalog.source(review.fileId)).associations).toEqual([]);
});

test("file review batches use current source versions and enforce request bounds", async () => {
	const f = await fixture();
	const review = required((await f.catalog.reviews()).items[0]);
	expect(await f.catalog.fileReviews([review.fileId])).toMatchObject([
		{ id: review.id, decision: "pending" },
	]);
	await confirm(f);
	expect(
		(await f.catalog.fileReviews([review.fileId]))[0]?.associations,
	).toHaveLength(1);
	await expect(
		f.catalog.fileReviews([review.fileId, review.fileId]),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	await expect(
		f.catalog.fileReviews(Array.from({ length: 101 }, (_, i) => String(i))),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	await writeFile(
		join(f.root, review.relativePath),
		"replaced source contents",
	);
	// A new version must not inherit the old confirmed review, even before publication.
	expect(await f.catalog.fileReviews([review.fileId])).toEqual([]);
	await f.scan();
	expect((await f.catalog.fileReviews([review.fileId]))[0]?.decision).toBe(
		"pending",
	);
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());
	const response = await app.inject({
		method: "POST",
		url: "/api/catalog/file-reviews",
		payload: { fileIds: [review.fileId] },
	});
	expect(response.statusCode).toBe(200);
	expect(response.body).not.toContain(f.root);
	expect(response.headers["cache-control"]).toBe("no-store");
});

test("work review filters match qualified candidates without admitting them and paginate", async () => {
	const f = await fixture([
		"Anime - 01.mkv",
		"Anime - 02.mkv",
		"Anime - 03.mkv",
	]);
	const selected = await rows(f, ["1", "2", "3"]);
	const confirmed = await confirm(f, Promise.resolve([required(selected[0])]));
	const results = f.automatic.getResults();
	const pendingFile = required(
		(await f.catalog.reviews({ decision: "pending" })).items[0],
	).fileId;
	const excluded = required(
		results.find((result) => result.source.fileId === pendingFile),
	);
	for (const result of results)
		result.proposals = [
			{
				candidate: {
					work: {
						reference,
						snapshotId: "fixture",
						season: null,
						part: null,
						titles: ["Anime"],
						year: 2023,
						format: "TV",
						episodeCount: 12,
					},
					score: 40,
					matcherVersion: "test",
					reasons: ["Possible title"],
					conflicts: [],
				},
				mapping: { targets: [], reasons: [], unresolved: ["Unknown episode"] },
			},
		];
	required(excluded.proposals[0]).candidate.work.reference = {
		...reference,
		provider: "other",
	};
	await f.catalog.publish(results, f.root);
	const first = await f.catalog.reviews({
		workId: confirmed.workId,
		decision: "pending",
		perPage: 1,
	});
	expect(first.items).toHaveLength(1);
	expect(first.items[0]?.associations).toEqual([]);
	expect(first.hasNextPage).toBe(false);
	expect((await f.catalog.list()).items).toHaveLength(1);
	await expect(
		f.catalog.reviews({ workId: "unknown-work", decision: "pending" }),
	).rejects.toMatchObject({ code: "CATALOG_NOT_FOUND" });
	required(excluded.proposals[0]).candidate.work.reference = reference;
	await f.catalog.publish(results, f.root);
	expect(
		(
			await f.catalog.reviews({
				workId: confirmed.workId,
				decision: "pending",
				perPage: 1,
			})
		).hasNextPage,
	).toBe(true);
	expect(
		(
			await f.catalog.reviews({
				workId: confirmed.workId,
				decision: "pending",
				perPage: 1,
				page: 2,
			})
		).items,
	).toHaveLength(1);
});

test("rejection accepts omitted or blank reasons, persists null, and keeps removal explicit", async () => {
	const f = await fixture();
	let review = required((await f.catalog.reviews()).items[0]);
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());
	for (const reason of [undefined, "", "   "]) {
		const response = await app.inject({
			method: "POST",
			url: `/api/catalog/reviews/${review.id}/reject`,
			payload: {
				revision: review.revision,
				...(reason === undefined ? {} : { reason }),
			},
		});
		expect(response.statusCode).toBe(200);
		expect(response.json().reason).toBeNull();
		review = await f.catalog.review(review.id);
	}
	const tooLong = await app.inject({
		method: "POST",
		url: `/api/catalog/reviews/${review.id}/reject`,
		payload: { revision: review.revision, reason: "x".repeat(501) },
	});
	expect(tooLong.statusCode).toBe(400);
	await f.restart();
	expect((await f.catalog.review(review.id)).reason).toBeNull();
	await confirm(f);
	review = await f.catalog.review(review.id);
	await expect(
		f.catalog.reject(review.id, review.revision, ""),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	await expect(
		f.catalog.remove(review.id, review.revision, ""),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});
