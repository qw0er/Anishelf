import { IdentificationStatusSchema } from "../../contracts/schemas/anime-catalog.js";
import type { HttpInstance } from "../../transport/instance.js";
import { registerCatalogRoutes } from "./anime-catalog/http/catalog.js";
import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import { registerMetadataRoutes } from "./metadata/http/metadata.js";
import type { MetadataApi } from "./metadata/public.js";
export function registerAnimeHttp(
	app: HttpInstance,
	owners: {
		identification?: { getStatus(): { running: boolean; failed: boolean } };
		metadata: MetadataApi | undefined;
		catalog: AnimeCatalogApi | undefined;
	},
): void {
	if (owners.identification)
		app.get(
			"/api/anime/identification",
			{ schema: { response: { 200: IdentificationStatusSchema } } },
			async (_request, reply) => {
				reply.header("Cache-Control", "no-store");
				return owners.identification?.getStatus();
			},
		);
	if (owners.metadata) registerMetadataRoutes(app, owners.metadata);
	if (owners.catalog) registerCatalogRoutes(app, owners.catalog);
}
