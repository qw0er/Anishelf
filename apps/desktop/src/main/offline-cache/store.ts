import type { OfflineCacheEntry } from "@anishelf/contracts/offline-cache";
import type { SubtitleFormat } from "@anishelf/contracts/subtitles";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import {
	type BetterSQLite3Database,
	drizzle,
} from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export interface CacheFile {
	name: string;
	size: number;
	modifiedAt: number;
	mime: string;
}

export interface CacheManifest {
	video: CacheFile;
	format: string;
	subtitles: {
		id: string;
		format: SubtitleFormat;
		label: string;
		language: string | null;
		file: CacheFile;
	}[];
}

export interface CacheRecord {
	entry: Omit<OfflineCacheEntry, "playing">;
	positionMs: number;
	manifest?: CacheManifest;
}

const entries = sqliteTable(
	"entries",
	{
		id: text("id").primaryKey(),
		server: text("server").notNull(),
		fileId: text("file_id").notNull(),
		sourceVersion: text("source_version"),
		data: text("data", { mode: "json" }).$type<CacheRecord>().notNull(),
	},
	(table) => [unique().on(table.server, table.fileId, table.sourceVersion)],
);

export class OfflineCacheStore {
	private readonly connection: Database.Database;
	private readonly db: BetterSQLite3Database;

	constructor(path: string) {
		const connection = new Database(path);
		try {
			const db = drizzle(connection);
			// Retain the existing strict table and row order when opening older indexes.
			db.run(sql`
				CREATE TABLE IF NOT EXISTS entries (
					id TEXT PRIMARY KEY,
					server TEXT NOT NULL,
					file_id TEXT NOT NULL,
					source_version TEXT,
					data TEXT NOT NULL,
					UNIQUE(server, file_id, source_version)
				) STRICT
			`);
			this.connection = connection;
			this.db = db;
			console.info("desktop.cache_index_opened");
		} catch (error) {
			connection.close();
			throw error;
		}
	}

	list() {
		return this.db
			.select({ data: entries.data })
			.from(entries)
			.orderBy(sql`rowid`)
			.all()
			.map(({ data }) => data);
	}

	save(record: CacheRecord) {
		const { id, server, fileId, sourceVersion } = record.entry;
		this.db
			.insert(entries)
			.values({ id, server, fileId, sourceVersion, data: record })
			.onConflictDoUpdate({
				target: entries.id,
				set: { sourceVersion, data: record },
			})
			.run();
	}

	remove(id: string) {
		this.db.delete(entries).where(eq(entries.id, id)).run();
	}

	close() {
		this.connection.close();
	}
}
