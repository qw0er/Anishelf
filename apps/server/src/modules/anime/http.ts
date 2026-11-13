import { IdentificationStatusSchema } from "@anishelf/contracts/schemas/anime-catalog";
import type { HttpInstance } from "../../transport/instance.js";
import { registerCatalogRoutes } from "./anime-catalog/http/catalog.js";
import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import { registerAnimeLibraryRoutes } from "./anime-library/http/library.js";
import type { AnimeLibraryApi } from "./anime-library/public.js";
import { registerMetadataRoutes } from "./external-works/metadata/http/metadata.js";
import type { MetadataModule } from "./external-works/metadata/public.js";
import { registerTrackingListRoutes } from "./external-works/tracking/http/lists.js";
import { registerTrackingRoutes } from "./external-works/tracking/http/tracking.js";
import { registerTrackingUpdateRoutes } from "./external-works/tracking/http/updates.js";
import type {
	TrackingApi,
	TrackingViewingApi,
} from "./external-works/tracking/public.js";
export function registerAnimeHttp(
	app: HttpInstance,
	owners: {
		tracking: TrackingApi;
		viewing?: TrackingViewingApi | undefined;
		library: AnimeLibraryApi;
		identification?: {
			reidentify(fileId: string): Promise<void>;
			reidentifyPending(): void;
			getStatus(): import("@anishelf/contracts/http").IdentificationStatusResponse;
		};
		metadata: MetadataModule | undefined;
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
	registerAnimeLibraryRoutes(app, owners.library, metadata);
	if (owners.metadata) {
		registerMetadataRoutes(app, owners.metadata);
	}
	if (owners.catalog)
		registerCatalogRoutes(app, owners.catalog, owners.identification);
}
