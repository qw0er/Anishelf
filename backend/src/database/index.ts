import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../config/policy.js";
import { PlaybackRepository } from "./playback-repository.js";
import * as schema from "./schema.js";
import { SubtitleRepository } from "./subtitle-repository.js";

export type Store = ReturnType<typeof drizzle<typeof schema>>;

/** Owns the connection; repositories must not outlive this object. */
export class ApplicationDatabase {
	readonly playback: PlaybackRepository;
	readonly subtitles: SubtitleRepository;
	private constructor(
		private readonly connection: Database.Database,
		store: Store,
		policy: DeepReadonly<BuiltinPolicy>,
	) {
		this.playback = new PlaybackRepository(store, policy.playback);
		this.subtitles = new SubtitleRepository(store, this.playback);
	}

	static open(
		dataDir: string,
		policy: DeepReadonly<BuiltinPolicy> = builtinPolicy,
	): ApplicationDatabase {
		mkdirSync(dataDir, { recursive: true, mode: 0o700 });
		const connection = new Database(join(dataDir, "anishelf.sqlite"));
		try {
			connection.pragma("foreign_keys = ON");
			connection.pragma(
				`busy_timeout = ${policy.runtime.databaseBusyTimeoutMs}`,
			);
			connection.pragma("journal_mode = WAL");
			connection.pragma("synchronous = FULL");
			const store = drizzle(connection, { schema });
			migrate(store, {
				migrationsFolder: fileURLToPath(
					new URL("../../migrations/", import.meta.url),
				),
			});
			return new ApplicationDatabase(connection, store, policy);
		} catch (error) {
			connection.close();
			throw error;
		}
	}

	close(): void {
		this.connection.close();
	}
}
