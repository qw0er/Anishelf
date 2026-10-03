import { randomUUID } from "node:crypto";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import type { Logger } from "pino";
import {
	ClientConfigResponseSchema,
	HealthResponseSchema,
} from "../contracts/schemas/index.js";
import type { DeploymentConfig } from "../modules/configuration/domain/model.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../modules/configuration/domain/policy.js";
import type { LibraryApplication } from "../modules/library/application/library.js";
import { registerLibraryRoutes } from "../modules/library/http/library.js";
import { registerMediaRoutes } from "../modules/library/http/media.js";
import { registerSettingsRoutes } from "../modules/library/http/settings.js";
import type { PlaybackApplication } from "../modules/playback/application/playback.js";
import { registerPlaybackRoutes } from "../modules/playback/http/playback.js";
import { SubtitleApplication } from "../modules/subtitles/application/subtitles.js";
import { registerSubtitleRoutes } from "../modules/subtitles/http/subtitles.js";
import { clientConfigResponse } from "../transport/client-config.js";
import { apiError, classifyHttpError } from "../transport/errors.js";
import { checkRequestOrigin } from "../transport/security.js";
import { registerFrontend } from "../transport/static.js";

export function createHttpApp(options: {
	config: Pick<DeploymentConfig, "host" | "port">;
	logger: Logger;
	policy?: DeepReadonly<BuiltinPolicy>;
	development?: boolean;
	library?: LibraryApplication;
	playback?: PlaybackApplication;
	subtitles?: SubtitleApplication;
	frontendRoot?: string;
}) {
	const policy = options.policy ?? options.library?.policy ?? builtinPolicy;
	const app = Fastify({
		loggerInstance: options.logger,
		genReqId: () => randomUUID(),
		requestIdHeader: false,
		trustProxy: false,
		bodyLimit: policy.runtime.httpBodyMaximumBytes,
		forceCloseConnections: "idle",
		ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
	}).withTypeProvider<TypeBoxTypeProvider>();
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
		{ schema: { response: { 200: HealthResponseSchema } } },
		async () => ({ status: "ok" as const }),
	);

	app.get(
		"/api/client-config",
		{ schema: { response: { 200: ClientConfigResponseSchema } } },
		async () => clientConfigResponse(policy),
	);
	if (options.library) {
		const library = options.library;
		app.addHook("onClose", async () => library.close());
		registerLibraryRoutes(app, library);
		registerMediaRoutes(app, library);
		const subtitles =
			options.subtitles ??
			new SubtitleApplication({
				sources: library.sources,
				policy: library.policy,
			});
		app.addHook("onClose", async () => subtitles.close());
		registerSubtitleRoutes(app, subtitles);
		registerSettingsRoutes(
			app,
			library.settings,
			policy.library.maximumScanIntervalMinutes,
		);
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
