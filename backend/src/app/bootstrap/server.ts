import type { Logger } from "pino";
import { createAcquisitionModule } from "../../modules/acquisition/create.js";
import { createAnimeModule } from "../../modules/anime/create.js";
import { createMediaModule } from "../../modules/media/create.js";
import { createPlaybackModule } from "../../modules/playback/create.js";
import { createResourcesModule } from "../../modules/resources/create.js";
import { createAuthenticationModule } from "../../modules/system/create.js";
import { registerSystemHttp } from "../../modules/system/http.js";
import type { SystemApi } from "../../modules/system/public.js";
import type { MediaTools } from "../../platform/media/index.js";
import { registerAnimeDetailRoutes } from "../anime-detail.js";
import { closeModules } from "../lifecycle.js";
import type { ApplicationDatabase } from "./database.js";
import { createHttpApp } from "./http.js";
export async function createServer(
	system: SystemApi,
	logger: Logger,
	database: ApplicationDatabase,
	tools: MediaTools,
) {
	const authentication = await createAuthenticationModule({
		logger,
		dataDir: system.deployment.dataDir,
		store: database.authentication,
		sources: {
			version: async (id) =>
				(await resources.api.sources.resolveSource(id)).identity.sourceVersion,
		},
	});
	const resources = await createResourcesModule({
		system,
		logger,
	});
	const media = await createMediaModule({
		system,
		resources: resources.api,
		database,
		tools,
		logger,
	});
	const anime = await createAnimeModule({
		system,
		resources: resources.api,
		database,
		logger,
	});
	const playback = createPlaybackModule({
		system,
		completionObserver: anime.completionObserver,
		resources: resources.api,
		media: media.api,
		database,
		logger,
	});
	const acquisition = await createAcquisitionModule({
		...(anime.api.acquisitionList
			? { watching: anime.api.acquisitionList }
			: {}),
		...(system.deployment.bundledJackettConfigFile
			? {
					bundledSourcesConfigFile: system.deployment.bundledJackettConfigFile,
				}
			: {}),
		rssRefreshIntervalMinutes: () => system.settings.rssRefreshIntervalMinutes,
		defaultAcquisitionProfileId: () =>
			system.settings.defaultAcquisitionProfileId,
		dataDir: system.deployment.dataDir,
		logger,
		store: database.acquisition,
		downloadStore: database.acquisitionDownloads,
		...(resources.api.acquisition
			? { resources: resources.api.acquisition }
			: {}),
		...(anime.api.ingestion ? { ingestion: anime.api.ingestion } : {}),
		...(system.deployment.bundledQbittorrentConnectionFile
			? {
					bundledConnectionFile:
						system.deployment.bundledQbittorrentConnectionFile,
				}
			: {}),
		...(system.deployment.qbittorrentApiUrl
			? { suggestedApiUrl: system.deployment.qbittorrentApiUrl }
			: {}),
		...(anime.api.acquisition ? { anime: anime.api.acquisition } : {}),
	});
	const app = createHttpApp({
		configure: authentication.registerHttp,
		config: system.deployment,
		logger,
		development: system.environment.development,
		...(system.deployment.frontendDir
			? { frontendRoot: system.deployment.frontendDir }
			: {}),
		registrations: [
			(app) => registerSystemHttp(app, system, resources.api),
			resources.registerHttp,
			media.registerHttp,
			playback.registerHttp,
			anime.registerHttp,
			acquisition.registerHttp,
			(app) =>
				registerAnimeDetailRoutes(app, anime.api, acquisition.api, logger),
		],
		closeDependencies: () =>
			closeModules({
				acquisition,
				anime,
				media,
				resources,
				playback,
				database,
			}),
	});
	if (authentication.initialPassword)
		app.addHook("onListen", async () => {
			process.stdout.write(
				`\nAnishelf authentication initialized.\nInitial password: ${authentication.initialPassword}\nThis password will not be displayed again. You can change it in Settings.\n\n`,
			);
			authentication.initialPassword = undefined;
		});
	return app;
}
