import type { Logger } from "pino";
import type { LibraryApi, ResourceAccessApi } from "../../resources/public.js";
import { AnimeCatalogApplication } from "../anime-catalog/application/catalog.js";
import type { MetadataApplication } from "../metadata/application/metadata.js";

type LibraryCapability = LibraryApi & { readonly sources: ResourceAccessApi };

import type { AnimePersistence } from "../persistence.js";

export function createCatalogModule({
	database,
	metadata,
	library,
	logger,
}: {
	database: AnimePersistence | undefined;
	metadata: MetadataApplication | undefined;
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
