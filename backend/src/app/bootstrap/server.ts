import type { Logger } from "pino";
import { MediaInspectionApplication } from "../../modules/media/media-inspection/application.js";
import { PlaybackSelectionApplication } from "../../modules/playback/playback-selection/application/selection.js";
import type { LibraryApplication } from "../../modules/resources/library/application/library.js";
import type { ConfigurationService } from "../../modules/system/configuration/application/service.js";
import type { MediaTools } from "../../platform/media/index.js";
import { createCatalogModule } from "./catalog.js";
import type { ApplicationDatabase } from "./database.js";
import { createHttpApp } from "./http.js";
import { createIdentificationModule } from "./identification.js";
import { createMediaExecutionModule } from "./media-execution.js";
import {
	createIdentificationMetadata,
	createMetadataModule,
} from "./metadata.js";
import { createPlaybackModule } from "./playback.js";
import { createPlaybackCopies } from "./playback-selection.js";
import {
	createPreparationModule,
	initializePreparationModule,
} from "./preparation.js";
import { createSubtitleModule, initializeSubtitleModule } from "./subtitles.js";

type HttpApp = ReturnType<typeof createHttpApp>;
export async function createServer(
	configuration: ConfigurationService,
	logger: Logger,
	library: LibraryApplication,
	database: ApplicationDatabase | undefined,
	tools: MediaTools,
): Promise<HttpApp> {
	const config = configuration.deployment;
	const development = configuration.environment.development;
	const frontendRoot = config.frontendDir;
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools,
		policy: configuration.policy.mediaInspection,
		logger,
	});
	const execution = createMediaExecutionModule({
		configuration,
		inspection,
		sources: library.sources,
		tools,
		logger,
	});
	const planning = execution.planning;
	const playback = createPlaybackModule({
		configuration,
		library,
		database,
		logger,
	});
	const subtitles = createSubtitleModule({
		configuration,
		library,
		database,
		tools,
		inspection,
		logger,
	});
	const preparation = createPreparationModule({
		configuration,
		library,
		database,
		planning,
		processing: execution.processing,
		logger,
	});
	await initializePreparationModule(preparation, logger);
	await initializeSubtitleModule(subtitles, logger);
	const playbackSelection = new PlaybackSelectionApplication({
		sources: library.sources,
		planning,
		copies: createPlaybackCopies(preparation),
		selectedProfileId: () =>
			configuration.getTranscodeProfileCatalog().selectedProfileId,
	});
	let metadata: Awaited<ReturnType<typeof createMetadataModule>> | undefined;
	if (database) {
		try {
			metadata = await createMetadataModule({
				dataDir: config.dataDir,
				store: database.metadata,
				logger,
			});
		} catch (err) {
			logger.warn(
				{ event: "metadata.unavailable", err },
				"Metadata cache unavailable; local identification remains usable.",
			);
		}
	}
	const catalog = createCatalogModule({ database, metadata, library, logger });
	const identification = createIdentificationModule({
		...(catalog
			? {
					onPublication: (results, canonicalRoot) =>
						catalog.publish(results, canonicalRoot),
				}
			: {}),
		...(metadata ? { metadata: createIdentificationMetadata(metadata) } : {}),
		library,
		sources: library.sources,
		logger,
	});
	const server = createHttpApp({
		...(catalog ? { catalog } : {}),
		...(metadata ? { metadata } : {}),
		playbackSelection,
		configuration,
		config,
		policy: configuration.policy,
		logger,
		library,
		playback,
		preparation,
		subtitles,
		inspection,
		mediaPlanning: planning,
		development,
		closeDependencies: async () => {
			// Stop durable owners before their shared executor and inspection dependencies.
			await identification.close();
			catalog?.close();
			await metadata?.close();
			await preparation.close();
			playback.close();
			await subtitles.close();
			await library.close();
			await execution.close();
			await inspection.close();
			database?.close();
		},
		...(frontendRoot === undefined ? {} : { frontendRoot }),
	});
	return server;
}
