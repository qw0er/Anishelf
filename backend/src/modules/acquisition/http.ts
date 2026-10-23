import type { HttpInstance } from "../../transport/instance.js";
import { registerDownloadRoutes } from "./downloads/http/downloads.js";
import type { AcquisitionApi } from "./public.js";
import { registerConnectionRoutes } from "./qbittorrent/http.js";
import { registerSubscriptionRoutes } from "./subscriptions/http/subscriptions.js";

export function registerAcquisitionHttp(
	app: HttpInstance,
	api: AcquisitionApi,
	registerSources: (app: HttpInstance) => void,
) {
	registerConnectionRoutes(app, api.connection);
	registerSources(app);
	if (api.downloads) registerDownloadRoutes(app, api.downloads);
	registerSubscriptionRoutes(app, api.subscriptions);
}
