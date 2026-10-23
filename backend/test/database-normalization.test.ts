import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterEach, expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import * as schema from "../src/app/schema.js";
import {
	writeAcquisitionDestination,
	writeAcquisitionIntents,
} from "../src/modules/acquisition/downloads/infrastructure/records.js";
import { writeAcquisitionFeeds } from "../src/modules/acquisition/sources/infrastructure/records.js";
import {
	writeAcquisitionAuthorizations,
	writeAcquisitionCandidates,
	writeAcquisitionSubscriptions,
} from "../src/modules/acquisition/subscriptions/infrastructure/records.js";
import {
	writeCatalogAssociations,
	writeCatalogOperations,
	writeCatalogReviews,
	writeCatalogWorks,
} from "../src/modules/anime/anime-catalog/infrastructure/records.js";
import type { IdentificationResult } from "../src/modules/anime/identification/public.js";
import { MetadataRepository } from "../src/modules/anime/metadata/infrastructure/repository.js";
import {
	writeTrackingListCache,
	writeTrackingOperations,
} from "../src/modules/anime/tracking/infrastructure/records.js";
import { writePreparationTasks } from "../src/modules/media/preparation/infrastructure/records.js";
import { writeSubtitleFontSets } from "../src/modules/media/subtitles/infrastructure/records.js";
import { writePlaybackCompletions } from "../src/modules/playback/progress/infrastructure/records.js";
import { writeAuthSessions } from "../src/modules/system/authentication/infrastructure/records.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-relational-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	ApplicationDatabase.open(directory).close();
	const raw = new Database(join(directory, "anishelf.sqlite"));
	return { directory, raw };
}
test("persists all normalized aggregates, preserves ordered children and survives reopen", async () => {
	const { directory, raw } = await fixture();
	const source = {
		scopeId: "scope",
		fileId: "file",
		relativePath: "episode.mkv",
		sourceVersion: "v1",
	};
	const feed = {
		id: "feed",
		revision: "f1",
		url: "https://example.test/feed",
		etag: "etag",
		lastModified: null,
		checkedAt: 10,
		nextAttemptAt: 20,
		failures: 1,
		error: null,
		entries: [
			{
				id: "entry",
				observationId: "obs",
				seeders: null,
				seedersObservedAt: null,
				title: "Episode 1",
				publishedAt: 1,
				downloadUrl: null,
				hash: "hash",
			},
		],
	};
	const subscription = {
		profileId: null,
		workKey: "work",
		feedId: "feed",
		startEpisode: 1,
		enabled: true,
		revision: "s1",
		lastError: null,
	};
	const candidate = {
		id: "candidate",
		workKey: "work",
		entryId: "entry",
		title: "Episode 1",
		episode: 1,
		status: "selected",
		reasons: ["first", "second"],
		version: "v1",
		snapshotId: "snapshot",
		publishedAt: null,
		chosen: false,
	};
	const destination = {
		revision: "d1",
		scopeId: "scope",
		path: "/downloads",
		connectionGeneration: "g1",
		validated: true,
		visibilityVerified: false,
	};
	const authorization = {
		workKey: "work",
		feedId: "feed",
		startEpisode: 1,
		destinationRevision: "d1",
		connectionGeneration: "g1",
	};
	const intent = {
		id: "intent",
		revision: "i1",
		workKey: "work",
		candidateId: "candidate",
		episode: 1,
		title: "Episode 1",
		hash: "hash",
		expectedHash: null,
		source: "magnet:private",
		destination,
		directory: "/downloads/work",
		subscriptionRevision: "s1",
		state: "pending",
		transfer: null,
		progress: null,
		ingestion: "not-ready",
		error: null,
		attempts: 0,
		nextAttemptAt: 20,
		observedAt: null,
		updatedAt: 10,
		createdAt: 1,
		sourceIdentity: source,
		lastCommand: { id: "command", kind: "acquisition" },
	};
	const operation = {
		id: "op",
		accountId: "account",
		mediaId: "fixture:anime:media",
		origin: "manual-detail",
		commandId: "command",
		intentAt: 1,
		target: null,
		decisionReason: null,
		revision: 1,
		baseline: null,
		desired: { progress: 2 },
		state: "pending",
		remote: null,
		attempt: null,
		attempts: 0,
		retryAt: null,
		error: null,
		updatedAt: 2,
	};
	const entries = [
		{
			id: "list-entry",
			mediaId: "fixture:anime:media",
			progress: 1,
			status: "watching",
			updatedAt: null,
			titles: ["B", "A", "B"],
			format: null,
			year: null,
			episodeCount: null,
			coverUrl: null,
		},
	];
	const result: IdentificationResult = {
		source,
		evidence: {
			parser: "fixture",
			parserVersion: "1",
			normalizationVersion: "1",
			contextFingerprint: "fingerprint",
			originalName: "episode.mkv",
			relativePath: "episode.mkv",
			inputs: [
				{
					mode: "basename",
					input: "episode",
					elements: [{ kind: "episode", value: "1", position: 0 }],
				},
			],
			titles: ["Title"],
			titleSources: [],
			years: [],
			seasons: [],
			parts: [],
			rawEpisodes: ["01"],
			selectedEpisodes: ["1"],
			numbering: "single",
			contentKind: "regular",
		},
		status: "proposed",
		metadataStatus: "searched",
		proposals: [
			{
				candidate: {
					work: {
						reference: { provider: "fixture", mediaType: "anime", id: "1" },
						snapshotId: "snapshot",
						titles: ["Title"],
						titleVariants: [
							{ value: "Title", kind: "primary", language: null },
						],
						year: null,
						format: null,
						episodeCount: null,
						season: null,
						part: null,
					},
					score: 1,
					reasons: ["match"],
					conflicts: [],
					matcherVersion: "1",
				},
				mapping: {
					targets: [{ kind: "regular", number: "1" }],
					reasons: [],
					unresolved: [],
				},
			},
		],
		unresolved: [],
	};
	const metadata = {
		reference: { provider: "fixture", mediaType: "anime", id: "1" },
		unavailableFields: [],
		titles: ["Second", "First"].map((value) => ({
			value,
			kind: "native",
			language: null,
		})),
		year: null,
		format: null,
		status: null,
		episodeCount: null,
		airingSeason: null,
		coverUrl: null,
	};
	const snapshot = {
		version: 1,
		mode: "transcode-video",
		reasons: { video: "codec", audio: "copy" },
		videoStreamIndex: 0,
		audioStreamIndices: [2, 1],
		plan: {
			container: "mp4",
			outputFormat: "mov",
			video: { action: "encode", encoder: "libsvtav1", codec: "av1" },
			audio: { action: "copy" },
			filters: ["first", "second"],
			videoParameters: {
				pixelFormat: "yuv420p",
				encoder: "libsvtav1",
				codec: "av1",
				crf: 30,
				preset: 8,
			},
		},
	};
	const context = {
		version: 2,
		accountId: "account",
		generation: "g1",
		manualVersion: 0,
		fileId: "file",
		sourceVersion: "v1",
		reviewId: "source",
		mappingRevision: 1,
		episodeId: "episode",
		mediaId: "fixture:anime:media",
		episode: 1,
	};
	raw.exec(
		"INSERT INTO resource_roots VALUES ('scope',1); INSERT INTO media_sources VALUES ('source','scope','file','episode.mkv','v1',1)",
	);
	const store = drizzle(raw);
	writeAcquisitionFeeds(store, feed);
	writeAcquisitionSubscriptions(store, subscription);
	writeAcquisitionCandidates(
		store,
		candidate as Parameters<typeof writeAcquisitionCandidates>[1],
	);
	writeAcquisitionDestination(store, { ...destination, id: "default" });
	writeAcquisitionAuthorizations(store, authorization);
	writeAcquisitionIntents(
		store,
		intent as Parameters<typeof writeAcquisitionIntents>[1],
	);
	writeTrackingOperations(
		store,
		operation as Parameters<typeof writeTrackingOperations>[1],
	);
	writeTrackingListCache(store, {
		accountId: "account",
		invalidated: false,
		fetchedAt: 5,
		entries,
	} as Parameters<typeof writeTrackingListCache>[1]);
	new MetadataRepository(store).save({
		id: "snapshot",
		key: "key",
		kind: "search",
		data: { items: [metadata], page: 2, perPage: 3, hasNextPage: false },
		fetchedAt: 1,
		expiresAt: 10,
		accessedAt: 2,
		failure: { code: "busy", message: "retry", retryAt: 20 },
	});
	writeCatalogWorks(store, {
		id: "work",
		providerTitle: "Title",
		searchTitles: ["Second", "First"],
		format: null,
		year: null,
		episodeCount: null,
		airedEpisodeCount: null,
		revision: 1,
		createdAt: 1,
		updatedAt: 2,
	});
	raw.exec(
		"INSERT INTO catalog_provider_links VALUES ('work','fixture','anime','1','snapshot'); INSERT INTO catalog_episodes VALUES ('episode','work','regular','1','1','confirmed')",
	);
	writeCatalogAssociations(store, {
		id: "association",
		sourceId: "source",
		episodeId: "episode",
		rawNumbers: ["01", "1"],
		reason: "fixture",
		operationKey: "automatic:fixture",
		offset: 0,
	});
	writeCatalogReviews(store, {
		id: "source",
		result,
		available: true,
		revision: 1,
		decision: "confirmed",
		reason: null,
	});
	writeCatalogOperations(store, {
		key: "receipt",
		fingerprint: "fp",
		result: { workId: "work", revision: 1, reviewIds: ["source"] },
	});
	writePreparationTasks(store, {
		id: "task",
		sourceId: "source",
		executionPlanId: "plan",
		profileId: "profile",
		profileFingerprint: "fp",
		filename: "out.mp4",
		snapshot,
		status: "processing",
		progress: {
			mediaTimeMs: 100,
			frames: 3,
			outputBytes: 20,
			speed: 1.5,
			percent: 10,
			ended: false,
		},
		failureReason: null,
		createdAtMs: 1,
		updatedAtMs: 2,
	} as Parameters<typeof writePreparationTasks>[1]);
	writeSubtitleFontSets(store, {
		id: "fonts",
		sourceId: "source",
		status: "degraded",
		warnings: ["first", "second"],
	});
	writePlaybackCompletions(store, {
		id: "completion",
		sourceId: "source",
		context,
		attemptedAt: 0,
		outcome: { state: "pending", reason: "fixture" },
	});
	const session = {
		authFingerprint: "fp",
		authExpiresAt: 100,
		csrfToken: "csrf",
		cookie: {
			expires: null,
			originalMaxAge: 100,
			sameSite: "lax",
			secure: false,
			path: "/",
			httpOnly: true,
			domain: null,
		},
	};
	writeAuthSessions(store, { id: "session", expiresAt: 100, ...session });

	raw.close();
	for (let pass = 0; pass < 2; pass++) {
		const db = ApplicationDatabase.open(directory);
		try {
			expect(db.acquisition.feed("feed")).toEqual(feed);
			expect(db.acquisition.subscription("work")).toEqual(subscription);
			expect(db.acquisition.candidates("work")).toEqual([candidate]);
			expect(db.acquisitionDownloads.destination()).toEqual(destination);
			expect(db.acquisition.authorization("work")).toEqual(authorization);
			expect(db.acquisitionDownloads.intent("intent")).toEqual(intent);
			expect(db.trackingOperations.list("account")).toEqual([operation]);
			expect(
				db.trackingOperations.list("account")[0]?.desired,
			).not.toHaveProperty("status");
			expect(db.trackingLists.read("account")?.entries).toEqual(entries);
			const cached = db.trackingLists.read("account");
			if (!cached) throw new Error("Missing account snapshot.");
			expect(() =>
				db.trackingLists.replace({
					...cached,
					fetchedAt: 999,
					entries: [...cached.entries, ...cached.entries],
				}),
			).toThrow();
			expect(db.trackingLists.read("account")).toEqual(cached);

			expect(db.metadata.get("snapshot")?.data).toEqual({
				items: [metadata],
				page: 2,
				perPage: 3,
				hasNextPage: false,
			});
			expect(db.metadata.get("snapshot")?.failure?.retryAt).toBe(20);
			expect(db.catalog.work("work")?.searchTitles).toEqual([
				"Second",
				"First",
			]);
			expect(db.catalog.review("source")?.proposals).toEqual(result.proposals);
			expect(db.catalog.review("source")?.evidence).toEqual(result.evidence);
			expect(db.catalog.associations("source")[0]?.rawNumbers).toEqual([
				"01",
				"1",
			]);
			expect(db.catalog.operation("receipt")?.result.reviewIds).toEqual([
				"source",
			]);
			expect(() =>
				db.catalog.saveOperation("receipt", "changed", {
					workId: "other",
					revision: 99,
					reviewIds: [],
				}),
			).toThrow();
			expect(db.catalog.operation("receipt")?.fingerprint).toBe("fp");
			expect(db.preparation.get("task")?.spec.settings).toEqual(snapshot);
			expect(db.subtitles.getFonts("fonts")?.warnings).toEqual([
				"first",
				"second",
			]);
			expect(
				JSON.parse(db.playback.completions()[0]?.context ?? "null"),
			).toEqual(context);
			const observation = db.playback.completions()[0];
			if (!observation) throw new Error("Missing observation.");
			db.playback.saveCompletion({
				...observation,
				context: JSON.stringify({ ...context, mediaId: "changed" }),
				outcome: {
					state: "accepted",
					reason: "accepted",
					operationId: "op",
					revision: 1,
				},
			});
			expect(
				JSON.parse(db.playback.completions()[0]?.context ?? "null"),
			).toEqual(context);
			expect(
				JSON.parse(db.authentication.readSession("session", 1) ?? "null"),
			).toEqual(session);
		} finally {
			db.close();
		}
	}
	const inspected = new Database(join(directory, "anishelf.sqlite"));
	try {
		expect(inspected.pragma("foreign_key_check")).toEqual([]);
		for (const table of Object.values(schema)) {
			if (!is(table, SQLiteTable)) continue;
			const config = getTableConfig(table);
			const actual = inspected.pragma(`table_info(${config.name})`) as {
				name: string;
				pk: number;
			}[];
			expect(actual.map((col) => col.name).sort(), config.name).toEqual(
				config.columns.map((col) => col.name).sort(),
			);
			expect(
				actual.some((col) => col.pk),
				config.name,
			).toBe(true);
			expect(
				config.columns.some((col) => col.columnType === "SQLiteTextJson"),
				config.name,
			).toBe(
				[
					"acquisition_subscriptions",
					"metadata_snapshots",
					"acquisition_sources",
					"acquisition_source_downloads",
					"metadata_works",
					"media_inspections",
					"acquisition_candidates",
				].includes(config.name),
			);
		}
		expect(
			inspected
				.prepare(
					"SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'",
				)
				.get(),
		).toEqual({ count: 67 });
	} finally {
		inspected.close();
	}
});

