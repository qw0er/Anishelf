import {
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
		async () => transcodeProfileCatalog(configuration),
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
			await configuration.selectTranscodeProfile(
				request.body.profileId,
				request.body.preparationMode,
			);
			return transcodeProfileCatalog(configuration);
		},
	);
}
