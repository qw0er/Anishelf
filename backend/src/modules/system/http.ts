import type { HttpInstance } from "../../transport/instance.js";
import { SettingsApplication } from "./configuration/application/settings.js";
import { registerSettingsRoutes } from "./configuration/http/settings.js";
import { registerTranscodeProfileRoutes } from "./configuration/http/transcode-profiles.js";
import type { ResourceSettingsCoordinator, SystemApi } from "./public.js";
import { registerUpdateRoutes } from "./updates/http.js";
export function registerSystemHttp(
	app: HttpInstance,
	api: SystemApi,
	resources: ResourceSettingsCoordinator,
): void {
	registerUpdateRoutes(app);
	registerTranscodeProfileRoutes(app, api);
	registerSettingsRoutes(app, new SettingsApplication(api, resources, app.log));
}
