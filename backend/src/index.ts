import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import { LibraryApplication } from "./application/library.js";
import { PlaybackApplication } from "./application/playback.js";
import { loadDeploymentConfig } from "./config/deployment.js";
import type { DeploymentConfig, MediaToolsConfig } from "./config/model.js";
import { PersistentConfiguration } from "./config/persistent.js";
import { ApplicationDatabase } from "./database/index.js";
import { DomainError } from "./errors.js";
import { createHttpApp } from "./http/app.js";
import { LibraryIndex } from "./library/index.js";
import { ApplicationLogging } from "./logging/index.js";
import { MediaTools } from "./media/index.js";

type HttpApp = ReturnType<typeof createHttpApp>;

async function initializeMediaTools(
	config: MediaToolsConfig,
	logger: Logger,
): Promise<void> {
	const mediaTools = await MediaTools.create(config);
	for (const [tool, status] of Object.entries(mediaTools.status)) {
		if (status.available) {
			logger.info(
				{ event: "media.tool_ready", tool, ...status },
				"Media tool ready.",
			);
		} else {
			logger.warn({ event: "media.tool_unavailable", tool }, status.message);
		}
	}
}

function openDatabase(
	dataDir: string,
	logger: Logger,
): ApplicationDatabase | undefined {
	try {
		const database = ApplicationDatabase.open(dataDir);
		logger.info({ event: "database.ready" }, "Database migrations applied.");
		return database;
	} catch (err) {
		logger.error(
			{ event: "database.unavailable", err },
			"Database unavailable; playback persistence is disabled.",
		);
		return undefined;
	}
}

async function initializeLibrary(
	dataDir: string,
	logger: Logger,
): Promise<LibraryApplication> {
	const configuration = await PersistentConfiguration.load(dataDir);
	const library = new LibraryApplication({
		configuration,
		index: new LibraryIndex(),
		logger,
	});
	const libraryError = (await library.getStatus()).error;
	if (libraryError) {
		const setupRequired = libraryError.code === "RESOURCE_ROOT_NOT_CONFIGURED";
		logger[setupRequired ? "info" : "warn"](
			{
				event: setupRequired
					? "library.setup_required"
					: "library.root_unavailable",
				...libraryError,
			},
			libraryError.message,
		);
	}
	if (library.getSettings().resourceRoot !== null) {
		try {
			const scan = await library.startScan();
			logger.info(
				{ event: "library.startup_scan_started", scanId: scan.id },
				"Startup library scan started.",
			);
		} catch (err) {
			logger.warn(
				{ event: "library.startup_scan_failed", err },
				"Startup library scan could not be started.",
			);
		}
	}
	return library;
}

function createServer(
	config: DeploymentConfig,
	logger: Logger,
	library: LibraryApplication,
	database: ApplicationDatabase | undefined,
): HttpApp {
	const playback = new PlaybackApplication({
		library,
		logger,
		...(database ? { repository: database.playback } : {}),
	});
	const development = process.env.NODE_ENV === "development";
	const frontendRoot = fileURLToPath(
		new URL("../../web/dist/", import.meta.url),
	);
	const server = createHttpApp({
		config,
		logger,
		library,
		playback,
		development,
		...(development && existsSync(join(frontendRoot, "index.html"))
			? { frontendRoot }
			: {}),
	});
	server.addHook("onClose", async () => {
		database?.close();
	});
	return server;
}

async function stopServer(server: HttpApp, logger: Logger): Promise<void> {
	const timer = setTimeout(() => {
		logger.error(
			{ event: "application.shutdown_timeout" },
			"Shutdown exceeded five seconds.",
		);
		process.exit(1);
	}, 5000);
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
		clearTimeout(timer);
	}
}

function registerShutdown(server: HttpApp, logger: Logger): void {
	let shutdownTask: Promise<void> | undefined;
	const shutdown = () => {
		if (shutdownTask) return;
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		shutdownTask = stopServer(server, logger);
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
	if (app) await app.close();
	else database?.close();
}

async function main(): Promise<void> {
	let database: ApplicationDatabase | undefined;
	let logging: ApplicationLogging | undefined;
	let app: HttpApp | undefined;
	try {
		const config = await loadDeploymentConfig();
		logging = ApplicationLogging.create(config.logging);
		const logger = logging.logger;
		await initializeMediaTools(config.mediaTools, logger);
		database = openDatabase(config.dataDir, logger);
		const library = await initializeLibrary(config.dataDir, logger);
		app = createServer(config, logger, library, database);
		await app.listen({ host: config.host, port: config.port });
		logger.info({ event: "application.started" }, "HTTP application started.");
		registerShutdown(app, logger);
	} catch (error) {
		await handleStartupFailure(error, logging, app, database);
	}
}

await main();
