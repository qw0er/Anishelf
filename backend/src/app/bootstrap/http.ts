import { randomUUID } from "node:crypto";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, {
	type FastifyPluginAsync,
	LogController,
	type RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import { HealthResponseSchema } from "../../contracts/schemas/index.js";
import type { DeploymentConfig } from "../../modules/system/public.js";
import { apiError, classifyHttpError } from "../../transport/errors.js";
import type { HttpInstance } from "../../transport/instance.js";
import { checkRequestOrigin } from "../../transport/security.js";
import { registerFrontend } from "../../transport/static.js";
export function createHttpApp(options: {
	config: Pick<
		DeploymentConfig,
		"host" | "port" | "publicOrigin" | "trustedProxies"
	>;
	logger: Logger;
	bodyLimit?: number;
	development?: boolean;
	frontendRoot?: string;
	configure?: (app: HttpInstance) => Promise<void>;
	registrations: readonly ((app: HttpInstance) => void)[];
	closeDependencies: () => Promise<void>;
}) {
	options.logger.info(
		{
			event: "http.proxy_configured",
			trustedProxies: options.config.trustedProxies ?? ["loopback"],
			publicOrigin: options.config.publicOrigin,
			bodyLimit: options.bodyLimit ?? 64 * 1024,
		},
		"HTTP proxy trust configured.",
	);
	const app = Fastify({
		loggerInstance: options.logger,
		logController: new LogController({ disableRequestLogging: true }),
		genReqId: () => randomUUID(),
		requestIdHeader: false,
		trustProxy: [...(options.config.trustedProxies ?? ["loopback"])],
		bodyLimit: options.bodyLimit ?? 64 * 1024,
		forceCloseConnections: "idle",
		ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
	}).withTypeProvider<TypeBoxTypeProvider>();
	app.addHook("onRequest", async (request, reply) => {
		reply.header("x-request-id", request.id);
		reply.header("Referrer-Policy", "no-referrer");
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
		const { code, status, retryAt } = classifyHttpError(error);
		if (retryAt !== undefined)
			reply.header(
				"Retry-After",
				String(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))),
			);
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

	app.addHook("onClose", options.closeDependencies);
	const registerRoutes: FastifyPluginAsync<
		Record<never, never>,
		RawServerDefault,
		TypeBoxTypeProvider,
		Logger
	> = async (http) => {
		await options.configure?.(http);
		for (const register of options.registrations) register(http);
		if (options.frontendRoot)
			await registerFrontend(http, options.frontendRoot);
	};
	app.register(registerRoutes);
	return app;
}
