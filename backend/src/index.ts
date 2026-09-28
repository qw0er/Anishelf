import { loadDeploymentConfig } from "./config/deployment.js";
import { DomainError } from "./errors.js";
import { ApplicationLogging } from "./logging/index.js";

let logging: ApplicationLogging | undefined;
try {
	const config = await loadDeploymentConfig();
	logging = ApplicationLogging.create(config.logging);
	logging.logger.info(
		{ event: "application.started" },
		"Deployment configuration loaded. HTTP server is not implemented yet.",
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
