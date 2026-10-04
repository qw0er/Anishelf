import {
	SelectTranscodeProfileSchema,
	TranscodeProfileCatalogSchema,
} from "../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../transport/instance.js";
import type { ConfigurationService } from "../application/service.js";

export function registerTranscodeProfileRoutes(
	app: HttpInstance,
	configuration: ConfigurationService,
): void {
	app.get(
		"/api/transcode-profiles",
		{
			schema: { response: { 200: TranscodeProfileCatalogSchema } },
		},
		async () => configuration.getTranscodeProfileCatalog(),
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
			await configuration.selectTranscodeProfile(request.body.profileId);
			return configuration.getTranscodeProfileCatalog();
		},
	);
}
