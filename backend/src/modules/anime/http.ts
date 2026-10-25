import { IdentificationStatusSchema } from "../../contracts/schemas/anime-catalog.js";
import { workKey } from "../../shared/external-reference.js";
import type { HttpInstance } from "../../transport/instance.js";
import { registerCatalogRoutes } from "./anime-catalog/http/catalog.js";
import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import { registerAnimeLibraryRoutes } from "./anime-library/http/library.js";
import type { AnimeLibraryApi } from "./anime-library/public.js";
import type { MetadataApplication } from "./metadata/application/metadata.js";
import { registerMetadataRoutes } from "./metadata/http/metadata.js";
import { registerTrackingListRoutes } from "./tracking/http/lists.js";
import { registerTrackingRoutes } from "./tracking/http/tracking.js";
import { registerTrackingUpdateRoutes } from "./tracking/http/updates.js";
import type { TrackingApi, TrackingViewingApi } from "./tracking/public.js";
export function registerAnimeHttp(
	app: HttpInstance,
	owners: {
		tracking: TrackingApi;
		viewing?: TrackingViewingApi | undefined;
		library: AnimeLibraryApi;
		identification?: {
			getStatus(): {
				running: boolean;
				failed: boolean;
				revision?: number;
				incremental?: boolean;
			};
		};
		metadata: MetadataApplication | undefined;
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
	registerTrackingRoutes(app, owners.tracking);
	registerTrackingListRoutes(app, owners.tracking);
	registerTrackingUpdateRoutes(app, owners.tracking, owners.viewing);
	const metadata = owners.metadata;
	registerAnimeLibraryRoutes(
		app,
		owners.library,
		metadata
			? {
					cachedArtworkId: (reference, kind) =>
						metadata.cachedArtworkId(
							metadata.resolveReference(workKey(reference)),
							kind,
						),
				}
			: undefined,
	);
	if (owners.metadata) registerMetadataRoutes(app, owners.metadata);
	if (owners.catalog)
		registerCatalogRoutes(
			app,
			owners.catalog,
			metadata
				? (reference) => metadata.externalReference(reference)
				: undefined,
		);
}
