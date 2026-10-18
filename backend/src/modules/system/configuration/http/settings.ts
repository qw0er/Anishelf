import { createSettingsSchemas } from "../../../../contracts/schemas/index.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { SettingsApplication } from "../application/settings.js";
import { settingsResponse } from "./settings-presenter.js";

export function registerSettingsRoutes(
	app: HttpInstance,
	settings: SettingsApplication,
): void {
	const { SettingsResponseSchema, UpdateSettingsRequestSchema } =
		createSettingsSchemas();
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
