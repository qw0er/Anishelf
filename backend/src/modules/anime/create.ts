import type { Logger } from "pino";
import type { ResourcesApi } from "../resources/public.js";
import type { SystemApi } from "../system/public.js";
import { AnimeCatalogApplication } from "./anime-catalog/application/catalog.js";
import { AnimeLibraryQueries } from "./anime-library/application/library.js";
import { createExternalWorks } from "./external-works/create.js";
import { registerAnimeHttp } from "./http.js";
import { AnitomyIdentificationParser } from "./identification/infrastructure/parser.js";
import { createIdentificationMetadata } from "./integration/identification-metadata.js";
import type { AnimePersistence } from "./persistence.js";
import type { AnimeApi } from "./public.js";
import { AnimeQueries } from "./queries.js";
import { AnimeReleaseAssessment } from "./release-assessment/application.js";
import { AcquisitionIngestion } from "./release-assessment/ingestion.js";
import { createIdentificationModule } from "./workflows/create-identification.js";
export async function createAnimeModule(options: {
	system: SystemApi;
	resources: ResourcesApi;
	database: AnimePersistence;
	logger: Logger;
}) {
	const { system, resources: library, database, logger } = options;
	const externalWorks = await createExternalWorks({ system, database, logger });
	const { metadata, tracking } = externalWorks;
	const titleDisplayPreference = () =>
		system.snapshot.settings.titleDisplayPreference ?? "native";
	const catalog = metadata
		? new AnimeCatalogApplication({
				store: database.catalog,
				titleDisplayPreference,
				metadata,
				sources: library.sources,
				logger,
			})
		: undefined;
	const libraryQueries = new AnimeLibraryQueries({
		catalog,
		lists: tracking,
		titleDisplayPreference,
		logger,
		...(metadata ? { identities: metadata.identities } : {}),
	});
	const identification = createIdentificationModule({
		metadataContext: () =>
			system.snapshot.settings.defaultMetadataProvider ?? "anilist",
		library,
		sources: library.sources,
		logger,
		...(metadata ? { metadata: createIdentificationMetadata(metadata) } : {}),
		...(catalog
			? {
					onPublication: catalog.publish,
					catalog,
				}
			: {}),
	});
	const assessment = metadata
		? new AnimeReleaseAssessment(
				new AnitomyIdentificationParser(),
				metadata,
				catalog,
				metadata.identities,
				logger,
			)
		: undefined;
	const api: AnimeApi = {
		acquisitionList: {
			snapshot: tracking.acquisitionSnapshot,
			refresh: async () => {
				await tracking.refreshList();
				return tracking.acquisitionSnapshot();
			},
		},
		queries: new AnimeQueries(
			catalog,
			metadata,
			tracking,
			logger,
			metadata?.identities,
			titleDisplayPreference,
		),
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
		metadata,
		catalog: catalog
			? {
					list: catalog.list,
					getLocalWorkDetail: catalog.getLocalWorkDetail,
					source: catalog.source,
					review: catalog.review,
					fileReviews: catalog.fileReviews,
					reviews: catalog.reviews,
					preview: catalog.preview,
					confirm: catalog.confirm,
					reject: catalog.reject,
					remove: catalog.remove,
					editEpisode: catalog.editEpisode,
					refresh: catalog.refresh,
				}
			: undefined,
	};
	const viewing = catalog ? externalWorks.createViewing(catalog) : undefined;
	let stopped: Promise<void> | undefined;
	let closed: Promise<void> | undefined;
	const quiesce = () =>
		(stopped ??= (async () => {
			await Promise.all([
				identification.close(),
				catalog?.quiesce(),
				externalWorks.quiesce(),
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
				await externalWorks.close();
			})()),
	};
}
