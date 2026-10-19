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
	if (!database)
		throw new Error("Authentication requires an available database.");
	const authentication = await createAuthenticationModule({
		logger,
		dataDir: system.deployment.dataDir,
		store: database.authentication,
		secure: system.deployment.publicOrigin?.startsWith("https:") ?? false,
		sources: {
			version: async (id) =>
				(await resources.api.sources.resolveSource(id)).identity.sourceVersion,
		},
	});
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
		policy: builtinPolicy.playback,
		database,
		logger,
	});
	const acquisition = createAcquisitionModule({
		settings: () => system.settings,
		upstream: system.deployment.qbittorrentUrl,
		secure: system.deployment.publicOrigin?.startsWith("https:") ?? false,
		logger,
	});
	const app = createHttpApp({
		configure: authentication.registerHttp,
		config: system.deployment,
		logger,
		policy: builtinPolicy,
		development: system.environment.development,
		...(system.deployment.frontendDir
			? { frontendRoot: system.deployment.frontendDir }
			: {}),
		registrations: [
			acquisition.registerHttp,
			(app) => registerSystemHttp(app, system, resources.api),
			resources.registerHttp,
			media.registerHttp,
			playback.registerHttp,
			anime.registerHttp,
		],
		closeDependencies: () =>
			closeModules({ anime, media, resources, playback, database }),
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
