import type { LibraryApplication } from "../application/library.js";
import type { HttpInstance } from "./instance.js";
import { settingsResponse } from "./presenters.js";
import {
	SettingsResponseSchema,
	UpdateSettingsRequestSchema,
} from "./schemas/index.js";

export function registerSettingsRoutes(
	app: HttpInstance,
	library: LibraryApplication,
): void {
	app.get(
		"/api/settings",
		{ schema: { response: { 200: SettingsResponseSchema } } },
		async () => settingsResponse(library.getSettings()),
	);
	app.put(
		"/api/settings",
		{
			schema: {
				body: UpdateSettingsRequestSchema,
				response: { 200: SettingsResponseSchema },
			},
		},
		async (request) =>
			settingsResponse(await library.updateSettings(request.body)),
	);
}
