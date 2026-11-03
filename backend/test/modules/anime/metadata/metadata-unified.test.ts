import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { createMetadataModule } from "../../../../src/modules/anime/external-works/metadata/create.js";
import type { WorkDetails } from "../../../../src/modules/anime/external-works/metadata/domain/source-model.js";
import type { MetadataProvider } from "../../../../src/modules/anime/external-works/metadata/ports.js";
import { MetadataError } from "../../../../src/modules/anime/external-works/metadata/public.js";
import {
	workKey,
	workReference,
} from "../../../../src/shared/external-reference.js";
import { createHttpApp } from "../../../support/http.js";

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
async function fixture(defaultProvider = "anilist") {
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
			defaultProvider,
			artworkHosts: ["images.example"],
			fetch: fetcher,
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
			new URL("../../../../migrations/meta/_journal.json", import.meta.url),
			"utf8",
		),
	) as { entries: { tag: string; when: number; idx: number }[] };
	raw.exec(
		"CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
	);
	for (const entry of journal.entries.filter((entry) => entry.idx <= 13)) {
		const sql = await readFile(
			new URL(`../../../../migrations/${entry.tag}.sql`, import.meta.url),
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
	expect((await search({ query: "Title" })).data.items).toHaveLength(1);
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

test("search queries exactly one source and never merges equal titles or missing fields", async () => {
	const f = await fixture();
	f.second.data.titles = f.first.data.titles;
	const first = await f.metadata.search({ query: "Same title" });
	expect(first.data.items).toHaveLength(1);
	expect(first.data.items[0]?.provider).toBe("anilist");
	expect(f.second.search).not.toHaveBeenCalled();
	const second = await f.metadata.search({
		query: "Same title",
		provider: "bangumi",
	});
	expect(second.data.items).toHaveLength(1);
	expect(second.data.items[0]?.provider).toBe("bangumi");
	expect(first.data.items[0]?.reference).not.toEqual(
		second.data.items[0]?.reference,
	);
	f.second.get.mockClear();
	const ref = first.data.items[0]?.reference;
	if (!ref) throw new Error("Missing result");
	expect((await f.metadata.get(ref)).data.description).toBeNull();
	expect(f.second.get).not.toHaveBeenCalled();
	await f.restart();
	expect(f.metadata.resolveReference("anilist:anime:10")).toEqual(ref);
});
test("a source failure never falls back to another provider", async () => {
	const f = await fixture();
	f.first.search.mockRejectedValueOnce(
		new MetadataError({
			code: "unavailable",
			message: "Offline",
			retryAt: null,
		}),
	);
	await expect(f.metadata.search({ query: "Failure" })).rejects.toMatchObject({
		failure: { code: "unavailable" },
	});
	expect(f.second.search).not.toHaveBeenCalled();
});
test("HTTP exposes capabilities and source selection but has no association command", async () => {
	const f = await fixture();
	const app = createHttpApp({
		config: {
			host: "localhost",
			port: 0,

			trustedProxies: [],
			allowedHosts: ["localhost"],
		},
		logger,
	});
	const { registerMetadataRoutes } = await import(
		"../../../../src/modules/anime/external-works/metadata/http/metadata.js"
	);
	registerMetadataRoutes(app, f.metadata);
	try {
		const sources = await app.inject({
			method: "GET",
			url: "/api/metadata/providers",
		});
		expect(sources.statusCode).toBe(200);
		expect(sources.json()).toEqual([
			{ key: "anilist", name: "AniList", metadata: true, tracking: true },
			{ key: "bangumi", name: "Bangumi", metadata: true, tracking: false },
		]);
		const result = await app.inject({
			method: "GET",
			url: "/api/metadata/search?query=Same&provider=bangumi",
		});
		expect(result.statusCode).toBe(200);
		expect(result.json().data.items[0].provider).toBe("bangumi");
		expect(
			(
				await app.inject({
					method: "POST",
					url: "/api/metadata/associations",
					payload: {},
				})
			).statusCode,
		).toBe(404);
	} finally {
		await app.close();
	}
});

test.each([false, true])(
	"migration splits historical associations and preserves canonical local identity (secondary canonical: %s)",
	async (secondaryCanonical) => {
		const directory = await mkdtemp(join(tmpdir(), "anishelf-split-"));
		cleanup.push(() => rm(directory, { recursive: true, force: true }));
		const initial = ApplicationDatabase.open(directory);
		const connection = {
			generation: "generation",
			account: { id: "anilist:7", name: "Fixture" },
			credentialId: "existing-credential",
			state: "connected" as const,
			checkedAt: 1,
		};
		initial.tracking.save(connection);
		const operation: import("../../../../src/modules/anime/external-works/tracking/domain/operation.js").TrackingOperation =
			{
				id: "pending-update",
				accountId: "anilist:7",
				mediaId: "anilist:anime:10",
				origin: "manual-detail",
				commandId: "existing-command",
				intentAt: 1,
				target: null,
				decisionReason: null,
				revision: 1,
				baseline: null,
				desired: { progress: 3 },
				state: "pending",
				remote: null,
				attempt: null,
				attempts: 0,
				retryAt: null,
				error: null,
				updatedAt: 1,
			};
		initial.trackingOperations.admit(operation);
		initial.close();
		const raw = new Database(join(directory, "anishelf.sqlite"));
		raw.exec(
			"DROP INDEX metadata_reference_work_unique; DELETE FROM __drizzle_migrations WHERE created_at = 1793664000000",
		);
		const canonical = secondaryCanonical ? "bangumi-old" : "anilist-old";
		raw
			.prepare(
				"INSERT INTO metadata_references (id,work_id,provider,provider_id) VALUES (?,?,?,?)",
			)
			.run("anilist-old", canonical, "anilist", "10");
		raw
			.prepare(
				"INSERT INTO metadata_references (id,work_id,provider,provider_id) VALUES (?,?,?,?)",
			)
			.run("bangumi-old", canonical, "bangumi", "20");
		const data = { historical: "immutable" };
		raw
			.prepare(
				"INSERT INTO metadata_snapshots(id,key,kind,fetched_at,expires_at,accessed_at,failure_present,data) VALUES ('history','project:history','detail',1,2,1,0,?)",
			)
			.run(JSON.stringify(data));
		raw.exec(
			"INSERT INTO catalog_works(id,revision,created_at,updated_at) VALUES ('local',7,1,2)",
		);
		raw
			.prepare(
				"INSERT INTO catalog_provider_links(work_id,metadata_work_id,snapshot_id) VALUES ('local',?,'history')",
			)
			.run(canonical);
		raw.exec(
			"INSERT INTO metadata_pins(snapshot_id,owner_id) VALUES ('history','local')",
		);
		raw.close();
		let secondary: string | undefined;
		for (let pass = 0; pass < 2; pass++) {
			const db = ApplicationDatabase.open(directory);
			try {
				expect(
					db.metadata.identify({
						provider: "anilist",
						mediaType: "anime",
						id: "10",
					}),
				).toBe(canonical);
				const second = db.metadata.identify({
					provider: "bangumi",
					mediaType: "anime",
					id: "20",
				});
				expect(second).not.toBe(canonical);
				if (!secondaryCanonical) expect(second).toBe("bangumi-old");
				if (secondary) expect(second).toBe(secondary);
				secondary = second;
				expect(db.catalog.link("local")?.reference.id).toBe(canonical);
				expect(db.tracking.get()).toEqual(connection);
				expect(db.trackingOperations.list("anilist:7")).toEqual([operation]);
				expect(
					db.trackingOperations.command("anilist:7", "existing-command"),
				).toMatchObject({ operationId: operation.id, revision: 1 });
				const metadata = await createMetadataModule({
					dataDir: directory,
					store: db.metadata,
					providers: [
						provider("anilist", "10").api,
						provider("bangumi", "20").api,
					],
					defaultProvider: "anilist",
					artworkHosts: [],
					logger,
				});
				try {
					expect(metadata.current({ id: canonical })?.data).toMatchObject({
						provider: "anilist",
						description: null,
					});
				} finally {
					await metadata.close();
				}
				expect(db.metadata.get("history")?.data).toEqual(data);
				expect(db.metadata.references(canonical)).toEqual([
					{ provider: "anilist", mediaType: "anime", id: "10" },
				]);
			} finally {
				db.close();
			}
		}
	},
);

test("invalid historical identity groups reject migration atomically", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-invalid-split-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const initial = ApplicationDatabase.open(directory);
	initial.close();
	const raw = new Database(join(directory, "anishelf.sqlite"));
	raw.exec(
		"DROP INDEX metadata_reference_work_unique; DELETE FROM __drizzle_migrations WHERE created_at = 1793664000000; INSERT INTO metadata_references VALUES ('dangling','bangumi','20','missing')",
	);
	raw.close();
	expect(() => ApplicationDatabase.open(directory)).toThrow();
	const verify = new Database(join(directory, "anishelf.sqlite"));
	try {
		expect(
			verify
				.prepare("SELECT work_id FROM metadata_references WHERE id='dangling'")
				.get(),
		).toEqual({ work_id: "missing" });
	} finally {
		verify.close();
	}
});

test("the configured default source is independent of provider registration order", async () => {
	const f = await fixture("bangumi");
	expect(
		(await f.metadata.search({ query: "Same title" })).data.items[0]?.provider,
	).toBe("bangumi");
	expect(f.first.search).not.toHaveBeenCalled();
});

test("verified cross-source names enrich search and details without sharing identity or descriptive fields", async () => {
	const f = await fixture();
	f.first.data.startDate = { year: 2023, month: 9, day: 29 };
	f.second.data.startDate = { year: 2023, month: 9, day: 29 };
	f.second.data.titles = [
		{ value: "Same title", kind: "native", language: null },
		{ value: "Other-source alias", kind: "alias", language: null },
	];
	const first = f.metadata.resolveReference("anilist:anime:10"),
		second = f.metadata.resolveReference("bangumi:anime:20");
	const detail = await f.metadata.get(first);
	expect(detail.data.titles).toContainEqual({
		value: "Other-source alias",
		kind: "alias",
		language: null,
	});
	expect(detail.data).toMatchObject({
		provider: "anilist",
		reference: first,
		description: null,
		averageScore: 90,
	});
	expect(f.metadata.identities.externalReference(first, "bangumi")).toBeNull();
	expect(first).not.toEqual(second);
	const search = await f.metadata.search({ query: "Same title" });
	expect(search.data.items).toHaveLength(1);
	expect(search.data.items[0]?.reference).toEqual(first);
	expect(search.data.items[0]?.titles).toContainEqual({
		value: "Other-source alias",
		kind: "alias",
		language: null,
	});
	expect(f.metadata.current(first)?.data.titles).toEqual(detail.data.titles);
	expect(f.metadata.snapshot(detail.snapshotId).data).toEqual(detail.data);
});
