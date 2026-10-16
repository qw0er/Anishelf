import type { Logger } from "pino";
import type { ResourcesApi } from "../resources/public.js";
import type { SystemApi } from "../system/public.js";
import { AniListScheduler } from "./anilist/public.js";
import { AnimeLibraryQueries } from "./anime-library/application/library.js";
import { createCatalogModule } from "./composition/catalog.js";
import { createIdentificationModule } from "./composition/identification.js";
import {
	createIdentificationMetadata,
	createMetadataModule,
} from "./composition/metadata.js";
import { createTrackingModule } from "./composition/tracking.js";
import { registerAnimeHttp } from "./http.js";
import type { MetadataApplication } from "./metadata/application/metadata.js";
import type { AnimePersistence } from "./persistence.js";
import type { AnimeApi } from "./public.js";
export async function createAnimeModule(options: {
	system: SystemApi;
	resources: ResourcesApi;
	database?: AnimePersistence | undefined;
	logger: Logger;
}) {
	const { system, resources: library, database, logger } = options;
	const requests = new AniListScheduler({ logger });
	const tracking = database
		? await createTrackingModule({
				dataDir: system.deployment.dataDir,
				store: database.tracking,
				listStore: database.trackingLists,
				operationStore: database.trackingOperations,
				client: requests,
				logger,
			})
		: undefined;
	let metadata: MetadataApplication | undefined;
	if (database)
		try {
			metadata = await createMetadataModule({
				dataDir: system.deployment.dataDir,
				store: database.metadata,
				client: requests,
				logger,
			});
		} catch (err) {
			logger.warn(
				{ event: "metadata.unavailable", err },
				"Metadata cache unavailable; local identification remains usable.",
			);
		}
	const catalog = createCatalogModule({ database, metadata, library, logger });
	const libraryQueries = tracking
		? new AnimeLibraryQueries({ catalog, lists: tracking, logger })
		: undefined;
	const identification = createIdentificationModule({
		library,
		sources: library.sources,
		logger,
		...(metadata ? { metadata: createIdentificationMetadata(metadata) } : {}),
		...(catalog
			? {
					onPublication: (results, canonicalRoot, signal) =>
						catalog.publish(results, canonicalRoot, signal),
				}
			: {}),
	});
	const api: AnimeApi = {
		tracking,
		library: libraryQueries,
		metadata: metadata
			? {
					search: (...args) => metadata.search(...args),
					get: (...args) => metadata.get(...args),
					relations: (...args) => metadata.relations(...args),
					airing: (...args) => metadata.airing(...args),
					snapshot: (id) => metadata.snapshot(id),
				}
			: undefined,
		catalog: catalog
			? {
					list: (input) => catalog.list(input),
					getLocalWorkDetail: (id) => catalog.getLocalWorkDetail(id),
					source: (id) => catalog.source(id),
					review: (id) => catalog.review(id),
					fileReviews: (ids) => catalog.fileReviews(ids),
					reviews: (input) => catalog.reviews(input),
					preview: (input) => catalog.preview(input),
					confirm: (input) => catalog.confirm(input),
					reject: (...args) => catalog.reject(...args),
					remove: (...args) => catalog.remove(...args),
					editEpisode: (...args) => catalog.editEpisode(...args),
					refresh: (...args) => catalog.refresh(...args),
				}
			: undefined,
	};
	let stopped: Promise<void> | undefined;
	let closed: Promise<void> | undefined;
	const quiesce = () =>
		(stopped ??= (async () => {
			await Promise.all([
				identification.close(),
				catalog?.quiesce(),
				tracking?.close(),
			]);
		})());
	return {
		api,
		registerHttp: (app: import("../../transport/instance.js").HttpInstance) =>
			registerAnimeHttp(app, {
				metadata,
				catalog,
				identification,
				tracking,
				library: libraryQueries,
			}),
		quiesce,
		close: () =>
			(closed ??= (async () => {
				await quiesce();
				catalog?.close();
				await metadata?.close();
				await requests.close();
			})()),
	};
}
