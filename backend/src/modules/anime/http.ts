import type { HttpInstance } from "../../transport/instance.js";
import { registerCatalogRoutes } from "./anime-catalog/http/catalog.js";
import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import { registerMetadataRoutes } from "./metadata/http/metadata.js";
import type { MetadataApi } from "./metadata/public.js";
export function registerAnimeHttp(
	app: HttpInstance,
	owners: {
		metadata: MetadataApi | undefined;
		catalog: AnimeCatalogApi | undefined;
	},
): void {
	if (owners.metadata) registerMetadataRoutes(app, owners.metadata);
	if (owners.catalog) registerCatalogRoutes(app, owners.catalog);
}
