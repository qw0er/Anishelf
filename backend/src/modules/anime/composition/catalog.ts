import type { Logger } from "pino";
import type { LibraryApi, ResourceAccessApi } from "../../resources/public.js";
import { AnimeCatalogApplication } from "../anime-catalog/application/catalog.js";

type LibraryCapability = LibraryApi & { readonly sources: ResourceAccessApi };

import type { AnimePersistence } from "../persistence.js";
import type { createMetadataModule } from "./metadata.js";

export function createCatalogModule({
	database,
	metadata,
	library,
	logger,
}: {
	database: AnimePersistence | undefined;
	metadata: Awaited<ReturnType<typeof createMetadataModule>> | undefined;
	library: LibraryCapability;
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
