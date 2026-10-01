import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { PlaybackRepository } from "./playback-repository.js";
import * as schema from "./schema.js";

export type Store = ReturnType<typeof drizzle<typeof schema>>;

/** Owns the connection; repositories must not outlive this object. */
export class ApplicationDatabase {
	readonly playback: PlaybackRepository;
	private constructor(
		private readonly connection: Database.Database,
		store: Store,
	) {
		this.playback = new PlaybackRepository(store);
	}

	static open(dataDir: string): ApplicationDatabase {
		mkdirSync(dataDir, { recursive: true, mode: 0o700 });
		const connection = new Database(join(dataDir, "anishelf.sqlite"));
		try {
			connection.pragma("foreign_keys = ON");
			connection.pragma("busy_timeout = 5000");
			connection.pragma("journal_mode = WAL");
			connection.pragma("synchronous = FULL");
			const store = drizzle(connection, { schema });
			migrate(store, {
				migrationsFolder: fileURLToPath(
					new URL("../../migrations/", import.meta.url),
				),
			});
			return new ApplicationDatabase(connection, store);
		} catch (error) {
			connection.close();
			throw error;
		}
	}

	close(): void {
		this.connection.close();
	}
}
