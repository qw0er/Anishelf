import type { Logger } from "pino";
import { AnimeCatalogApplication } from "../../modules/anime/anime-catalog/application/catalog.js";
import type { LibraryApplication } from "../../modules/resources/library/application/library.js";
import type { ApplicationDatabase } from "./database.js";
import type { createMetadataModule } from "./metadata.js";

export function createCatalogModule({
	database,
	metadata,
	library,
	logger,
}: {
	database: ApplicationDatabase | undefined;
	metadata: Awaited<ReturnType<typeof createMetadataModule>> | undefined;
	library: LibraryApplication;
	logger: Logger;
}) {
	return database && metadata
		? new AnimeCatalogApplication({
				store: database.catalog,
				metadata,
				sources: library.sources,
				logger,
			})
		: undefined;
}
