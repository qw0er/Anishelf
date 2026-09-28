import { loadDeploymentConfig } from "./config/deployment.js";
import {
	checkResourceRoot,
	PersistentConfiguration,
} from "./config/persistent.js";
import { DomainError } from "./errors.js";
import { createHttpApp } from "./http/app.js";
import { LibraryIndex } from "./library/index.js";
import { LibraryScanner } from "./library/scanner.js";
import { ApplicationLogging } from "./logging/index.js";

let logging: ApplicationLogging | undefined;
let app: ReturnType<typeof createHttpApp> | undefined;
try {
	const config = await loadDeploymentConfig();
	logging = ApplicationLogging.create(config.logging);
	const persistentConfig = await PersistentConfiguration.load(config.dataDir);
	const libraryError = await checkResourceRoot(persistentConfig.settings);
	if (libraryError) {
		logging.logger.warn(
			{ event: "library.root_unavailable", ...libraryError },
			libraryError.message,
		);
	}
	const logger = logging.logger;
	const index = new LibraryIndex();
	const settings = () => persistentConfig.settings;
	const scanner = new LibraryScanner({ index, settings, logger });
	const server = createHttpApp({
		config,
		logger,
		library: { index, scanner, settings },
		development: process.env.NODE_ENV === "development",
	});
	app = server;
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
}
