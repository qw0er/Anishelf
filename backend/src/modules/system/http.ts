import { AutoPreparationCatalogSchema } from "../../contracts/schemas/auto-preparation.js";
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
	app.get(
		"/api/auto-preparation-presets",
		{ schema: { response: { 200: AutoPreparationCatalogSchema } } },
		async () => {
			const selectedPresetId =
				api.settings.autoPreparationPresetId ?? "builtin:web";
			const presets = (api.autoPreparationPresets ?? []).map((p) => ({
				id: p.id,
				name: p.name,
				description: p.description ?? "",
				source: p.id.startsWith("builtin:")
					? ("builtin" as const)
					: ("custom" as const),
				available: api.transcodeProfiles.some(
					(t) => t.id === p.transcodeProfileId,
				),
			}));
			return {
				presets,
				selectedPresetId,
				selectionAvailable: presets.some(
					(p) => p.id === selectedPresetId && p.available,
				),
				...(api.autoPreparationIssue
					? { issue: api.autoPreparationIssue }
					: {}),
			};
		},
	);
	registerUpdateRoutes(app);
	registerTranscodeProfileRoutes(app, api);
	registerSettingsRoutes(app, new SettingsApplication(api, resources, app.log));
}
