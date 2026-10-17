import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Logger } from "pino";
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
import {
	createResourcesPersistence,
	resourceIdentityMigrationFunctions,
} from "../../modules/resources/persistence.js";
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
			connection.pragma(adapterPolicy.sqlite.foreignKeys);
			connection.pragma(
				`busy_timeout = ${policy.database.databaseBusyTimeoutMs}`,
			);
			connection.pragma(adapterPolicy.sqlite.journal);
			connection.pragma(adapterPolicy.sqlite.synchronous);
			for (const [name, implementation] of Object.entries(
				resourceIdentityMigrationFunctions,
			))
				connection.function(name, { deterministic: true }, implementation);
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
): ApplicationDatabase {
	try {
		const database = ApplicationDatabase.open(dataDir, policy);
		logger.info({ event: "database.ready" }, "Database migrations applied.");
		return database;
	} catch (err) {
		logger.error(
			{ event: "database.unavailable", err },
			"Database unavailable; startup is blocked.",
		);
		throw err;
	}
}
