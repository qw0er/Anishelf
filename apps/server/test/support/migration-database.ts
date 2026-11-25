import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { workKey, workReference } from "@anishelf/contracts/references";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

/** Creates a database at the committed schema a migration test starts from. */
export function openMigrationDatabase(directory: string, through: number) {
	const migrations = readMigrationFiles({
		migrationsFolder: fileURLToPath(
			new URL("../../migrations/", import.meta.url),
		),
	});
	if (!migrations[through])
		throw new Error("Missing migration fixture version.");
	const db = new Database(join(directory, "anishelf.sqlite"));
	try {
		db.function("anishelf_work_key", (provider: string, id: string) =>
			workKey({ provider, id, mediaType: "anime" }),
		);
		db.function(
			"anishelf_provider",
			(key: string) => workReference(key).provider,
		);
		db.function("anishelf_provider_id", (key: string) => workReference(key).id);
		db.function(
			"anishelf_identity_split",
			(_work: string, _count: number) => 1,
		);
		db.function(
			"anishelf_acquisition_backfilled",
			(_claims: number, _transfers: number, _files: number) => 1,
		);
		db.pragma("foreign_keys = OFF");
		db.exec(
			"CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC); PRAGMA user_version = 1;",
		);
		const record = db.prepare(
			"INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
		);
		db.transaction(() => {
			for (const migration of migrations.slice(0, through + 1)) {
				for (const sql of migration.sql) db.exec(sql);
				record.run(migration.hash, migration.folderMillis);
			}
		})();
		return db;
	} catch (error) {
		db.close();
		throw error;
	}
}
