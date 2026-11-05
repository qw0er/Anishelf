import type { Logger } from "pino";
import type { SystemApi } from "../../system/public.js";
import type { AnimeCatalogApi } from "../anime-catalog/public.js";
import type { AnimePersistence } from "../persistence.js";
import {
	createAniListMetadata,
	createAniListTracking,
} from "./adapters/anilist.js";
import { createBangumiMetadata } from "./adapters/bangumi.js";
import { AniListWrapper } from "./anilist/public.js";
import { createMetadataModule } from "./metadata/create.js";
import type { MetadataModule } from "./metadata/public.js";
import { TrackingViewingCommands } from "./tracking/application/viewing.js";
import { createTrackingModule } from "./tracking/create.js";
export async function createExternalWorks(options: {
	system: SystemApi;
	database: AnimePersistence;
	logger: Logger;
}) {
	const { system, database, logger } = options;
	const requests = new AniListWrapper({ logger });
	const tracking = await createTrackingModule({
		dataDir: system.deployment.dataDir,
		store: database.tracking,
		listStore: database.trackingLists,
		operationStore: database.trackingOperations,
		...createAniListTracking(requests),
		logger,
	});
	const bangumi = createBangumiMetadata(logger);
	const metadataSources = createAniListMetadata(requests);
	let metadata: MetadataModule | undefined;
	try {
		metadata = await createMetadataModule({
			dataDir: system.deployment.dataDir,
			store: database.metadata,
			...metadataSources,
			providers: [...metadataSources.providers, bangumi.provider],
			artworkHosts: [...metadataSources.artworkHosts, "lain.bgm.tv"],
			titleDisplayPreference: () =>
				system.snapshot.settings.titleDisplayPreference ?? "native",
			defaultSearchProvider: () =>
				system.snapshot.settings.defaultMetadataProvider ?? "anilist",
			logger,
		});
	} catch (err) {
		logger.warn(
			{ event: "metadata.unavailable", err },
			"Metadata cache unavailable; local identification remains usable.",
		);
	}
	let stopped: Promise<void> | undefined;
	const quiesce = () => (stopped ??= tracking.close());
	return {
		quiesce,
		createViewing: (catalog: Pick<AnimeCatalogApi, "fileReviews">) =>
			new TrackingViewingCommands(
				catalog,
				tracking,
				undefined,
				logger,
				metadata?.identities,
			),
		metadata,
		tracking,
		close: async () => {
			await quiesce();
			await metadata?.close();
			await bangumi.close();
			await requests.close();
		},
	};
}
