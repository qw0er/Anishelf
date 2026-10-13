import type { Logger } from "pino";
import { createAnimeModule } from "../../modules/anime/create.js";
import { createMediaModule } from "../../modules/media/create.js";
import { createPlaybackModule } from "../../modules/playback/create.js";
import { createResourcesModule } from "../../modules/resources/create.js";
import { registerSystemHttp } from "../../modules/system/http.js";
import type { SystemApi } from "../../modules/system/public.js";
import type { MediaTools } from "../../platform/media/index.js";
import { closeModules } from "../lifecycle.js";
import { builtinPolicy } from "../policy.js";
import type { ApplicationDatabase } from "./database.js";
import { createHttpApp } from "./http.js";
export async function createServer(
	system: SystemApi,
	logger: Logger,
	database: ApplicationDatabase | undefined,
	tools: MediaTools,
) {
	const resources = await createResourcesModule({
		system,
		logger,
		policy: builtinPolicy,
	});
	const media = await createMediaModule({
		system,
		resources: resources.api,
		policy: builtinPolicy,
		database,
		tools,
		logger,
	});
	const playback = createPlaybackModule({
		system,
		resources: resources.api,
		media: media.api,
		policy: builtinPolicy.playback,
		database,
		logger,
	});
	const anime = await createAnimeModule({
		system,
		resources: resources.api,
		database,
		logger,
	});
	return createHttpApp({
		config: system.deployment,
		logger,
		policy: builtinPolicy,
		development: system.environment.development,
		...(system.deployment.frontendDir
			? { frontendRoot: system.deployment.frontendDir }
			: {}),
		registrations: [
			(app) =>
				registerSystemHttp(
					app,
					system,
					resources.api,
					builtinPolicy.library.maximumScanIntervalMinutes,
				),
			resources.registerHttp,
			media.registerHttp,
			playback.registerHttp,
			anime.registerHttp,
		],
		closeDependencies: () =>
			closeModules({ anime, media, resources, playback, database }),
	});
}
