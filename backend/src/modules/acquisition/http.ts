import type { HttpInstance } from "../../transport/instance.js";
import { registerSubscriptionRoutes } from "./discovery/http/subscriptions.js";
import { registerDownloadRoutes } from "./downloads/http/downloads.js";
import type { AcquisitionApi } from "./public.js";
import { registerConnectionRoutes } from "./qbittorrent/http.js";

export function registerAcquisitionHttp(
	app: HttpInstance,
	api: AcquisitionApi,
) {
	registerConnectionRoutes(app, api.connection);
	if (api.downloads) registerDownloadRoutes(app, api.downloads);
	registerSubscriptionRoutes(app, api.discovery);
}
