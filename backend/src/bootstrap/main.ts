import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import { ConfigurationService } from "../modules/configuration/application/service.js";
import type { MediaToolsConfig } from "../modules/configuration/domain/model.js";
import type {
	BuiltinPolicy,
	DeepReadonly,
} from "../modules/configuration/policy.js";
import type { LibraryApplication } from "../modules/library/application/library.js";
import { LibraryIndex } from "../modules/library/infrastructure/index.js";
import { MediaCompatibilityApplication } from "../modules/media-compatibility/application/compatibility.js";
import { MediaInspectionApplication } from "../modules/media-inspection/application/inspection.js";
import { PlaybackApplication } from "../modules/playback/application/playback.js";
import { SubtitleApplication } from "../modules/subtitles/application/subtitles.js";
import { ApplicationLogging } from "../platform/logging/index.js";
import { MediaTools } from "../platform/media/index.js";
import { DomainError } from "../shared/errors.js";
import { ApplicationDatabase } from "./database.js";
import { createHttpApp } from "./http.js";
import { createLibraryModule } from "./library.js";

type HttpApp = ReturnType<typeof createHttpApp>;

async function initializeMediaTools(
	config: MediaToolsConfig,
	logger: Logger,
	policy: DeepReadonly<BuiltinPolicy>,
	environment: ConfigurationService["environment"]["executableSearch"],
): Promise<MediaTools> {
	const mediaTools = await MediaTools.create(
		config,
		policy,
		environment,
		logger,
	);
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
	return mediaTools;
}

function openDatabase(
	dataDir: string,
	logger: Logger,
	policy: DeepReadonly<BuiltinPolicy>,
): ApplicationDatabase | undefined {
	try {
		const database = ApplicationDatabase.open(dataDir, policy);
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
	configuration: ConfigurationService,
	logger: Logger,
): Promise<LibraryApplication> {
	const library = createLibraryModule({
		configuration,
		policy: configuration.policy,
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

async function createServer(
	configuration: ConfigurationService,
	logger: Logger,
	library: LibraryApplication,
	database: ApplicationDatabase | undefined,
	tools: MediaTools,
): Promise<HttpApp> {
	const config = configuration.deployment;
	const playback = new PlaybackApplication({
		policy: configuration.policy.playback,
		sources: library.sources,
		logger,
		...(database ? { repository: database.playback } : {}),
	});
	const development = configuration.environment.development;
	const frontendRoot = fileURLToPath(
		new URL("../../../web/dist/", import.meta.url),
	);
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools,
		policy: configuration.policy.mediaInspection,
		logger,
	});
	const subtitles = new SubtitleApplication({
		logger,
		sources: library.sources,
		policy: configuration.policy,
		inspection,
		tools,
		dataDir: config.dataDir,
		...(database ? { repository: database.subtitles } : {}),
	});
	try {
		await subtitles.initialize();
	} catch (err) {
		logger.warn(
			{ event: "subtitles.cache_unavailable", err },
			"Subtitle preparation is unavailable; direct playback and external subtitles remain usable.",
		);
	}
	const server = createHttpApp({
		config,
		policy: configuration.policy,
		logger,
		library,
		playback,
		subtitles,
		compatibility: new MediaCompatibilityApplication({
			inspection,
			sources: library.sources,
			logger,
		}),
		development,
		...(development && existsSync(join(frontendRoot, "index.html"))
			? { frontendRoot }
			: {}),
	});
	server.addHook("onClose", async () => {
		await subtitles.close();
		await inspection.close();
		database?.close();
	});
	return server;
}

async function stopServer(
	server: HttpApp,
	logger: Logger,
	shutdownTimeoutMs: number,
): Promise<void> {
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
		clearTimeout(timer);
	}
}

function registerShutdown(
	server: HttpApp,
	logger: Logger,
	shutdownTimeoutMs: number,
): void {
	let shutdownTask: Promise<void> | undefined;
	const shutdown = () => {
		if (shutdownTask) return;
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		shutdownTask = stopServer(server, logger, shutdownTimeoutMs);
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
		const configuration = await ConfigurationService.load();
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
			configuration.policy,
			configuration.environment.executableSearch,
		);
		database = openDatabase(config.dataDir, logger, configuration.policy);
		const library = await initializeLibrary(configuration, logger);
		app = await createServer(configuration, logger, library, database, tools);
		await app.listen({ host: config.host, port: config.port });
		logger.info({ event: "application.started" }, "HTTP application started.");
		registerShutdown(
			app,
			logger,
			configuration.policy.runtime.shutdownTimeoutMs,
		);
	} catch (error) {
		await handleStartupFailure(error, logging, app, database);
	}
}

await main();
