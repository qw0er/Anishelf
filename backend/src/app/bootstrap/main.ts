import { createSystemModule } from "../../modules/system/create.js";
import { ApplicationLogging } from "../../platform/logging/index.js";
import { DomainError } from "../../shared/errors.js";
import { builtinPolicy, validatePolicy } from "../policy.js";
import { type ApplicationDatabase, openDatabase } from "./database.js";
import type { createHttpApp } from "./http.js";
import { initializeMediaTools } from "./media-tools.js";
import { createServer } from "./server.js";

type HttpApp = ReturnType<typeof createHttpApp>;

async function stopServer(
	server: HttpApp,
	logging: ApplicationLogging,
	shutdownTimeoutMs: number,
): Promise<void> {
	const logger = logging.logger;
	const timer = setTimeout(() => {
		logger.error(
			{ event: "application.shutdown_timeout" },
			`Shutdown exceeded ${shutdownTimeoutMs} milliseconds.`,
		);
		process.exit(1);
	}, shutdownTimeoutMs);
	timer.unref();
	try {
		await server.close();
		logger.info({ event: "application.stopped" }, "HTTP application stopped.");
	} catch (err) {
		logger.error(
			{ event: "application.stop_failed", err },
			"HTTP shutdown failed.",
		);
		process.exitCode = 1;
	} finally {
		await logging.close();
		clearTimeout(timer);
	}
}

function registerShutdown(
	server: HttpApp,
	logging: ApplicationLogging,
	shutdownTimeoutMs: number,
): void {
	let shutdownTask: Promise<void> | undefined;
	const shutdown = () => {
		if (shutdownTask) return;
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		shutdownTask = stopServer(server, logging, shutdownTimeoutMs);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

async function handleStartupFailure(
	error: unknown,
	logging: ApplicationLogging | undefined,
	app: HttpApp | undefined,
	database: ApplicationDatabase | undefined,
): Promise<void> {
	const message =
		error instanceof DomainError
			? error.message
			: "Unexpected startup failure.";
	if (logging)
		logging.logger.error(
			{ event: "application.start_failed", err: error },
			message,
		);
	else process.stderr.write(`Anishelf startup failed: ${message}\n`);
	process.exitCode = 1;
	try {
		if (app) await app.close();
		else database?.close();
	} finally {
		await logging?.close();
	}
}

async function main(): Promise<void> {
	let database: ApplicationDatabase | undefined;
	let logging: ApplicationLogging | undefined;
	let app: HttpApp | undefined;
	try {
		validatePolicy(builtinPolicy);
		const { api: configuration } = await createSystemModule(
			process.env,
			builtinPolicy,
		);
		const config = configuration.deployment;
		logging = ApplicationLogging.create(config.logging);
		const logger = logging.logger;
		logger.info(
			{
				event: "application.starting",
				logLevel: config.logging.level,
				logDestination: config.logging.destination,
			},
			"Application starting.",
		);
		const tools = await initializeMediaTools(
			config.mediaTools,
			logger,
			builtinPolicy,
			configuration.environment.executableSearch,
		);
		database = openDatabase(config.dataDir, logger, builtinPolicy);
		app = await createServer(configuration, logger, database, tools);
		await app.listen({ host: config.host, port: config.port });
		logger.info({ event: "application.started" }, "HTTP application started.");
		registerShutdown(app, logging, builtinPolicy.runtime.shutdownTimeoutMs);
	} catch (error) {
		await handleStartupFailure(error, logging, app, database);
	}
}

await main();
