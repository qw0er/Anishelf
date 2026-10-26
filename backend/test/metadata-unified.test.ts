import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createMetadataModule } from "../src/modules/anime/composition/metadata.js";
import { composeDetails } from "../src/modules/anime/metadata/domain/composition.js";
import { projectDetails } from "../src/modules/anime/metadata/domain/projection.js";
import type { WorkDetails } from "../src/modules/anime/metadata/domain/source-model.js";
import { registerMetadataAssociationRoutes } from "../src/modules/anime/metadata/http/associations.js";
import type { MetadataProvider } from "../src/modules/anime/metadata/ports.js";
import { MetadataError } from "../src/modules/anime/metadata/public.js";
import { workKey, workReference } from "../src/shared/external-reference.js";
import { createHttpApp } from "./support/http.js";

const logger = pino({ enabled: false });
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
function provider(
	key: string,
	id: string,
	overrides: Partial<WorkDetails> = {},
) {
	const data: WorkDetails = {
		reference: { provider: key, mediaType: "anime", id },
		unavailableFields: ["bannerUrl", "nextAiringEpisode"],
		titles: [{ value: "Same title", kind: "native", language: null }],
		year: 2023,
		format: "TV",
		status: null,
		episodeCount: 12,
		nextAiringEpisode: null,
		airingSeason: null,
		coverUrl: null,
		description: null,
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
		streamingEpisodes: [],
		episodeCatalog: "unavailable",
		siteUrl: null,
		providerUpdatedAt: null,
		...overrides,
	};
	const get = vi.fn<MetadataProvider["get"]>(async () => ({ data }));
	const search = vi.fn<MetadataProvider["search"]>(
		async (_query, page, perPage) => ({
			data: { items: [data], page, perPage, hasNextPage: false },
		}),
	);
	const api: MetadataProvider = {
		capabilities: {
			key,
			version: "test",
			search: true,
			details: true,
			relations: false,
			airing: false,
			streamingLinks: false,
			canonicalEpisodes: false,
		},
		get,
		search,
		relations: async () => {
			throw new Error("Unsupported operation must stay internal.");
		},
		airing: async () => {
			throw new Error("Unsupported operation must stay internal.");
		},
	};
	return { api, data, get, search };
}
async function fixture(canAssociate?: () => boolean) {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-unified-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	let database = ApplicationDatabase.open(directory);
	const first = provider("anilist", "10", {
		status: "FINISHED",
		averageScore: 90,
	});
	const second = provider("bangumi", "20", {
		description: "中文简介",
		averageScore: 87,
		titles: [{ value: "中文名", language: "zh-Hans", kind: "alias" }],
	});
	const fetcher = vi.fn<typeof fetch>(
		async () =>
			new Response(
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
					"base64",
				),
			),
	);
	const build = () =>
		createMetadataModule({
			dataDir: directory,
			store: database.metadata,
			providers: [first.api, second.api],
			defaultProvider: "anilist",
			artworkHosts: ["images.example"],
			fetch: fetcher,
			...(canAssociate ? { canAssociate } : {}),
			logger,
		});
	let metadata = await build();
	cleanup.push(async () => {
		await metadata.close();
		database.close();
	});
	return {
		first,
		second,
		fetcher,
		get metadata() {
			return metadata;
		},
		get database() {
			return database;
		},
		restart: async () => {
			await metadata.close();
			database.close();
			database = ApplicationDatabase.open(directory);
			metadata = await build();
		},
	};
}

