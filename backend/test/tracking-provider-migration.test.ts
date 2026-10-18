import { randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { TrackingCredentialFiles } from "../src/modules/anime/tracking/infrastructure/credentials.js";
import { resourceIdentityMigrationFunctions } from "../src/modules/resources/persistence.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
async function legacy() {
	const directory = await mkdtemp(
		join(tmpdir(), "anishelf-provider-migration-"),
	);
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const migrations = fileURLToPath(new URL("../migrations/", import.meta.url));
	const oldMigrations = join(directory, "migrations");
	await mkdir(join(oldMigrations, "meta"), { recursive: true });
	const journal = JSON.parse(
		await readFile(join(migrations, "meta/_journal.json"), "utf8"),
	);
	journal.entries = journal.entries.slice(0, 17);
	await writeFile(
		join(oldMigrations, "meta/_journal.json"),
		JSON.stringify(journal),
	);
	for (const entry of journal.entries)
		await copyFile(
			join(migrations, `${entry.tag}.sql`),
			join(oldMigrations, `${entry.tag}.sql`),
		);
	const raw = new Database(join(directory, "anishelf.sqlite"));
	for (const [name, fn] of Object.entries(resourceIdentityMigrationFunctions))
		raw.function(name, { deterministic: true }, fn);
	migrate(drizzle(raw), { migrationsFolder: oldMigrations });
	const credentialId = randomUUID(),
		generation = randomUUID();
	raw
		.prepare(
			"INSERT INTO tracking_connection VALUES (1, ?, 7, 'Fixture', ?, 'connected', 100)",
		)
		.run(generation, credentialId);
	const remote = { id: 11, progress: 3, status: "CURRENT", updatedAt: 100 };
	const target = {
		fileId: "root:file",
		sourceVersion: "v1",
		reviewId: "review",
		mappingRevision: 2,
		episodeId: "episode",
		mediaId: 9,
		episode: 4,
	};
	const operation = {
		id: "operation",
		accountId: 7,
		mediaId: 9,
		origin: "manual-player",
		commandId: "command",
		intentAt: 125,
		target,
		decisionReason: null,
		revision: 3,
		baseline: remote,
		desired: { progress: 4, status: "COMPLETED" },
		state: "submitting",
		remote,
		attempt: {
			revision: 2,
			baseline: remote,
			desired: { progress: 4, status: "COMPLETED" },
		},
		attempts: 2,
		retryAt: 5000,
		error: "unavailable",
		updatedAt: 200,
	};
	raw
		.prepare("INSERT INTO tracking_operations VALUES (?,7,9,?)")
		.run(operation.id, JSON.stringify(operation));
	raw
		.prepare(
			"INSERT INTO tracking_commands VALUES (7, 'command', 'operation', 3)",
		)
		.run();
	raw.prepare("INSERT INTO tracking_intent_versions VALUES (7,9,5)").run();
	raw.prepare("INSERT INTO tracking_list_cache VALUES (7,1000,?,0)").run(
		JSON.stringify([
			{
				...remote,
				mediaId: 9,
				titles: ["Fixture"],
				format: "TV",
				year: 2026,
				episodeCount: 12,
				coverUrl: null,
			},
		]),
	);
	raw.exec(
		"INSERT INTO resource_roots VALUES ('root','/media',1); INSERT INTO media_sources VALUES ('source','root','root:file','episode.mp4','v1',1); INSERT INTO playback_progress VALUES ('source',45000,100000,10,1,2);",
	);
	raw
		.prepare(
			"INSERT INTO playback_completions VALUES ('receipt','source',?,0,?)",
		)
		.run(
			JSON.stringify({ ...target, accountId: 7, generation, manualVersion: 5 }),
			JSON.stringify({ state: "pending", reason: "observation-recorded" }),
		);
	await mkdir(join(directory, "tracking-credentials"));
	await writeFile(
		join(directory, "tracking-credentials", `${credentialId}.json`),
		JSON.stringify({ generation, accountId: 7, token: "legacy-secret" }),
		{ mode: 0o600 },
	);
	return { directory, raw, operation, credentialId };
}

test("migration preserves immutable attempts, intent order, deduplication, observation contexts and legacy credential binding", async () => {
	const f = await legacy();
	f.raw.close();
	const backup = join(f.directory, "before-upgrade.sqlite");
	await copyFile(join(f.directory, "anishelf.sqlite"), backup);
	const db = ApplicationDatabase.open(f.directory);
	try {
		const operation = db.trackingOperations.list("anilist:7")[0];
		expect(operation).toMatchObject({
			id: "operation",
			commandId: "command",
			accountId: "anilist:7",
			mediaId: "anilist:anime:9",
			revision: 3,
			attempts: 2,
			retryAt: 5000,
			state: "submitting",
			intentAt: 125,
			desired: { progress: 4, status: "completed" },
			target: { mediaId: "anilist:anime:9", mappingRevision: 2 },
			attempt: {
				revision: 2,
				baseline: {
					id: "anilist:11",
					progress: 3,
					status: "watching",
					updatedAt: 100000,
				},
				desired: { progress: 4, status: "completed" },
			},
		});
		expect(
			db.trackingOperations.manualVersion("anilist:7", "anilist:anime:9"),
		).toBe(5);
		expect(db.trackingOperations.command("anilist:7", "command")).toMatchObject(
			{ operationId: "operation", revision: 3 },
		);
		expect(db.trackingLists.read("anilist:7")?.entries[0]).toMatchObject({
			id: "anilist:11",
			mediaId: "anilist:anime:9",
			status: "watching",
			updatedAt: 100000,
		});
		const observation = db.playback.completions(undefined, true)[0];
		expect(JSON.parse(observation?.context ?? "null")).toMatchObject({
			version: 2,
			accountId: "anilist:7",
			mediaId: "anilist:anime:9",
			manualVersion: 5,
		});
		expect(observation?.outcome.state).toBe("pending");
		expect(db.playback.get("source")?.positionMs).toBe(45000);
		const connection = db.tracking.get();
		if (!connection) throw new Error("Missing connection");
		const credentials = new TrackingCredentialFiles(f.directory);
		await credentials.initialize(f.credentialId);
		expect(await credentials.read(connection)).toBe("legacy-secret");
		await expect(
			credentials.read({
				...connection,
				account: { id: "other:7", name: "Other" },
			}),
		).rejects.toThrow();
		expect(
			await readFile(
				join(f.directory, "tracking-credentials", `${f.credentialId}.json`),
				"utf8",
			),
		).not.toContain('"version":2');
	} finally {
		db.close();
	}
	const reopened = ApplicationDatabase.open(f.directory);
	expect(reopened.trackingOperations.list("anilist:7")[0]?.revision).toBe(3);
	reopened.close();
	// A paired pre-upgrade backup remains readable and can be upgraded independently.
	const restored = join(f.directory, "restored");
	await mkdir(restored);
	await mkdir(join(restored, "tracking-credentials"));
	await copyFile(backup, join(restored, "anishelf.sqlite"));
	await copyFile(
		join(f.directory, "tracking-credentials", `${f.credentialId}.json`),
		join(restored, "tracking-credentials", `${f.credentialId}.json`),
	);
	const restoredDb = ApplicationDatabase.open(restored);
	try {
		const connection = restoredDb.tracking.get();
		if (!connection) throw new Error("Missing restored account");
		expect(await new TrackingCredentialFiles(restored).read(connection)).toBe(
			"legacy-secret",
		);
		expect(
			restoredDb.trackingOperations.list("anilist:7")[0]?.attempt?.revision,
		).toBe(2);
	} finally {
		restoredDb.close();
	}
});

test("a failed migration rolls back table rebuilds and retries without double-prefixing identities", async () => {
	const f = await legacy();
	f.raw
		.prepare("UPDATE tracking_operations SET operation = 'invalid-json'")
		.run();
	f.raw.close();
	expect(() => ApplicationDatabase.open(f.directory)).toThrow();
	const raw = new Database(join(f.directory, "anishelf.sqlite"));
	try {
		expect(
			raw.prepare("SELECT account_id FROM tracking_connection").get(),
		).toEqual({ account_id: 7 });
		expect(
			raw.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get(),
		).toEqual({ count: 17 });
		raw
			.prepare("UPDATE tracking_operations SET operation = ?")
			.run(JSON.stringify(f.operation));
	} finally {
		raw.close();
	}
	const db = ApplicationDatabase.open(f.directory);
	try {
		expect(db.trackingOperations.list("anilist:7")[0]?.mediaId).toBe(
			"anilist:anime:9",
		);
	} finally {
		db.close();
	}
});

test("startup reconciles an upgraded uncertain AniList attempt without submitting its payload again", async () => {
	const f = await legacy();
	f.raw.close();
	const database = ApplicationDatabase.open(f.directory);
	const { createTrackingModule } = await import(
		"../src/modules/anime/composition/tracking.js"
	);
	const { createAniListTracking } = await import(
		"../src/modules/anime/composition/anilist.js"
	);
	const { vi } = await import("vitest");
	const request = vi.fn(async () => ({
		MediaList: {
			id: 11,
			userId: 7,
			mediaId: 9,
			progress: 4,
			status: "COMPLETED",
			updatedAt: 101,
			media: { type: "ANIME" },
		},
	}));
	const module = await createTrackingModule({
		dataDir: f.directory,
		store: database.tracking,
		listStore: database.trackingLists,
		operationStore: database.trackingOperations,
		...createAniListTracking({ request }),
	});
	try {
		await vi.waitFor(() =>
			expect(module.operations(module.status().generation)[0]?.state).toBe(
				"succeeded",
			),
		);
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0]).toBeDefined();
		expect(
			database.trackingOperations.manualVersion("anilist:7", "anilist:anime:9"),
		).toBe(5);
	} finally {
		await module.close();
		database.close();
	}
});
