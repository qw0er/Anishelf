import type { Logger } from "pino";
import type { ResourcesApi } from "../resources/public.js";
import type { SystemApi } from "../system/public.js";
import { AniListWrapper } from "./anilist/public.js";
import { AnimeLibraryQueries } from "./anime-library/application/library.js";
import {
	createAniListMetadata,
	createAniListTracking,
} from "./composition/anilist.js";
import { createCatalogModule } from "./composition/catalog.js";
import { createIdentificationModule } from "./composition/identification.js";
import {
	createIdentificationMetadata,
	createMetadataModule,
} from "./composition/metadata.js";
import { createTrackingModule } from "./composition/tracking.js";
import { registerAnimeHttp } from "./http.js";
import { AnitomyIdentificationParser } from "./identification/infrastructure/parser.js";
import type { MetadataApplication } from "./metadata/application/metadata.js";
import type { AnimePersistence } from "./persistence.js";
import type { AnimeApi } from "./public.js";
import { AnimeReleaseAssessment } from "./release-assessment/application.js";
import { AcquisitionIngestion } from "./release-assessment/ingestion.js";
import { TrackingViewingCommands } from "./tracking/application/viewing.js";
export async function createAnimeModule(options: {
	system: SystemApi;
	resources: ResourcesApi;
	database: AnimePersistence;
	logger: Logger;
}) {
	const { system, resources: library, database, logger } = options;
	const requests = new AniListWrapper({ logger });
	const tracking = await createTrackingModule({
		dataDir: system.deployment.dataDir,
		store: database.tracking,
		listStore: database.trackingLists,
		operationStore: database.trackingOperations,
		...createAniListTracking(requests),
		logger,
	});
	let metadata: MetadataApplication | undefined;
	try {
		metadata = await createMetadataModule({
			dataDir: system.deployment.dataDir,
			store: database.metadata,
			...createAniListMetadata(requests),
			logger,
		});
	} catch (err) {
		logger.warn(
			{ event: "metadata.unavailable", err },
			"Metadata cache unavailable; local identification remains usable.",
		);
	}
	const catalog = createCatalogModule({ database, metadata, library, logger });
	const libraryQueries = new AnimeLibraryQueries({
		catalog,
		lists: tracking,
		logger,
	});
	const identification = createIdentificationModule({
		library,
		sources: library.sources,
		logger,
		...(metadata ? { metadata: createIdentificationMetadata(metadata) } : {}),
		...(catalog
			? {
					onPublication: (results, scopeIds, signal, fileIds) =>
						catalog.publish(results, scopeIds, signal, fileIds),
				}
			: {}),
	});
	const assessment = metadata
		? new AnimeReleaseAssessment(
				new AnitomyIdentificationParser(),
				metadata,
				catalog,
			)
		: undefined;
	const api: AnimeApi = {
		...(assessment && catalog
			? {
					ingestion: new AcquisitionIngestion(
						assessment,
						new AnitomyIdentificationParser(),
						catalog,
						library.sources,
					),
				}
			: {}),
		...(assessment ? { acquisition: assessment } : {}),
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
	const viewing = catalog
		? new TrackingViewingCommands(catalog, tracking, undefined, logger)
		: undefined;
	let stopped: Promise<void> | undefined;
	let closed: Promise<void> | undefined;
	const quiesce = () =>
		(stopped ??= (async () => {
			await Promise.all([
				identification.close(),
				catalog?.quiesce(),
				tracking.close(),
			]);
		})());
	return {
		api,
		completionObserver: viewing,
		registerHttp: (app: import("../../transport/instance.js").HttpInstance) =>
			registerAnimeHttp(app, {
				metadata,
				catalog,
				identification,
				tracking,
				viewing,
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