test("search is federated, explicit associations combine content, and all old IDs survive restart", async () => {
	const f = await fixture();
	const first = f.metadata.resolveReference("anilist:anime:10");
	const second = f.metadata.resolveReference("bangumi:anime:20");
	f.second.data.titles = f.first.data.titles;
	const search = await f.metadata.search({ query: "Same title" });
	expect(search.data.items.map((item) => item.reference)).toEqual([
		first,
		second,
	]);
	expect(first.id).not.toBe(second.id);
	const old = await f.metadata.get(second);
	f.metadata.retain(old.snapshotId, "old-decision");
	f.metadata.management.associate(first, second, {
		sameEpisodeNumbering: true,
	});
	const combined = await f.metadata.get(second);
	expect(combined.data).toMatchObject({
		reference: first,
		description: "中文简介",
		status: "FINISHED",
		averageScore: 90,
	});
	expect(
		(await f.metadata.search({ query: "Same title" })).data.items,
	).toHaveLength(1);
	expect(f.metadata.snapshot(old.snapshotId).data).toEqual(old.data);
	const retained = f.metadata.snapshot(old.snapshotId);
	if (retained.kind !== "detail")
		throw new Error("Expected retained detail evidence.");
	expect(retained.data.reference).toEqual(second);
	expect(JSON.stringify(combined)).not.toMatch(
		/"provider"|"siteUrl"|"providerUpdatedAt"/,
	);
	f.database.metadata.prune(0, 0);
	await f.restart();
	expect(f.metadata.resolveReference(first.id)).toEqual(first);
	expect(f.metadata.resolveReference(second.id)).toEqual(first);
	expect(f.metadata.resolveReference("bangumi:anime:20")).toEqual(first);
	expect(
		(await f.metadata.get(second, { cachedOnly: true })).data.description,
	).toBe("中文简介");
	const restored = f.metadata.snapshot(old.snapshotId);
	if (restored.kind !== "detail")
		throw new Error("Expected restored detail evidence.");
	expect(restored.data.reference).toEqual(second);
});

test("a failed source leaves useful content and a source-independent partial failure", async () => {
	const f = await fixture();
	f.first.search.mockRejectedValue(
		new MetadataError({
			code: "unavailable",
			message: "private AniList error",
			retryAt: 123,
		}),
	);
	const search = await f.metadata.search({ query: "Only available source" });
	expect(search.data.items).toHaveLength(1);
	expect(search.refreshError).toMatchObject({ code: "unavailable" });
	expect(JSON.stringify(search)).not.toContain("private AniList error");
	const first = f.metadata.resolveReference("anilist:anime:10"),
		second = f.metadata.resolveReference("bangumi:anime:20");
	f.metadata.management.associate(first, second, {
		sameEpisodeNumbering: true,
	});
	f.first.get.mockRejectedValue(
		new MetadataError({
			code: "unavailable",
			message: "private failure",
			retryAt: null,
		}),
	);
	const details = await f.metadata.get(first);
	expect(details.data.description).toBe("中文简介");
	expect(details.stale).toBe(true);
	expect(details.refreshError?.message).not.toContain("private");
});

test("missing schedules and relations are unavailable content, not source-specific request errors", async () => {
	const f = await fixture();
	const reference = f.metadata.resolveReference("bangumi:anime:20");
	for (const result of [
		await f.metadata.airing(reference),
		await f.metadata.relations(reference),
	]) {
		expect(result.data).toMatchObject({
			items: [],
			unavailable: true,
			hasNextPage: false,
		});
		expect(f.metadata.snapshot(result.snapshotId).data).toEqual(result.data);
	}
});

test("federated pagination has no overlap and reuses source pages", async () => {
	const f = await fixture();
	for (const source of [f.first, f.second])
		source.search.mockImplementation(async (_query, page, perPage) => ({
			data: {
				items: Array.from({ length: 120 }, (_, i) => ({
					...source.data,
					reference: { ...source.data.reference, id: String(i + 1) },
				})).slice((page - 1) * perPage, page * perPage),
				page,
				perPage,
				hasNextPage: page * perPage < 120,
			},
		}));
	const first = await f.metadata.search({ query: "Many", perPage: 10 }),
		second = await f.metadata.search({ query: "Many", page: 2, perPage: 10 });
	expect(first.data.items).toHaveLength(10);
	expect(second.data.items).toHaveLength(10);
	expect(
		new Set(
			[...first.data.items, ...second.data.items].map(
				(item) => item.reference.id,
			),
		).size,
	).toBe(20);
	expect(first.data.hasNextPage).toBe(true);
	expect(f.first.search).toHaveBeenCalledTimes(1);
	expect(f.second.search).toHaveBeenCalledTimes(1);
	await expect(
		f.metadata.search({ query: "Many", page: 51, perPage: 10 }),
	).rejects.toMatchObject({ failure: { code: "invalid-request" } });
});

