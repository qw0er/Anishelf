import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Logger } from "pino";
import { CatalogRepository } from "../../modules/anime/anime-catalog/infrastructure/repository.js";
import { MetadataRepository } from "../../modules/anime/metadata/infrastructure/repository.js";
import { PreparationRepository } from "../../modules/media/preparation/infrastructure/repository.js";
import { SubtitleRepository } from "../../modules/media/subtitles/infrastructure/repository.js";
import { PlaybackRepository } from "../../modules/playback/playback/infrastructure/repository.js";
import { SourceRepository } from "../../modules/resources/resource-access/infrastructure/repository.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../../modules/system/configuration/policy.js";
import { adapterPolicy } from "../../platform/adapter-policy.js";
import type { Store } from "../../platform/database/store.js";
import { storageRules } from "../../platform/storage.js";
import * as schema from "../schema.js";

/** Owns the connection; repositories must not outlive this object. */
export class ApplicationDatabase {
	readonly metadata: MetadataRepository;
	readonly catalog: CatalogRepository;
	readonly playback: PlaybackRepository;
	readonly subtitles: SubtitleRepository;
	readonly preparation: PreparationRepository;
	private constructor(
		private readonly connection: Database.Database,
		store: Store,
		policy: DeepReadonly<BuiltinPolicy>,
	) {
		const sources = new SourceRepository(store);
		this.catalog = new CatalogRepository(store, sources);
		this.metadata = new MetadataRepository(store);
		this.playback = new PlaybackRepository(store, sources, policy.playback);
		this.subtitles = new SubtitleRepository(store, sources);
		this.preparation = new PreparationRepository(store, sources);
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
				`busy_timeout = ${policy.database.databaseBusyTimeoutMs}`,
			);
			connection.pragma(adapterPolicy.sqlite.journal);
			connection.pragma(adapterPolicy.sqlite.synchronous);
			const store = drizzle(connection, { schema });
			migrate(store, {
				migrationsFolder: fileURLToPath(
					new URL("../../../migrations/", import.meta.url),
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

export function openDatabase(
	dataDir: string,
	logger: Logger,
	policy: DeepReadonly<BuiltinPolicy>,
): ApplicationDatabase | undefined {
	try {
		const database = ApplicationDatabase.open(dataDir, policy);
		logger.info({ event: "database.ready" }, "Database migrations applied.");
		return database;
	} catch (err) {
		logger.error(
			{ event: "database.unavailable", err },
			"Database unavailable; playback persistence is disabled.",
		);
		return undefined;
	}
}
