import type { HttpInstance } from "../../transport/instance.js";
import { registerSubscriptionRoutes } from "./discovery/http/subscriptions.js";
import { registerDownloadRoutes } from "./downloads/http/downloads.js";
import type { AcquisitionApi } from "./public.js";
import { registerConnectionRoutes } from "./qbittorrent/http.js";
import { registerSourceRoutes } from "./sources/http/routes.js";

export function registerAcquisitionHttp(
	app: HttpInstance,
	api: AcquisitionApi,
) {
	registerConnectionRoutes(app, api.connection);
	registerSourceRoutes(app, api.sources);
	if (api.downloads) registerDownloadRoutes(app, api.downloads);
	registerSubscriptionRoutes(app, api.discovery);
}
