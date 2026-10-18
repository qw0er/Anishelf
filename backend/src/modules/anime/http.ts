import { IdentificationStatusSchema } from "../../contracts/schemas/anime-catalog.js";
import type { HttpInstance } from "../../transport/instance.js";
import { registerCatalogRoutes } from "./anime-catalog/http/catalog.js";
import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import { registerAnimeLibraryRoutes } from "./anime-library/http/library.js";
import type { AnimeLibraryApi } from "./anime-library/public.js";
import { registerMetadataRoutes } from "./metadata/http/metadata.js";
import type { MetadataApi } from "./metadata/public.js";
import { registerTrackingListRoutes } from "./tracking/http/lists.js";
import { registerTrackingRoutes } from "./tracking/http/tracking.js";
import { registerTrackingUpdateRoutes } from "./tracking/http/updates.js";
import type { TrackingApi, TrackingViewingApi } from "./tracking/public.js";
export function registerAnimeHttp(
	app: HttpInstance,
	owners: {
		tracking?: TrackingApi | undefined;
		viewing?: TrackingViewingApi | undefined;
		library?: AnimeLibraryApi | undefined;
		identification?: {
			getStatus(): {
				running: boolean;
				failed: boolean;
				revision?: number;
				incremental?: boolean;
			};
		};
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
	if (owners.tracking) {
		registerTrackingRoutes(app, owners.tracking);
		registerTrackingListRoutes(app, owners.tracking);
		registerTrackingUpdateRoutes(app, owners.tracking, owners.viewing);
	}
	if (owners.library) registerAnimeLibraryRoutes(app, owners.library);
	if (owners.metadata) registerMetadataRoutes(app, owners.metadata);
	if (owners.catalog) registerCatalogRoutes(app, owners.catalog);
}
