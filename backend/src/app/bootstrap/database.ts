import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Logger } from "pino";
import {
	createAcquisitionPersistence,
	createDownloadPersistence,
	type DiscoveryStore,
	type DownloadStore,
} from "../../modules/acquisition/persistence.js";
import {
	type AnimePersistence,
	createAnimePersistence,
} from "../../modules/anime/persistence.js";
import {
	createMediaPersistence,
	type MediaPersistence,
} from "../../modules/media/persistence.js";
import {
	createPlaybackPersistence,
	type PlaybackPersistence,
} from "../../modules/playback/persistence.js";
import { createResourcesPersistence } from "../../modules/resources/persistence.js";
import { createAuthenticationPersistence } from "../../modules/system/persistence.js";
import type { AuthenticationStore } from "../../modules/system/public.js";
import { adapterPolicy } from "../../platform/adapter-policy.js";
import type { Store } from "../../platform/database/store.js";
import { storageRules } from "../../platform/storage.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../policy.js";
import * as schema from "../schema.js";

/** Owns the connection; repositories must not outlive this object. */
export class ApplicationDatabase {
	readonly acquisition: DiscoveryStore;
	readonly acquisitionDownloads: DownloadStore;
	readonly authentication: AuthenticationStore;
	readonly trackingOperations: AnimePersistence["trackingOperations"];
	readonly trackingLists: AnimePersistence["trackingLists"];
	readonly tracking: AnimePersistence["tracking"];
	readonly metadata: AnimePersistence["metadata"];
	readonly catalog: AnimePersistence["catalog"];
	readonly playback: PlaybackPersistence["playback"];
	readonly subtitles: MediaPersistence["subtitles"];
	readonly preparation: MediaPersistence["preparation"];
	private constructor(
		private readonly connection: Database.Database,
		store: Store,
		policy: DeepReadonly<BuiltinPolicy>,
	) {
		this.authentication = createAuthenticationPersistence(store);
		this.acquisition = createAcquisitionPersistence(store);
		this.acquisitionDownloads = createDownloadPersistence(store);
		const { sources } = createResourcesPersistence(store);
		const anime = createAnimePersistence(store, sources);
		const media = createMediaPersistence(store, sources);
		const playback = createPlaybackPersistence(store, sources, policy.playback);
		this.catalog = anime.catalog;
		this.tracking = anime.tracking;
		this.trackingLists = anime.trackingLists;
		this.trackingOperations = anime.trackingOperations;
		this.metadata = anime.metadata;
		this.playback = playback.playback;
		this.subtitles = media.subtitles;
		this.preparation = media.preparation;
	}

	static open(
		dataDir: string,
		policy: DeepReadonly<BuiltinPolicy> = builtinPolicy,
	): ApplicationDatabase {
		mkdirSync(dataDir, { recursive: true, mode: storageRules.directoryMode });
		const connection = new Database(join(dataDir, storageRules.databaseFile));
		try {
			const schemaVersion = connection.pragma("user_version", { simple: true });
			const existingTables = connection
				.prepare(
					"SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
				)
				.get() as { count: number };
			if (
				(schemaVersion !== 0 && schemaVersion !== 1) ||
				(existingTables.count > 0 && schemaVersion !== 1)
			)
				throw new Error(
					"Unsupported database format. This application requires a new relational database; existing files were preserved.",
				);
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
			if ((connection.pragma("foreign_key_check") as unknown[]).length)
				throw new Error("Database schema contains invalid foreign keys.");
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
): ApplicationDatabase {
	try {
		const database = ApplicationDatabase.open(dataDir, policy);
		logger.info(
			{ event: "database.ready", schemaVersion: 1 },
			"Relational database is ready.",
		);
		return database;
	} catch (err) {
		logger.error(
			{ event: "database.unavailable", err },
			"Database unavailable; startup is blocked.",
		);
		throw err;
	}
}