test("management requires explicit numbering confirmation and ordinary search rejects source selection", async () => {
	const f = await fixture();
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 80 },
		logger,
		metadata: f.metadata,
		closeDependencies: async () => {},
	});
	registerMetadataAssociationRoutes(app, f.metadata.management);
	cleanup.push(() => app.close());
	const target = f.metadata.resolveReference("anilist:anime:10"),
		other = f.metadata.resolveReference("bangumi:anime:20");
	expect(
		(
			await app.inject({
				url: "/api/metadata/search?query=Title&provider=bangumi",
			})
		).statusCode,
	).toBe(400);
	expect(
		(
			await app.inject({
				method: "POST",
				url: "/api/metadata/associations",
				payload: { target, other },
			})
		).statusCode,
	).toBe(400);
	expect(
		(
			await app.inject({
				method: "POST",
				url: "/api/metadata/associations",
				payload: { target, other, sameEpisodeNumbering: true },
			})
		).json(),
	).toEqual(target);
	const conflicting = f.metadata.resolveReference("anilist:anime:11");
	expect(() =>
		f.metadata.management.associate(target, conflicting, {
			sameEpisodeNumbering: true,
		}),
	).toThrow(/conflicting source/);
	expect(f.metadata.resolveReference(conflicting.id)).toEqual(conflicting);
});

test("upgrading the old identity registry preserves UUIDs exactly", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-identity-upgrade-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const raw = new Database(join(directory, "anishelf.sqlite"));
	raw.pragma("user_version = 1");
	raw.function("anishelf_work_key", (provider: string, id: string) =>
		workKey({ provider, mediaType: "anime", id }),
	);
	raw.function(
		"anishelf_provider",
		(key: string) => workReference(key).provider,
	);
	raw.function("anishelf_provider_id", (key: string) => workReference(key).id);
	const journal = JSON.parse(
		await readFile(
			new URL("../migrations/meta/_journal.json", import.meta.url),
			"utf8",
		),
	) as { entries: { tag: string; when: number; idx: number }[] };
	raw.exec(
		"CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
	);
	for (const entry of journal.entries.filter((entry) => entry.idx <= 13)) {
		const sql = await readFile(
			new URL(`../migrations/${entry.tag}.sql`, import.meta.url),
			"utf8",
		);
		raw.exec(sql);
		raw
			.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)")
			.run(createHash("sha256").update(sql).digest("hex"), entry.when);
	}
	const id = "00112233-4455-4677-8899-aabbccddeeff";
	raw
		.prepare(
			"INSERT INTO metadata_references(id,provider,provider_id) VALUES (?,?,?)",
		)
		.run(id, "anilist", "10");
	raw.close();
	const database = ApplicationDatabase.open(directory);
	try {
		expect(
			database.metadata.identify({
				provider: "anilist",
				mediaType: "anime",
				id: "10",
			}),
		).toBe(id);
		expect(database.metadata.identity(id)).toBe(id);
		expect(database.metadata.references(id)).toEqual([
			{ provider: "anilist", mediaType: "anime", id: "10" },
		]);
	} finally {
		database.close();
	}
});

test("retained artwork uses its original URL after source eviction and association", async () => {
	const f = await fixture();
	f.second.data.coverUrl = "https://images.example/old.png";
	const first = f.metadata.resolveReference("anilist:anime:10"),
		second = f.metadata.resolveReference("bangumi:anime:20");
	const old = await f.metadata.get(second);
	f.metadata.retain(old.snapshotId, "retained-artwork");
	f.second.data.coverUrl = "https://images.example/new.png";
	await f.metadata.get(second, { refresh: true });
	f.metadata.management.associate(first, second, {
		sameEpisodeNumbering: true,
	});
	await f.metadata.get(first);
	f.database.metadata.prune(0, 0);
	const artwork = await f.metadata.snapshotArtwork(old.snapshotId, "cover");
	expect(artwork.status).toBe("ready");
	expect(String(f.fetcher.mock.calls[0]?.[0])).toBe(
		"https://images.example/old.png",
	);
	expect(f.metadata.snapshot(old.snapshotId).data).toEqual(old.data);
});