test.each([0, 2])(
	"rejects an unsupported database format %s without changing its records",
	async (version) => {
		const directory = await mkdtemp(join(tmpdir(), "anishelf-unsupported-"));
		cleanup.push(() => rm(directory, { recursive: true, force: true }));
		const original = new Database(join(directory, "anishelf.sqlite"));
		original.exec(
			"CREATE TABLE existing_data (value TEXT NOT NULL); INSERT INTO existing_data VALUES ('preserved')",
		);
		original.pragma(`user_version = ${version}`);
		original.close();
		expect(() => ApplicationDatabase.open(directory)).toThrow(
			"Unsupported database format",
		);
		const inspected = new Database(join(directory, "anishelf.sqlite"));
		try {
			expect(inspected.prepare("SELECT * FROM existing_data").all()).toEqual([
				{ value: "preserved" },
			]);
			expect(
				inspected
					.prepare("SELECT name FROM sqlite_master WHERE type='table'")
					.all(),
			).toEqual([{ name: "existing_data" }]);
		} finally {
			inspected.close();
		}
	},
);

test("database constraints reject invalid state, singleton duplicates, negative counters and sizes", async () => {
	const { directory, raw } = await fixture();
	raw.close();
	const db = ApplicationDatabase.open(directory);
	db.close();
	const inspected = new Database(join(directory, "anishelf.sqlite"));
	try {
		expect(() =>
			inspected.exec(
				"INSERT INTO tracking_connection (id,generation,state) VALUES (1,'g','invalid')",
			),
		).toThrow();
		expect(() =>
			inspected.exec(
				"INSERT INTO tracking_connection (id,generation,state) VALUES (2,'g','disconnected')",
			),
		).toThrow();
		expect(() =>
			inspected.exec(
				"INSERT INTO tracking_intent_versions VALUES ('a','m',-1)",
			),
		).toThrow();
		expect(() =>
			inspected.exec("INSERT INTO tracking_commands VALUES ('a','c','o',-1)"),
		).toThrow();
		expect(() =>
			inspected.exec(
				"INSERT INTO metadata_artwork VALUES ('a','k','u','image/png',-1,0)",
			),
		).toThrow();
	} finally {
		inspected.close();
	}
});
