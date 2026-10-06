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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationDatabase } from "../src/bootstrap/database.js";

let directory: string;
let database: ApplicationDatabase;
const identity = {
	canonicalRoot: "/media",
	fileId: "file_1",
	relativePath: "episode.mkv",
	sourceVersion: "v1",
};
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "anishelf-db-"));
	database = ApplicationDatabase.open(directory);
});
afterEach(async () => {
	database.close();
	await rm(directory, { recursive: true, force: true });
});

describe("playback persistence", () => {
	it("upgrades legacy progress without losing history or weakening constraints", async () => {
		const legacyDir = join(directory, "legacy");
		const migrationDir = join(directory, "legacy-migrations");
		await mkdir(legacyDir);
		await mkdir(join(migrationDir, "meta"), { recursive: true });
		const migrations = fileURLToPath(
			new URL("../migrations/", import.meta.url),
		);
		const journal = JSON.parse(
			await readFile(join(migrations, "meta/_journal.json"), "utf8"),
		);
		journal.entries = journal.entries.slice(0, 1);
		await writeFile(
			join(migrationDir, "meta/_journal.json"),
			JSON.stringify(journal),
		);
		await copyFile(
			join(migrations, "0000_playback_progress.sql"),
			join(migrationDir, "0000_playback_progress.sql"),
		);
		const raw = new Database(join(legacyDir, "anishelf.sqlite"));
		try {
			migrate(drizzle(raw), { migrationsFolder: migrationDir });
			raw.exec(
				"INSERT INTO resource_roots VALUES ('root', '/media', 1); INSERT INTO media_sources VALUES ('source', 'root', 'file', 'episode.mp4', 'v1', 1); INSERT INTO playback_progress VALUES ('source', 45000, 100000, 10, 9, 7, 3);",
			);
		} finally {
			raw.close();
		}
		const upgraded = ApplicationDatabase.open(legacyDir);
		try {
			expect(upgraded.playback.get("source")).toEqual({
				sourceId: "source",
				positionMs: 45000,
				durationMs: 100000,
				lastViewedAtMs: 10,
				generation: 7,
				lastSequence: 3,
			});
			const inspection = new Database(join(legacyDir, "anishelf.sqlite"));
			try {
				expect(
					inspection.prepare("PRAGMA table_info(playback_progress)").all(),
				).not.toEqual(
					expect.arrayContaining([
						expect.objectContaining({ name: "revision" }),
					]),
				);
				expect(inspection.prepare("PRAGMA foreign_key_check").all()).toEqual(
					[],
				);
				expect(() =>
					inspection.exec("UPDATE playback_progress SET generation = 0"),
				).toThrow();
				expect(
					inspection
						.prepare(
							"SELECT sql FROM sqlite_master WHERE name = 'progress_recent'",
						)
						.get(),
				).toEqual({ sql: expect.stringContaining('"last_viewed_at_ms" desc') });
			} finally {
				inspection.close();
			}
		} finally {
			upgraded.close();
		}
	});

	it("applies migrations once, persists across reopen, and isolates roots and versions", () => {
		const source = database.playback.registerSource(identity, 1);
		expect(database.playback.registerSource(identity, 2)).toEqual(source);
		const initial = database.playback.openGeneration(source.id);
		expect(initial.lastViewedAtMs).toBeNull();
		database.playback.save(
			{
				sourceId: source.id,
				generation: initial.generation,
				sequence: 1,
				positionMs: 45000,
				durationMs: 100000,
			},
			10,
		);
		database.close();
		database = ApplicationDatabase.open(directory);
		expect(database.playback.get(source.id)?.positionMs).toBe(45000);
		const replaced = database.playback.registerSource({
			...identity,
			sourceVersion: "v2",
		});
		const otherRoot = database.playback.registerSource({
			...identity,
			canonicalRoot: "/other",
		});
		expect(replaced.id).not.toBe(source.id);
		expect(otherRoot.id).not.toBe(source.id);
		expect(database.playback.get(replaced.id)).toBeUndefined();
		const raw = new Database(join(directory, "anishelf.sqlite"));
		try {
			expect(
				raw.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get(),
			).toEqual({ count: 6 });
			expect(raw.pragma("journal_mode", { simple: true })).toBe("wal");
		} finally {
			raw.close();
		}
	});

	it("rejects stale generations/sequences and preserves backward seeks and idempotent retries", () => {
		const source = database.playback.registerSource(identity);
		const row = database.playback.openGeneration(source.id);
		const update = {
			sourceId: source.id,
			generation: row.generation,
			sequence: 1,
			positionMs: 70000,
			durationMs: 100000,
		};
		expect(database.playback.save(update, 10).status).toBe("saved");
		const backward = { ...update, sequence: 2, positionMs: 20000 };
		expect(database.playback.save(backward, 20).status).toBe("saved");
		expect(database.playback.save(update, 30).status).toBe("stale");
		expect(database.playback.save(backward, 40).status).toBe("duplicate");
		expect(database.playback.get(source.id)?.lastViewedAtMs).toBe(20);
		expect(
			database.playback.save({ ...backward, positionMs: 25000 }).status,
		).toBe("stale");
		const zero = { ...backward, sequence: 3, positionMs: 0 };
		expect(database.playback.save(zero, 50).status).toBe("saved");
		const reopened = database.playback.openGeneration(source.id);
		expect(reopened.generation).toBe(row.generation + 1);
		expect(reopened.positionMs).toBe(0);
		expect(reopened.lastViewedAtMs).toBe(50);
		expect(database.playback.save({ ...zero, sequence: 4 }).status).toBe(
			"stale",
		);
	});

	it("filters near-end candidates, retains unknown duration, and orders within a root", () => {
		const first = database.playback.registerSource(identity);
		const second = database.playback.registerSource({
			...identity,
			fileId: "file_2",
			relativePath: "second.mkv",
		});
		const other = database.playback.registerSource({
			...identity,
			canonicalRoot: "/other",
		});
		for (const source of [first, second, other]) {
			const row = database.playback.openGeneration(source.id);
			database.playback.save(
				{
					sourceId: source.id,
					generation: row.generation,
					sequence: 1,
					positionMs: 94999,
					durationMs: 100000,
				},
				source === first ? 10 : 20,
			);
		}
		expect(
			database.playback
				.listHistory(first.rootId, undefined, 0, "continue")
				.map((item) => item.source.id),
		).toEqual([second.id, first.id]);
		database.playback.save(
			{
				sourceId: second.id,
				generation: 1,
				sequence: 2,
				positionMs: 95000,
				durationMs: 100000,
			},
			30,
		);
		expect(
			database.playback.listHistory(first.rootId, undefined, 0, "continue"),
		).toHaveLength(1);
		database.playback.save(
			{
				sourceId: second.id,
				generation: 1,
				sequence: 3,
				positionMs: 100000,
				durationMs: null,
			},
			40,
		);
		expect(
			database.playback.listHistory(first.rootId, undefined, 0, "continue")[0]
				?.source.id,
		).toBe(second.id);
	});

	it("enforces foreign keys and validates invalid times without altering history", () => {
		expect(() => database.playback.openGeneration("missing")).toThrow();
		const source = database.playback.registerSource(identity);
		database.playback.openGeneration(source.id);
		const update = {
			sourceId: source.id,
			generation: 1,
			sequence: 1,
			positionMs: 10,
			durationMs: 100,
		};
		for (const positionMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
			expect(() => database.playback.save({ ...update, positionMs })).toThrow();
		expect(() =>
			database.playback.save({ ...update, durationMs: 0 }),
		).toThrow();
		expect(database.playback.get(source.id)?.lastSequence).toBe(0);
		database.playback.save({ ...update, positionMs: 200 });
		expect(database.playback.get(source.id)?.positionMs).toBe(100);
		const raw = new Database(join(directory, "anishelf.sqlite"));
		try {
			raw.pragma("foreign_keys = ON");
			expect(() =>
				raw.prepare("DELETE FROM media_sources WHERE id = ?").run(source.id),
			).toThrow();
			expect(() =>
				raw
					.prepare(
						"UPDATE playback_progress SET position_ms = -1 WHERE source_id = ?",
					)
					.run(source.id),
			).toThrow();
		} finally {
			raw.close();
		}
	});

	it("preserves a corrupt database instead of replacing it", async () => {
		const brokenDirectory = join(directory, "broken");
		await import("node:fs/promises").then(({ mkdir }) =>
			mkdir(brokenDirectory),
		);
		const path = join(brokenDirectory, "anishelf.sqlite");
		const content = Buffer.from("not a sqlite database");
		await writeFile(path, content);
		expect(() => ApplicationDatabase.open(brokenDirectory)).toThrow();
		expect(await readFile(path)).toEqual(content);
	});
});
