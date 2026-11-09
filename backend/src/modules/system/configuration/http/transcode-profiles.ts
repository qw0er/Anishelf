import {
	ReloadTranscodeProfilesSchema,
	SelectTranscodeProfileSchema,
	TranscodeProfileCatalogSchema,
} from "../../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { SystemApi } from "../../public.js";
import { transcodeProfileCatalog } from "./profile-presenter.js";

export function registerTranscodeProfileRoutes(
	app: HttpInstance,
	configuration: SystemApi,
): void {
	app.get(
		"/api/transcode-profiles",
		{
			schema: { response: { 200: TranscodeProfileCatalogSchema } },
		},
		async () => {
			await configuration.refreshTranscodeValidation?.();
			return transcodeProfileCatalog(configuration);
		},
	);
	app.post(
		"/api/transcode-profiles/reload",
		{ schema: { response: { 200: ReloadTranscodeProfilesSchema } } },
		async () => {
			const result = await configuration.reloadTranscodeProfiles?.();
			if (!result) throw new Error("Profile reload is not configured.");
			return { ...result, catalog: transcodeProfileCatalog(configuration) };
		},
	);
	app.put(
		"/api/transcode-profiles/selection",
		{
			schema: {
				body: SelectTranscodeProfileSchema,
				response: { 200: TranscodeProfileCatalogSchema },
			},
		},
		async (request) => {
			await configuration.refreshTranscodeValidation?.();
			await configuration.selectTranscodeProfile(request.body.profileId);
			return transcodeProfileCatalog(configuration);
		},
	);
}
