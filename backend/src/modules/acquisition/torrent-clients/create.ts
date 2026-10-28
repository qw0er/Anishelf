import type { Logger } from "pino";
import { TorrentClientConnection } from "./application/connection.js";
import type {
	QbittorrentOptions,
	TorrentClient,
	TorrentClientsApi,
} from "./public.js";
import { QbittorrentClient } from "./qbittorrent/client.js";
import { QbittorrentConfigurationFile } from "./qbittorrent/configuration.js";
import { QbittorrentConfiguration } from "./qbittorrent/connection.js";
import { registerConnectionRoutes } from "./qbittorrent/http.js";

export interface TorrentClientsModuleOptions {
	dataDir: string;
	logger: Logger;
	createClient?: (options: QbittorrentOptions) => TorrentClient;
	suggestedApiUrl?: string;
	bundledConnectionFile?: string;
}

/** Standalone adapter for SDK tests and tools; starts no acquisition workers. */
export function createQbittorrentClient(
	options: QbittorrentOptions,
): TorrentClient {
	return new QbittorrentClient(options);
}

/** Provider selection, private configuration and connection lifetime stay here. */
export async function createTorrentClientsModule(
	options: TorrentClientsModuleOptions,
) {
	const logger = options.logger.child({ module: "torrent-clients" });
	const configuration = new QbittorrentConfiguration(
		new QbittorrentConfigurationFile(options.dataDir),
		options.createClient ?? createQbittorrentClient,
		logger,
		() => connection.invalidate(),
		options.suggestedApiUrl,
		options.bundledConnectionFile,
	);
	const connection: TorrentClientConnection = new TorrentClientConnection(
		configuration,
		logger,
	);
	await configuration.initialize();
	const api: TorrentClientsApi = {
		connectionGeneration: connection.connectionGeneration.bind(connection),
		withClient: connection.withClient.bind(connection),
		activeHashes: connection.activeHashes.bind(connection),
		connection: {
			settings: configuration.settings.bind(configuration),
			credentials: configuration.credentials.bind(configuration),
			save: configuration.save.bind(configuration),
			clear: configuration.clear.bind(configuration),
			probe: connection.probe.bind(connection),
		},
	};
	logger.info(
		{ event: "torrent_clients.initialized", clientType: "qbittorrent" },
		"Torrent clients module initialized.",
	);
	let closing: Promise<void> | undefined;
	return {
		api,
		registerHttp: (app: Parameters<typeof registerConnectionRoutes>[0]) =>
			registerConnectionRoutes(app, api.connection),
		runtime: {
			initializeBundled: async () => {
				await configuration.initializeBundled();
				return Boolean(configuration.settings().bundled);
			},
			close: () => {
				closing ??= Promise.all([
					configuration.close(),
					connection.close(),
				]).then(() => {});
				return closing;
			},
		},
	};
}
