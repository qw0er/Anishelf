import type { Logger } from "pino";
import { QbittorrentConnection } from "./connection/application.js";
import { QbittorrentConfigurationFile } from "./connection/infrastructure/configuration.js";
import { registerAcquisitionHttp } from "./http.js";
import type { AcquisitionApi } from "./public.js";
import { QbittorrentClient } from "./qbittorrent/client.js";
import type {
	QbittorrentApi,
	QbittorrentOptions,
} from "./qbittorrent/domain/model.js";

/** Standalone adapter foundation; no workers or automatic downloads are started. */
export function createQbittorrentClient(
	options: QbittorrentOptions,
): QbittorrentApi {
	return new QbittorrentClient(options);
}

export async function createAcquisitionModule(options: {
	dataDir: string;
	logger: Logger;
	createClient?: (options: QbittorrentOptions) => QbittorrentApi;
}) {
	const connection = new QbittorrentConnection(
		new QbittorrentConfigurationFile(options.dataDir),
		options.createClient ?? createQbittorrentClient,
		options.logger.child({ module: "acquisition" }),
	);
	await connection.initialize();
	const api: AcquisitionApi = { connection };
	return {
		api,
		registerHttp: (app: Parameters<typeof registerAcquisitionHttp>[0]) =>
			registerAcquisitionHttp(app, api),
		close: () => connection.close(),
	};
}
