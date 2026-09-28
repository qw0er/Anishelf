import { loadDeploymentConfig } from "./config/deployment.js";
import {
	checkResourceRoot,
	PersistentConfiguration,
} from "./config/persistent.js";
import { DomainError } from "./errors.js";
import { ApplicationLogging } from "./logging/index.js";

let logging: ApplicationLogging | undefined;
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
	logging.logger.info(
		{ event: "application.started" },
		"Deployment configuration and persistent settings loaded. HTTP server is not implemented yet.",
	);
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
} finally {
	if (logging) {
		logging.logger.info(
			{ event: "application.stopped" },
			"Application stopped.",
		);
	}
}
