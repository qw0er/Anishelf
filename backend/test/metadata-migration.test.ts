import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";

const migrationCount: number = JSON.parse(
	readFileSync(
		new URL("../migrations/meta/_journal.json", import.meta.url),
		"utf8",
	),
).entries.length;

test("upgrades normalized metadata without losing ordered payloads, failures, pins or Catalog references", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-metadata-upgrade-"));
	try {
		const raw = new Database(join(directory, "anishelf.sqlite"));
		const migration = await readFile(
			new URL("../migrations/0000_relational_schema.sql", import.meta.url),
			"utf8",
		);
		raw.exec(migration);
		raw.exec(
			"CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
		);
		raw
			.prepare(
				"INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?,?)",
			)
			.run(createHash("sha256").update(migration).digest("hex"), 1792509000000);
		const insert = (
			table: string,
			values: Record<string, string | number | null>,
		) =>
			raw
				.prepare(
					`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(
						values,
					)
						.map(() => "?")
						.join(",")})`,
				)
				.run(...Object.values(values));
		const header = {
			fetched_at: 10,
			expires_at: 20,
			accessed_at: 15,
			failure_present: 0,
			detail_present: 0,
			detail_start_date_present: 0,
			detail_end_date_present: 0,
		};
		for (const kind of ["search", "relations", "airing"])
			insert("metadata_snapshots", {
				...header,
				id: kind,
				key: kind,
				kind,
				page: 2,
				per_page: 5,
				has_next_page: 1,
			});
		insert("metadata_snapshots", {
			...header,
			id: "detail",
			key: "detail",
			kind: "detail",
			detail_present: 1,
			detail_reference_provider: "anilist",
			detail_reference_media_type: "anime",
			detail_reference_id: "9",
			detail_year: 2024,
			detail_description: "Description",
			detail_episode_catalog: "unavailable",
			detail_start_date_present: 1,
			detail_start_date_year: 2024,
			detail_start_date_month: 1,
			failure_present: 1,
			failure_code: "unavailable",
			failure_message: "Offline",
			failure_retry_at: 30,
		});
		const child = (
			table: string,
			parent: string,
			ordinal: number,
			values: Record<string, string | number | null>,
		) =>
			insert(table, {
				row_id: `${table}:${parent}:${ordinal}`,
				parent_id: parent,
				ordinal_index: ordinal,
				...values,
			});
		child("metadata_snapshots_detail_titles", "detail", 1, {
			value: "English",
			language: "en",
			kind: "english",
		});
		child("metadata_snapshots_detail_titles", "detail", 0, {
			value: "Original",
			language: null,
			kind: "native",
		});
		child("metadata_snapshots_detail_unavailable_fields", "detail", 0, {
			value: "tags",
		});
		child("metadata_snapshots_detail_genres", "detail", 1, { value: "Drama" });
		child("metadata_snapshots_detail_genres", "detail", 0, { value: "Drama" });
		child("metadata_snapshots_detail_tags", "detail", 0, {
			name: "Spoiler",
			rank: null,
			spoiler: 1,
		});
		child("metadata_snapshots_detail_tags", "detail", 1, {
			name: "Theme",
			rank: 90,
			spoiler: 0,
		});
		child("metadata_snapshots_detail_studios", "detail", 0, {
			id: "studio",
			name: "Studio",
		});
		child("metadata_snapshots_detail_streaming_episodes", "detail", 0, {
			title: null,
			url: "https://example.test/1",
			site: null,
			thumbnail: null,
		});
		child("metadata_snapshots_items", "search", 0, {
			reference_provider: "other",
			reference_media_type: "anime",
			reference_id: "opaque",
		});
		child(
			"metadata_snapshots_items_titles",
			"metadata_snapshots_items:search:0",
			0,
			{ value: "Search", language: null, kind: "alias" },
		);
		child(
			"metadata_snapshots_items_unavailable_fields",
			"metadata_snapshots_items:search:0",
			0,
			{ value: "year" },
		);
		child("metadata_snapshots_relations", "relations", 0, {
			type: "SEQUEL",
			work_reference_provider: "other",
			work_reference_media_type: "anime",
			work_reference_id: "next",
		});
		child(
			"metadata_snapshots_relations_work_titles",
			"metadata_snapshots_relations:relations:0",
			0,
			{ value: "Next", language: "en", kind: "english" },
		);
		child("metadata_snapshots_airing", "airing", 1, {
			id: "second",
			episode: 2,
			airing_at: 200,
		});
		child("metadata_snapshots_airing", "airing", 0, {
			id: "first",
			episode: 1,
			airing_at: 100,
		});
		insert("catalog_works", {
			id: "work",
			provider_title: "Original",
			revision: 1,
			created_at: 10,
			updated_at: 10,
		});
		insert("catalog_provider_links", {
			work_id: "work",
			provider: "anilist",
			media_type: "anime",
			provider_id: "9",
			snapshot_id: "detail",
		});
		insert("metadata_pins", {
			snapshot_id: "detail",
			owner_id: "catalog:work",
		});
		raw.close();
		for (let attempt = 0; attempt < 2; attempt++) {
			const db = ApplicationDatabase.open(directory);
			try {
				expect(db.metadata.find("detail")).toMatchObject({
					id: "detail",
					fetchedAt: 10,
					expiresAt: 20,
					failure: { code: "unavailable", message: "Offline", retryAt: 30 },
					data: {
						reference: { provider: "anilist", mediaType: "anime", id: "9" },
						titles: [
							{ value: "Original", language: null, kind: "native" },
							{ value: "English", language: "en", kind: "english" },
						],
						unavailableFields: ["tags"],
						startDate: { year: 2024, month: 1, day: null },
						endDate: null,
						genres: ["Drama", "Drama"],
						tags: [
							{ name: "Spoiler", rank: null, spoiler: true },
							{ name: "Theme", rank: 90, spoiler: false },
						],
						studios: [{ id: "studio", name: "Studio" }],
						streamingEpisodes: [
							{
								title: null,
								url: "https://example.test/1",
								site: null,
								thumbnail: null,
							},
						],
					},
				});
				expect(db.metadata.find("search")?.data).toMatchObject({
					page: 2,
					perPage: 5,
					hasNextPage: true,
					items: [
						{
							reference: {
								provider: "other",
								mediaType: "anime",
								id: "opaque",
							},
							titles: [{ value: "Search" }],
							unavailableFields: ["year"],
						},
					],
				});
				expect(db.metadata.find("relations")?.data).toMatchObject({
					items: [
						{
							type: "SEQUEL",
							work: {
								reference: { provider: "other", id: "next" },
								titles: [{ value: "Next" }],
								unavailableFields: [],
							},
						},
					],
				});
				expect(db.metadata.find("airing")?.data).toEqual({
					items: [
						{ id: "first", episode: 1, airingAt: 100 },
						{ id: "second", episode: 2, airingAt: 200 },
					],
					page: 2,
					perPage: 5,
					hasNextPage: true,
				});
			} finally {
				db.close();
			}
		}
		const inspected = new Database(join(directory, "anishelf.sqlite"));
		try {
			expect(inspected.pragma("foreign_key_check")).toEqual([]);
			expect(inspected.prepare("SELECT * FROM metadata_pins").all()).toEqual([
				{ snapshot_id: "detail", owner_id: "catalog:work" },
			]);
			expect(
				inspected
					.prepare("SELECT snapshot_id FROM catalog_provider_links")
					.get(),
			).toEqual({ snapshot_id: "detail" });
			expect(
				inspected
					.prepare("SELECT count(*) AS count FROM __drizzle_migrations")
					.get(),
			).toEqual({ count: migrationCount });
		} finally {
			inspected.close();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