test("the application can fence conflicting local identities without changing either UUID", async () => {
	const f = await fixture(() => false);
	const first = f.metadata.resolveReference("anilist:anime:10"),
		second = f.metadata.resolveReference("bangumi:anime:20");
	expect(() =>
		f.metadata.management.associate(first, second, {
			sameEpisodeNumbering: true,
		}),
	).toThrow(/duplicate local Catalog/);
	expect(f.metadata.resolveReference(second.id)).toEqual(second);
	expect(f.metadata.resolveReference(first.id)).toEqual(first);
});

test("retained project evidence stops reporting an in-flight refresh when it finishes", async () => {
	const f = await fixture();
	const reference = f.metadata.resolveReference("anilist:anime:10");
	await f.metadata.get(reference);
	const stored = f.database.metadata.current("anilist:anime:10");
	if (!stored) throw new Error("Expected source detail cache.");
	f.database.metadata.save({ ...stored, expiresAt: 0 });
	let complete: ((value: { data: WorkDetails }) => void) | undefined;
	f.first.get.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const stale = await f.metadata.get(reference);
	expect(stale.refreshing).toBe(true);
	await vi.waitFor(() => expect(complete).toBeDefined());
	if (!complete) throw new Error("Expected pending refresh.");
	complete({ data: { ...f.first.data, description: "Fresh" } });
	await vi.waitFor(() =>
		expect(f.metadata.current(reference)?.data.description).toBe("Fresh"),
	);
	expect(f.metadata.snapshot(stale.snapshotId).refreshing).toBe(false);
});

test("pure composition fills missing content without mutating inputs or exposing source identities", () => {
	const primary = provider("anilist", "10", {
		description: "Primary description",
		averageScore: 90,
		genres: ["Adventure"],
		studios: [{ id: "private-studio-id", name: "Studio" }],
		unavailableFields: ["country", "coverUrl"],
	}).data;
	const secondary = provider("bangumi", "20", {
		description: "Secondary description",
		averageScore: 87,
		country: "JP",
		genres: ["Fantasy"],
		coverUrl: "https://images.example/cover.png",
		titles: [
			...primary.titles,
			{ value: "中文名", language: "zh-Hans", kind: "alias" },
		],
	}).data;
	const reference = { id: "project-work" };
	const inputs = [primary, secondary].map((evidence) => ({
		content: Object.freeze(projectDetails(evidence, reference)),
		evidence,
	}));
	const before = structuredClone(inputs);
	const { data, artwork } = composeDetails(inputs);
	expect(inputs).toEqual(before);
	expect(data).toMatchObject({
		reference,
		description: "Primary description",
		averageScore: 90,
		country: "JP",
		genres: ["Adventure"],
		studios: [{ name: "Studio" }],
		coverUrl: "/api/metadata/project-work/artwork/cover/image",
	});
	expect(data.titles).toEqual(secondary.titles);
	expect(data.unavailableFields).not.toContain("country");
	expect(data.unavailableFields).not.toContain("coverUrl");
	expect(artwork.cover).toBe(secondary);
	expect(JSON.stringify(data)).not.toMatch(
		/private-studio-id|"provider"|"siteUrl"|"providerUpdatedAt"/,
	);
});

test("pure composition requires at least one available work", () => {
	expect(() => composeDetails([])).toThrow(
		expect.objectContaining({
			failure: expect.objectContaining({ code: "unavailable" }),
		}),
	);
});

test("assembled content methods keep their service receivers when passed directly to consumers", async () => {
	const f = await fixture();
	const {
		resolveReference,
		get,
		current,
		search,
		snapshot,
		retain,
		release,
		artwork,
		snapshotArtwork,
		cachedArtworkId,
		relations,
		airing,
	} = f.metadata;
	const reference = resolveReference("anilist:anime:10");
	const details = await get(reference);
	expect(current(reference)?.data).toEqual(details.data);
	expect((await search({ query: "Title" })).data.items).toHaveLength(2);
	retain(details.snapshotId, "detached-consumer");
	expect(snapshot(details.snapshotId).data).toEqual(details.data);
	expect((await artwork(reference, "cover")).status).toBe("missing");
	expect((await snapshotArtwork(details.snapshotId, "cover")).status).toBe(
		"missing",
	);
	expect(await cachedArtworkId(reference, "cover")).toBeNull();
	expect((await relations(reference)).data.unavailable).toBe(true);
	expect((await airing(reference)).data.unavailable).toBe(true);
	release(details.snapshotId, "detached-consumer");
});
