import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { Logger } from "pino";
import type { LibraryApplication } from "../application/library.js";
import type { PlaybackApplication } from "../application/playback.js";
import type { DeploymentConfig } from "../config/model.js";
import { apiError, classifyHttpError } from "./errors.js";
import { registerLibraryRoutes } from "./library.js";
import { registerMediaRoutes } from "./media.js";
import { registerPlaybackRoutes } from "./playback.js";
import { checkRequestOrigin } from "./security.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerFrontend } from "./static.js";

export function createHttpApp(options: {
	config: Pick<DeploymentConfig, "host" | "port">;
	logger: Logger;
	development?: boolean;
	library?: LibraryApplication;
	playback?: PlaybackApplication;
	frontendRoot?: string;
}) {
	const app = Fastify({
		loggerInstance: options.logger,
		genReqId: () => randomUUID(),
		requestIdHeader: false,
		trustProxy: false,
		bodyLimit: 64 * 1024,
		forceCloseConnections: "idle",
		ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
	});
	app.addHook("onRequest", async (request, reply) => {
		reply.header("x-request-id", request.id);
		checkRequestOrigin(request, options.config, options.development ?? false);
	});
	app.setErrorHandler((error, request, reply) => {
		const { code, status } = classifyHttpError(error);
		if (status >= 500)
			request.log.error(
				{ event: "http.request_failed", err: error },
				"HTTP request failed.",
			);
		return reply.code(status).send(apiError(code, request.id));
	});
	app.setNotFoundHandler((request, reply) =>
		reply.code(404).send(apiError("ROUTE_NOT_FOUND", request.id)),
	);
	app.get(
		"/api/health",
		{
			schema: {
				response: {
					200: {
						type: "object",
						additionalProperties: false,
						required: ["status"],
						properties: { status: { type: "string", const: "ok" } },
					},
				},
			},
		},
		async () => ({ status: "ok" }),
	);
	if (options.library) {
		const library = options.library;
		app.addHook("onClose", async () => library.close());
		registerLibraryRoutes(app, library);
		registerMediaRoutes(app, library);
		registerSettingsRoutes(app, library);
	}

	if (options.playback) {
		const playback = options.playback;
		app.addHook("onClose", async () => playback.close());
		registerPlaybackRoutes(app, playback);
	}

	const frontendRoot = options.frontendRoot;
	if (options.development && frontendRoot)
		app.register(async (scope) => registerFrontend(scope, frontendRoot));
	return app;
}
