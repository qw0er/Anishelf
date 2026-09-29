import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { PersistentConfiguration } from "../config/persistent.js";
import type {
	SettingsResponse,
	UpdateSettingsRequest,
} from "../contracts/api.js";
import type { LibraryScanner } from "../library/scanner.js";

const settingsSchema = {
	type: "object",
	additionalProperties: false,
	required: ["resourceRoot"],
	properties: { resourceRoot: { type: ["string", "null"] } },
} as const;

export function registerSettingsRoutes(
	app: FastifyInstance<
		RawServerDefault,
		IncomingMessage,
		ServerResponse,
		Logger
	>,
	configuration: PersistentConfiguration,
	scanner: LibraryScanner,
): void {
	app.get(
		"/api/settings",
		{
			schema: { response: { 200: settingsSchema } },
		},
		async (): Promise<SettingsResponse> => configuration.settings,
	);

	app.put<{ Body: UpdateSettingsRequest }>(
		"/api/settings",
		{
			schema: {
				body: {
					type: "object",
					additionalProperties: false,
					required: ["resourceRoot"],
					properties: { resourceRoot: { type: "string", minLength: 1 } },
				},
				response: { 200: settingsSchema },
			},
		},
		async (request): Promise<SettingsResponse> =>
			scanner.updateSettings(() => configuration.update(request.body)),
	);
}
