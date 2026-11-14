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
	{ localDeviceToken }: { localDeviceToken: string | undefined },
) {
	const localOnly = localDeviceToken !== undefined;
	const owners: Parameters<typeof closeModules>[0] = { database };
	try {
		const authentication = await createAuthenticationModule({
			logger,
			dataDir: system.deployment.dataDir,
			store: database.authentication,
			localDeviceToken,
			sources: {
				version: async (id) =>
					(await resources.api.sources.resolveSource(id)).identity
						.sourceVersion,
			},
		});
		const resources = await createResourcesModule({
			system,
			logger,
		});
		owners.resources = resources;
		const media = await createMediaModule({
			system,
			resources: resources.api,
			database,
			tools,
			logger,
		});
		owners.media = media;
		const anime = await createAnimeModule({
			system,
			resources: resources.api,
			database,
			logger,
		});
		owners.anime = anime;
		const playback = createPlaybackModule({
			completionObserver: anime.completionObserver,
			resources: resources.api,
			media: media.api,
			database,
			logger,
		});
		owners.playback = playback;
		const acquisition = await createAcquisitionModule({
			...(anime.api.acquisitionList
				? { watching: anime.api.acquisitionList }
				: {}),
			...(system.deployment.bundledJackettConfigFile
				? {
						bundledSourcesConfigFile:
							system.deployment.bundledJackettConfigFile,
					}
				: {}),
			...(system.onSettingsChanged
				? { onSettingsChanged: system.onSettingsChanged.bind(system) }
				: {}),
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
		owners.acquisition = acquisition;
		const app = createHttpApp({
			configure: authentication.registerHttp,
			config: localOnly
				? { ...system.deployment, trustedProxies: [] }
				: system.deployment,
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
			closeDependencies: () => closeModules(owners),
		});
		if (!localOnly && authentication.initialPassword)
			app.addHook("onListen", async () => {
				process.stdout.write(
					`\nAnishelf authentication initialized.\nInitial password: ${authentication.initialPassword}\nThis password will not be displayed again. You can change it in Settings.\n\n`,
				);
				authentication.initialPassword = undefined;
			});
		return app;
	} catch (error) {
		try {
			await closeModules(owners);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Server assembly and cleanup failed.",
			);
		}
		throw error;
	}
}
