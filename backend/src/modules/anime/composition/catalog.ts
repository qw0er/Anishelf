import type { Logger } from "pino";
import type { LibraryApi, ResourceAccessApi } from "../../resources/public.js";
import { AnimeCatalogApplication } from "../anime-catalog/application/catalog.js";
import type { CatalogMetadata } from "../anime-catalog/ports.js";

type LibraryCapability = LibraryApi & { readonly sources: ResourceAccessApi };

import type { AnimePersistence } from "../persistence.js";

export function createCatalogModule({
	database,
	metadata,
	library,
	logger,
}: {
	database: AnimePersistence;
	metadata: CatalogMetadata | undefined;
	library: LibraryCapability;
	logger: Logger;
}) {
	return metadata
		? new AnimeCatalogApplication({
				store: database.catalog,
				metadata,
				sources: library.sources,
				logger,
			})
		: undefined;
}
