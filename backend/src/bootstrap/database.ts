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
} from "../modules/configuration/domain/policy.js";
import { PlaybackRepository } from "../modules/playback/infrastructure/repository.js";
import { SourceRepository } from "../modules/resource-access/infrastructure/repository.js";
import { SubtitleRepository } from "../modules/subtitles/infrastructure/repository.js";
import { adapterPolicy } from "../platform/adapter-policy.js";
import * as schema from "../platform/database/schema.js";

import type { Store } from "../platform/database/store.js";
import { storageRules } from "../platform/storage.js";

/** Owns the connection; repositories must not outlive this object. */
export class ApplicationDatabase {
	readonly playback: PlaybackRepository;
	readonly subtitles: SubtitleRepository;
	private constructor(
		private readonly connection: Database.Database,
		store: Store,
		policy: DeepReadonly<BuiltinPolicy>,
	) {
		const sources = new SourceRepository(store);
		this.playback = new PlaybackRepository(store, sources, policy.playback);
		this.subtitles = new SubtitleRepository(store, sources);
	}

	static open(
		dataDir: string,
		policy: DeepReadonly<BuiltinPolicy> = builtinPolicy,
	): ApplicationDatabase {
		mkdirSync(dataDir, { recursive: true, mode: storageRules.directoryMode });
		const connection = new Database(join(dataDir, storageRules.databaseFile));
		try {
			connection.pragma(adapterPolicy.sqlite.foreignKeys);
			connection.pragma(
				`busy_timeout = ${policy.runtime.databaseBusyTimeoutMs}`,
			);
			connection.pragma(adapterPolicy.sqlite.journal);
			connection.pragma(adapterPolicy.sqlite.synchronous);
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
