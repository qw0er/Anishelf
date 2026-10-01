import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LibraryApplication } from "./application/library.js";
import { PlaybackApplication } from "./application/playback.js";
import { loadDeploymentConfig } from "./config/deployment.js";
import { PersistentConfiguration } from "./config/persistent.js";
import { ApplicationDatabase } from "./database/index.js";
import { DomainError } from "./errors.js";
import { createHttpApp } from "./http/app.js";
import { LibraryIndex } from "./library/index.js";
import { ApplicationLogging } from "./logging/index.js";

let database: ApplicationDatabase | undefined;
let logging: ApplicationLogging | undefined;
let app: ReturnType<typeof createHttpApp> | undefined;
try {
	const config = await loadDeploymentConfig();
	logging = ApplicationLogging.create(config.logging);
	try {
		database = ApplicationDatabase.open(config.dataDir);
		logging.logger.info(
			{ event: "database.ready" },
			"Database migrations applied.",
		);
	} catch (err) {
		logging.logger.error(
			{ event: "database.unavailable", err },
			"Database unavailable; playback persistence is disabled.",
		);
	}
	const persistentConfig = await PersistentConfiguration.load(config.dataDir);
	const library = new LibraryApplication({
		configuration: persistentConfig,
		index: new LibraryIndex(),
		logger: logging.logger,
	});
	const playback = new PlaybackApplication({
		library,
		logger: logging.logger,
		...(database ? { repository: database.playback } : {}),
	});
	const libraryError = (await library.getStatus()).error;
	if (libraryError) {
		const setupRequired = libraryError.code === "RESOURCE_ROOT_NOT_CONFIGURED";
		logging.logger[setupRequired ? "info" : "warn"](
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
			logging.logger.info(
				{ event: "library.startup_scan_started", scanId: scan.id },
				"Startup library scan started.",
			);
		} catch (err) {
			logging.logger.warn(
				{ event: "library.startup_scan_failed", err },
				"Startup library scan could not be started.",
			);
		}
	}
	const logger = logging.logger;
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
	app = server;
	server.addHook("onClose", async () => {
		database?.close();
	});
	await server.listen({ host: config.host, port: config.port });
	logger.info({ event: "application.started" }, "HTTP application started.");

	let shutdownTask: Promise<void> | undefined;
	const shutdown = () => {
		if (shutdownTask) return;
		shutdownTask = (async () => {
			process.off("SIGINT", shutdown);
			process.off("SIGTERM", shutdown);
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
				logger.info(
					{ event: "application.stopped" },
					"HTTP application stopped.",
				);
			} catch (err) {
				logger.error(
					{ event: "application.stop_failed", err },
					"HTTP shutdown failed.",
				);
				process.exitCode = 1;
			} finally {
				clearTimeout(timer);
			}
		})();
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
} catch (error) {
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
