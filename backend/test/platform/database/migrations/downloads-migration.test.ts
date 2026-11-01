import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { expect, test } from "vitest";

test("one-off migration preserves accepted subscription tasks and retains episode/hash uniqueness", async () => {
	const base = await readFile(
		new URL(
			"../../../../migrations/0000_relational_schema.sql",
			import.meta.url,
		),
		"utf8",
	);
	const table = base.match(
		/CREATE TABLE `acquisition_intents` \([\s\S]*?\n\);/,
	)?.[0];
	if (!table) throw new Error("Missing original intent schema");
	const migration = await readFile(
		new URL(
			"../../../../migrations/0018_individual_episode_downloads.sql",
			import.meta.url,
		),
		"utf8",
	);
	const db = new Database(":memory:");
	try {
		db.exec(table);
		db.exec(`INSERT INTO acquisition_intents (
 id, revision, work_key, candidate_id, episode, title, hash, source,
 destination_revision, destination_scope_id, destination_path, destination_connection_generation,
 destination_validated, destination_visibility_verified, directory, subscription_revision,
 state, ingestion, progress, attempts, next_attempt_at, updated_at, created_at, source_identity_present, last_command_present
 ) VALUES ('accepted', 'revision', 'work', 'candidate', 3, 'Release', 'hash', 'opaque-source',
 'destination', 'root', '/downloads', 'client', 1, 1, 'Anime', 'subscription',
 'bound', 'not-ready', 0.42, 1, 0, 1000, 1000, 0, 0)`);
		db.exec(migration);
		expect(
			db
				.prepare(
					"SELECT origin, one_off, subscription_revision, state, progress, source FROM acquisition_intents",
				)
				.get(),
		).toEqual({
			origin: "subscription",
			one_off: null,
			subscription_revision: "subscription",
			state: "bound",
			progress: 0.42,
			source: "opaque-source",
		});
		expect(() =>
			db.exec("UPDATE acquisition_intents SET origin = 'unknown'"),
		).toThrow();
		expect(() =>
			db.exec("UPDATE acquisition_intents SET one_off = 'broken-json'"),
		).toThrow();
		db.exec(
			"UPDATE acquisition_intents SET origin = 'one-off', subscription_revision = NULL, state = 'discovering', one_off = '{}'",
		);
		expect(
			db
				.prepare("SELECT state, subscription_revision FROM acquisition_intents")
				.get(),
		).toEqual({ state: "discovering", subscription_revision: null });
		const indexes = db
			.prepare("PRAGMA index_list(acquisition_intents)")
			.all() as { name: string; unique: number }[];
		expect(indexes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "acquisition_episode_reservation",
					unique: 1,
				}),
				expect.objectContaining({
					name: "acquisition_hash_reservation",
					unique: 1,
				}),
			]),
		);
	} finally {
		db.close();
	}
});
