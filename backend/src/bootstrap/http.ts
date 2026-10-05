import { randomUUID } from "node:crypto";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { LogController } from "fastify";
import type { Logger } from "pino";
import { HealthResponseSchema } from "../contracts/schemas/index.js";
import type { ConfigurationService } from "../modules/configuration/application/service.js";
import type { DeploymentConfig } from "../modules/configuration/domain/model.js";
import { registerTranscodeProfileRoutes } from "../modules/configuration/http/transcode-profiles.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../modules/configuration/policy.js";
import type { LibraryApplication } from "../modules/library/application/library.js";
import { registerLibraryRoutes } from "../modules/library/http/library.js";
import { registerMediaRoutes } from "../modules/library/http/media.js";
import { registerSettingsRoutes } from "../modules/library/http/settings.js";
import type { MediaCompatibilityApplication } from "../modules/media-compatibility/application/compatibility.js";
import { registerCompatibilityRoutes } from "../modules/media-compatibility/http/compatibility.js";
import type { PlaybackApplication } from "../modules/playback/application/playback.js";
import { registerPlaybackRoutes } from "../modules/playback/http/playback.js";
import type { PreparationApplication } from "../modules/preparation/application/preparation.js";
import { registerPreparationRoutes } from "../modules/preparation/http/preparation.js";
import { SubtitleApplication } from "../modules/subtitles/application/subtitles.js";
import { registerSubtitleRoutes } from "../modules/subtitles/http/subtitles.js";
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
	preparation?: PreparationApplication;
	subtitles?: SubtitleApplication;
	compatibility?: MediaCompatibilityApplication;
	frontendRoot?: string;
	configuration?: ConfigurationService;
}) {
	const policy = options.policy ?? {
		...builtinPolicy,
		...options.library?.policy,
		subtitles: {
			...builtinPolicy.subtitles,
			...options.library?.policy.subtitles,
		},
	};
	const app = Fastify({
		loggerInstance: options.logger,
		logController: new LogController({ disableRequestLogging: true }),
		genReqId: () => randomUUID(),
		requestIdHeader: false,
		trustProxy: false,
		bodyLimit: policy.http.httpBodyMaximumBytes,
		forceCloseConnections: "idle",
		ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
	}).withTypeProvider<TypeBoxTypeProvider>();
	app.addHook("onRequest", async (request, reply) => {
		reply.header("x-request-id", request.id);
		request.log.trace(
			{
				event: "http.request_started",
				method: request.method,
				route: request.routeOptions.url,
			},
			"HTTP request started.",
		);
		checkRequestOrigin(request, options.config, options.development ?? false);
	});
	app.addHook("onResponse", async (request, reply) => {
		const context = {
			event: "http.request_completed",
			method: request.method,
			route: request.routeOptions.url,
			statusCode: reply.statusCode,
			durationMs: reply.elapsedTime,
		};
		if (reply.statusCode >= 500)
			request.log.error(context, "HTTP request completed with a server error.");
		else if (reply.statusCode >= 400)
			request.log.debug(context, "HTTP request rejected.");
		else request.log.trace(context, "HTTP request completed.");
	});
	app.setErrorHandler((error, request, reply) => {
		const { code, status } = classifyHttpError(error);
		if (status >= 500)
			request.log.error(
				{ event: "http.request_failed", err: error },
				"HTTP request failed.",
			);
		if (status < 500)
			request.log.debug(
				{ event: "http.request_rejected", code, statusCode: status },
				"HTTP request rejected.",
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

	if (options.library) {
		const library = options.library;
		app.addHook("onClose", async () => library.close());
		registerLibraryRoutes(app, library);
		registerMediaRoutes(app, library);
		const subtitles =
			options.subtitles ??
			new SubtitleApplication({
				sources: library.sources,
				logger: options.logger,
				policy,
			});
		app.addHook("onClose", async () => subtitles.close());
		registerSubtitleRoutes(app, subtitles);
		registerSettingsRoutes(
			app,
			library.settings,
			policy.library.maximumScanIntervalMinutes,
		);
	}

	if (options.configuration)
		registerTranscodeProfileRoutes(app, options.configuration);

	if (options.playback) {
		const playback = options.playback;
		app.addHook("onClose", async () => playback.close());
		registerPlaybackRoutes(app, playback);
	}

	if (options.compatibility)
		registerCompatibilityRoutes(app, options.compatibility);
	if (options.preparation) {
		const preparation = options.preparation;
		app.addHook("onClose", async () => preparation.close());
		registerPreparationRoutes(app, preparation);
	}
	const frontendRoot = options.frontendRoot;
	if (options.development && frontendRoot)
		app.register(async (scope) => registerFrontend(scope, frontendRoot));
	return app;
}
