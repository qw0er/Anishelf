import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Logger } from "pino";
import {
	type AcquisitionStore,
	createAcquisitionPersistence,
	createDownloadPersistence,
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
import type { PlaybackPolicy } from "../../modules/playback/create.js";
import {
	createPlaybackPersistence,
	type PlaybackPersistence,
} from "../../modules/playback/persistence.js";
import { createResourcesPersistence } from "../../modules/resources/persistence.js";
import { createAuthenticationPersistence } from "../../modules/system/persistence.js";
import type { AuthenticationStore } from "../../modules/system/public.js";
import type { Store } from "../../platform/database/store.js";
import { storageRules } from "../../platform/storage.js";
import { workKey, workReference } from "../../shared/external-reference.js";
import type { DeepReadonly } from "../../shared/policy.js";

import * as schema from "../schema.js";

const databaseBusyTimeoutMs = 5000;

/** Owns the connection; repositories must not outlive this object. */
export class ApplicationDatabase {
	readonly acquisition: AcquisitionStore;
	readonly acquisitionDownloads: DownloadStore;
	readonly authentication: AuthenticationStore;
	readonly trackingOperations: AnimePersistence["trackingOperations"];
	readonly trackingLists: AnimePersistence["trackingLists"];
	readonly tracking: AnimePersistence["tracking"];
	readonly metadata: AnimePersistence["metadata"];
	readonly catalog: AnimePersistence["catalog"];
	readonly playback: PlaybackPersistence["playback"];
	readonly subtitles: MediaPersistence["subtitles"];
	readonly inspections: MediaPersistence["inspections"];
	readonly preparation: MediaPersistence["preparation"];
	private constructor(
		private readonly connection: Database.Database,
		store: Store,
		playbackPolicy?: DeepReadonly<PlaybackPolicy>,
	) {
		this.authentication = createAuthenticationPersistence(store);
		this.acquisition = createAcquisitionPersistence(store);
		this.acquisitionDownloads = createDownloadPersistence(store);
		const { sources } = createResourcesPersistence(store);
		const anime = createAnimePersistence(store, sources);
		const media = createMediaPersistence(store, sources);
		const playback = createPlaybackPersistence(store, sources, playbackPolicy);
		this.catalog = anime.catalog;
		this.tracking = anime.tracking;
		this.trackingLists = anime.trackingLists;
		this.trackingOperations = anime.trackingOperations;
		this.metadata = anime.metadata;
		this.playback = playback.playback;
		this.subtitles = media.subtitles;
		this.preparation = media.preparation;
		this.inspections = media.inspections;
	}

	static open(
		dataDir: string,
		playbackPolicy?: DeepReadonly<PlaybackPolicy>,
	): ApplicationDatabase {
		mkdirSync(dataDir, { recursive: true, mode: storageRules.directoryMode });
		return ApplicationDatabase.initialize(
			new Database(join(dataDir, storageRules.databaseFile)),
			playbackPolicy,
		);
	}

	/** Isolated SQLite connection for consumers that do not need disk persistence. */
	static openMemory(
		playbackPolicy?: DeepReadonly<PlaybackPolicy>,
	): ApplicationDatabase {
		return ApplicationDatabase.initialize(
			new Database(":memory:"),
			playbackPolicy,
		);
	}

	private static initialize(
		connection: Database.Database,
		playbackPolicy?: DeepReadonly<PlaybackPolicy>,
	): ApplicationDatabase {
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
			connection.pragma("foreign_keys = ON");
			connection.pragma(`busy_timeout = ${databaseBusyTimeoutMs}`);
			connection.pragma("journal_mode = WAL");
			connection.pragma("synchronous = FULL");
			const store = drizzle(connection, { schema });
			// Migration-only identity functions preserve opaque, encoded provider IDs.
			connection.function("anishelf_work_key", (provider: string, id: string) =>
				workKey({ provider, mediaType: "anime", id }),
			);
			connection.function(
				"anishelf_provider",
				(key: string) => workReference(key).provider,
			);
			connection.function(
				"anishelf_provider_id",
				(key: string) => workReference(key).id,
			);
			connection.pragma("foreign_keys = OFF");
			migrate(store, {
				migrationsFolder: fileURLToPath(
					new URL("../../../migrations/", import.meta.url),
				),
			});
			connection.pragma("foreign_keys = ON");
			if ((connection.pragma("foreign_key_check") as unknown[]).length)
				throw new Error("Database schema contains invalid foreign keys.");
			return new ApplicationDatabase(connection, store, playbackPolicy);
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
	playbackPolicy?: DeepReadonly<PlaybackPolicy>,
): ApplicationDatabase {
	try {
		const database = ApplicationDatabase.open(dataDir, playbackPolicy);
		logger.info(
			{
				event: "database.ready",
				schemaVersion: 1,
				busyTimeoutMs: databaseBusyTimeoutMs,
			},
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
