import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { LibraryApplication } from "../application/library.js";
import type { SettingsResponse, UpdateSettingsRequest } from "./contracts.js";

import { settingsResponse } from "./presenters.js";

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
	library: LibraryApplication,
): void {
	app.get(
		"/api/settings",
		{
			schema: { response: { 200: settingsSchema } },
		},
		async (): Promise<SettingsResponse> =>
			settingsResponse(library.getSettings()),
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
			settingsResponse(await library.updateSettings(request.body)),
	);
}
