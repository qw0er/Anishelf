import { join } from "node:path";
import { createSystemModule } from "../../modules/system/create.js";
import type { Environment } from "../../platform/environment.js";
import { ApplicationLogging } from "../../platform/logging/index.js";
import { DomainError } from "../../shared/errors.js";
import { openDatabase } from "./database.js";
import type { createHttpApp } from "./http.js";
import { initializeMediaTools } from "./media-tools.js";
import { createServer } from "./server.js";

type HttpApp = ReturnType<typeof createHttpApp>;

interface BackendOptions {
	env: Environment;
	/** Desktop can request an ephemeral socket without changing the deployment config contract. */
	listenPort?: number;
	localDeviceToken?: string;
}

interface RunningBackend {
	origin: string;
	close(): Promise<void>;
}

export async function startBackend({
	env,
	listenPort,
	localDeviceToken,
}: BackendOptions): Promise<RunningBackend> {
	let logging: ApplicationLogging | undefined;
	let app: HttpApp | undefined;
	try {
		const { api: configuration } = await createSystemModule(env);
		const config = configuration.deployment;
		logging = ApplicationLogging.create(config.logging);
		const logger = logging.logger;
		if (configuration.transcodeProfileIssue)
			logger.warn(
				{
					event: "configuration.transcode_profiles_invalid",
					...configuration.transcodeProfileIssue,
				},
				"Custom transcode profiles could not be loaded; using built-in profiles.",
			);
		logger.info(
			{
				event: "application.starting",
				dataDir: config.dataDir,
				logLevel: config.logging.level,
				logDestination: config.logging.destination,
				resourceRootCount: configuration.settings.resourceRoots.length,
				transcodeProfileCount: configuration.transcodeProfiles.length,
				transcodeProfilesPath: join(config.dataDir, "transcode-profiles.yaml"),
			},
			"Application starting.",
		);
		const tools = await initializeMediaTools(
			config.mediaTools,
			logger,
			configuration.environment.executableSearch,
		);
		const database = openDatabase(config.dataDir, logger);
		app = await createServer(configuration, logger, database, tools, {
			localDeviceToken,
		});
		const origin = await app.listen({
			host: config.host,
			port: listenPort ?? config.port,
		});
		const address = app.server.address();
		logger.info(
			{
				event: "application.started",
				host: config.host,
				port: typeof address === "object" ? address?.port : undefined,
			},
			"Anishelf API is listening.",
		);
		return runningBackend(origin, app, logging);
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

		const failures = [error];
		try {
			if (app) await app.close();
		} catch (cleanupError) {
			failures.push(cleanupError);
		}
		try {
			await logging?.close();
		} catch (cleanupError) {
			failures.push(cleanupError);
		}
		if (failures.length > 1)
			throw new AggregateError(failures, "Backend startup and cleanup failed.");
		throw error;
	}
}

function runningBackend(
	origin: string,
	app: HttpApp,
	logging: ApplicationLogging,
): RunningBackend {
	let closing: Promise<void> | undefined;
	const { logger } = logging;
	async function close() {
		try {
			await app.close();
			logger.info(
				{ event: "application.stopped" },
				"HTTP application stopped.",
			);
		} catch (err) {
			logger.error(
				{ event: "application.stop_failed", err },
				"HTTP shutdown failed.",
			);
			throw err;
		} finally {
			await logging.close();
		}
	}
	return {
		origin,
		close() {
			closing ??= close();
			return closing;
		},
	};
}
