import { createSettingsSchemas } from "../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../transport/instance.js";
import { settingsResponse } from "../../../transport/presenters.js";
import type { SettingsApplication } from "../application/settings.js";

export function registerSettingsRoutes(
	app: HttpInstance,
	settings: SettingsApplication,
	maximumScanIntervalMinutes: number,
): void {
	const { SettingsResponseSchema, UpdateSettingsRequestSchema } =
		createSettingsSchemas(maximumScanIntervalMinutes);
	app.get(
		"/api/settings",
		{ schema: { response: { 200: SettingsResponseSchema } } },
		async () => settingsResponse(settings.getSettings()),
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
			settingsResponse(await settings.updateSettings(request.body)),
	);
}
