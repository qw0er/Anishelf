import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import type { WorkDetails } from "../src/modules/anime/metadata/domain/source-model.js";
import { workKey } from "../src/shared/external-reference.js";

const reference = {
	provider: "fixture/:provider",
	mediaType: "anime",
	id: "作品/:1",
} as const;
const key = workKey(reference);
function details(): WorkDetails {
	return {
		reference,
		unavailableFields: [],
		titles: [{ value: "Canonical", language: null, kind: "native" }],
		year: 2026,
		format: "TV",
		status: "RELEASING",
		episodeCount: 12,
		nextAiringEpisode: null,
		airingSeason: null,
		coverUrl: "https://example.com/cover",
		description: "Complete description",
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
function snapshot(data = details(), id = "detail", fetchedAt = 100) {
	return {
		id,
		key: "cache-key",
		kind: "detail" as const,
		data,
		fetchedAt,
		expiresAt: 10000,
		accessedAt: fetchedAt,
		failure: null,
	};
}
test("one current summary serves Catalog and every account without changing local revisions", () => {
	const database = ApplicationDatabase.openMemory();
	try {
		const initial = {
			...details(),
			titles: [
				{ value: "Romanized", kind: "romaji" as const, language: null },
				...details().titles,
			],
		};
		database.metadata.save(snapshot(initial));
		const entry = {
			id: "entry",
			mediaId: key,
			progress: 3,
			status: "watching" as const,
			updatedAt: 1,
			titles: ["Partial"],
			format: null,
			year: null,
			episodeCount: null,
			coverUrl: null,
		};
		database.trackingLists.replace({
			accountId: "first",
			fetchedAt: 200,
			entries: [entry],
		});
		database.trackingLists.replace({
			accountId: "second",
			fetchedAt: 300,
			entries: [{ ...entry, progress: 8 }],
		});
		database.catalog.saveWork(
			{
				id: "local",
				providerTitle: "Stale copy",
				searchTitles: [],
				format: null,
				year: null,
				episodeCount: null,
				airedEpisodeCount: null,
				revision: 7,
				createdAt: 1,
				updatedAt: 2,
			},
			{ workId: "local", reference, snapshotId: "detail" },
		);
		expect(database.catalog.work("local")).toMatchObject({
			providerTitle: "Canonical",
			episodeCount: 12,
			revision: 7,
		});
		expect(database.trackingLists.read("first")?.entries[0]).toMatchObject({
			titles: ["Canonical", "Romanized"],
			progress: 3,
			episodeCount: 12,
		});
		const updated = {
			...details(),
			titles: [{ value: "Updated", language: null, kind: "native" as const }],
			episodeCount: 13,
		};
		database.metadata.save(snapshot(updated, "new-detail", 400));
		// A local edit adopting its old evidence must not overwrite the newer central summary.
		const local = database.catalog.work("local");
		if (!local) throw new Error("Missing local work");
		database.catalog.saveWork(local, {
			workId: "local",
			reference,
			snapshotId: "detail",
		});
		expect(database.catalog.work("local")).toMatchObject({
			providerTitle: "Updated",
			revision: 7,
			updatedAt: 2,
		});
		expect(database.trackingLists.read("second")?.entries[0]).toMatchObject({
			titles: ["Updated"],
			progress: 8,
			episodeCount: 13,
		});
		expect(database.metadata.get("detail")?.data).toEqual(initial);
	} finally {
		database.close();
	}
});
test("the supported upgrade moves summaries and preserves opaque identities, snapshots and local state", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-info-migration-"));
	try {
		const raw = new Database(join(directory, "anishelf.sqlite"));
		raw.exec(
			"CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
		);
		for (const [file, when] of [
			["0000_relational_schema.sql", 1792509000000],
			["0001_snapshot_payloads.sql", 1792510000000],
		] as const) {
			const sql = await readFile(
				new URL(`../migrations/${file}`, import.meta.url),
				"utf8",
			);
			raw.exec(sql);
			raw
				.prepare(
					"INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)",
				)
				.run(createHash("sha256").update(sql).digest("hex"), when);
		}
		raw
			.prepare(
				"INSERT INTO metadata_snapshots(id,key,kind,fetched_at,expires_at,accessed_at,failure_present,data) VALUES ('detail','cache-key','detail',100,10000,100,0,?)",
			)
			.run(JSON.stringify(details()));
		raw.exec(
			"INSERT INTO metadata_pins VALUES ('detail','local'); INSERT INTO catalog_works VALUES ('local','Old local title','TV',2025,11,7,1,2)",
		);
		raw
			.prepare(
				"INSERT INTO catalog_provider_links VALUES ('local',?,'anime',?,'detail')",
			)
			.run(reference.provider, reference.id);
		raw.exec(
			"INSERT INTO catalog_works_search_titles VALUES ('title','local',0,'Alias'); INSERT INTO catalog_episodes VALUES ('episode','local','regular','1','My correction','confirmed'); INSERT INTO tracking_list_cache (account_id,fetched_at,invalidated) VALUES ('account',200,0)",
		);
		raw
			.prepare(
				"INSERT INTO tracking_list_cache_entries VALUES ('entry','account',0,'remote-entry',?,3,'watching',1,NULL,NULL,NULL,NULL)",
			)
			.run(key);
		raw.exec(
			"INSERT INTO tracking_list_cache_entries_titles VALUES ('entry-title','entry',0,'Partial')",
		);
		raw.close();
		for (let pass = 0; pass < 2; pass++) {
			const database = ApplicationDatabase.open(directory);
			try {
				expect(database.catalog.work("local")).toMatchObject({
					providerTitle: "Canonical",
					revision: 7,
				});
				expect(database.catalog.episodes("local")[0]).toMatchObject({
					id: "episode",
					label: "My correction",
					provenance: "confirmed",
				});
				expect(
					database.trackingLists.read("account")?.entries[0],
				).toMatchObject({ mediaId: key, progress: 3, titles: ["Canonical"] });
				expect(database.metadata.get("detail")?.data).toEqual(details());
			} finally {
				database.close();
			}
		}
		const inspected = new Database(join(directory, "anishelf.sqlite"));
		try {
			expect(inspected.pragma("foreign_key_check")).toEqual([]);
			expect(
				inspected.prepare("SELECT count(*) AS count FROM metadata_works").get(),
			).toEqual({ count: 1 });
			expect(
				inspected
					.prepare(
						"SELECT name FROM sqlite_master WHERE name IN ('catalog_works_search_titles','tracking_list_cache_entries_titles')",
					)
					.all(),
			).toEqual([]);
			for (const table of ["catalog_works", "tracking_list_cache_entries"])
				expect(
					inspected
						.prepare(`PRAGMA table_info(${table})`)
						.all()
						.map((row) => (row as { name: string }).name),
				).not.toContain("episode_count");
		} finally {
			inspected.close();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
