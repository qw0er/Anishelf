import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import pino from "pino";
import { expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import {
	writeAcquisitionCandidates,
	writeAcquisitionSubscriptions,
} from "../src/modules/acquisition/discovery/infrastructure/records.js";
import { writeAcquisitionIntents } from "../src/modules/acquisition/downloads/infrastructure/records.js";
import { SourceDownloads } from "../src/modules/acquisition/sources/downloads.js";
import { writeAcquisitionFeeds } from "../src/modules/acquisition/sources/infrastructure/records.js";

test("upgrades the previous lifecycle schema without losing subscriptions, candidates, validators or accepted URL intents", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-source-upgrade-"));
	let database: ApplicationDatabase | undefined;
	const raw = new Database(join(directory, "anishelf.sqlite"));
	try {
		const migrations = fileURLToPath(
			new URL("../migrations/", import.meta.url),
		);
		const journal = JSON.parse(
			await readFile(join(migrations, "meta/_journal.json"), "utf8"),
		) as { entries: { idx: number; tag: string; when: number }[] };
		raw.function(
			"anishelf_work_key",
			(provider: string, id: string) => `${provider}:anime:${id}`,
		);
		raw.function("anishelf_provider", (key: string) => key.split(":")[0]);
		raw.function("anishelf_provider_id", (key: string) =>
			key.split(":").slice(2).join(":"),
		);
		raw.exec(
			"CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC); PRAGMA user_version = 1;",
		);
		for (const migration of journal.entries.filter((entry) => entry.idx <= 4)) {
			const sql = await readFile(
				join(migrations, `${migration.tag}.sql`),
				"utf8",
			);
			raw.exec(sql);
			raw
				.prepare(
					"INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
				)
				.run(createHash("sha256").update(sql).digest("hex"), migration.when);
		}
		const store = drizzle(raw);
		const magnet = `magnet:?xt=urn:btih:${"a".repeat(40)}`;
		writeAcquisitionFeeds(store, {
			id: "feed",
			revision: "feed-revision",
			url: "https://example.org/private/feed?key=secret",
			etag: "validator",
			lastModified: null,
			entries: [
				{
					id: "entry",
					observationId: "observation",
					title: "Frieren - 03",
					publishedAt: 1000,
					hash: "a".repeat(40),
					downloadUrl: magnet,
				},
			],
			checkedAt: 1000,
			nextAttemptAt: 61_000,
			failures: 0,
			error: null,
		});
		// Reproduce a pre-lifecycle subscription and an old RSS-only management binding.
		raw.exec(
			"DELETE FROM acquisition_sources; INSERT INTO acquisition_sources VALUES ('feed', '{\"kind\":\"rss\"}', 1, 0, NULL);",
		);
		writeAcquisitionSubscriptions(store, {
			workKey: "anilist:anime:1",
			feedId: "feed",
			startEpisode: 1,
			enabled: true,
			revision: "subscription",
		});
		writeAcquisitionCandidates(store, {
			id: "candidate",
			workKey: "anilist:anime:1",
			entryId: "entry",
			title: "Frieren - 03",
			episode: 3,
			status: "selected",
			reasons: [],
			version: "1",
			snapshotId: "snapshot",
			publishedAt: 1000,
		});
		for (const [id, source] of [
			["magnet-intent", magnet],
			["torrent-intent", "https://example.org/private.torrent?key=secret"],
		] as const) {
			writeAcquisitionIntents(store, {
				id,
				revision: "intent",
				workKey: "anilist:anime:1",
				candidateId: "candidate",
				episode: id === "magnet-intent" ? 3 : 4,
				title: "Frieren",
				hash: `unresolved:${id}`,
				expectedHash: null,
				source,
				destination: {
					revision: "destination",
					scopeId: "root",
					path: "/downloads",
					connectionGeneration: "downloader",
					validated: true,
					visibilityVerified: true,
				},
				directory: "Frieren",
				subscriptionRevision: "subscription",
				state: "pending",
				transfer: null,
				progress: null,
				ingestion: "not-ready",
				error: null,
				attempts: 0,
				nextAttemptAt: 0,
				observedAt: null,
				updatedAt: 1000,
				createdAt: 1000,
				sourceIdentity: null,
				lastCommand: null,
			});
		}
		raw.close();
		database = ApplicationDatabase.open(directory);
		expect(database.acquisition.feed("feed")).toMatchObject({
			revision: "feed-revision",
			etag: "validator",
		});
		expect(database.acquisition.source("feed")).toMatchObject({
			enabled: true,
			binding: {
				kind: "rss",
				url: "https://example.org/private/feed?key=secret",
			},
		});
		expect(database.acquisition.subscription("anilist:anime:1")?.revision).toBe(
			"subscription",
		);
		expect(database.acquisition.candidates("anilist:anime:1")).toHaveLength(1);
		expect(database.acquisitionDownloads.intent("magnet-intent")?.source).toBe(
			"legacy:magnet-intent",
		);
		expect(database.acquisitionDownloads.intent("torrent-intent")?.source).toBe(
			"legacy:torrent-intent",
		);
		expect(
			database.acquisition.download("legacy:torrent-intent")?.descriptor,
		).toEqual({
			kind: "public-torrent",
			url: "https://example.org/private.torrent?key=secret",
		});
		const reader = new SourceDownloads(
			database.acquisition,
			{
				read: async () => {
					throw new Error("Unexpected network");
				},
				close: async () => {},
			},
			undefined,
			new AbortController().signal,
			pino({ level: "silent" }),
		);
		expect(
			await reader.read("legacy:magnet-intent", new AbortController().signal),
		).toEqual({ kind: "magnet", uri: magnet });
		await reader.close();
		const inspected = new Database(join(directory, "anishelf.sqlite"));
		try {
			expect(inspected.pragma("foreign_key_check")).toEqual([]);
			expect(
				inspected.pragma("foreign_key_list(acquisition_subscriptions)"),
			).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ table: "acquisition_sources" }),
				]),
			);
		} finally {
			inspected.close();
		}
	} finally {
		if (raw.open) raw.close();
		database?.close();
		await rm(directory, { recursive: true, force: true });
	}
});
