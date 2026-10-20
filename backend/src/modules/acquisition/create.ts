import type { Logger } from "pino";
import { DomainError } from "../../shared/errors.js";
import type { ReleaseAssessmentApi } from "../anime/public.js";
import { QbittorrentConnection } from "./connection/application.js";
import { QbittorrentConfigurationFile } from "./connection/infrastructure/configuration.js";
import { DiscoveryApplication } from "./discovery/application.js";
import { parseRss } from "./discovery/infrastructure/rss.js";
import { RssTransport, rssUrl } from "./discovery/infrastructure/transport.js";
import type { FeedTransport } from "./discovery/public.js";
import { registerAcquisitionHttp } from "./http.js";
import type { DiscoveryStore } from "./persistence.js";
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
	suggestedApiUrl?: string;
	store?: DiscoveryStore;
	anime?: ReleaseAssessmentApi;
	transport?: FeedTransport;
	now?: () => number;
	autoStart?: boolean;
}) {
	const connection = new QbittorrentConnection(
		new QbittorrentConfigurationFile(options.dataDir),
		options.createClient ?? createQbittorrentClient,
		options.logger.child({ module: "acquisition" }),
		options.suggestedApiUrl,
	);
	await connection.initialize();
	const discovery = options.store
		? new DiscoveryApplication({
				store: options.store,
				anime: options.anime ?? {
					target: async () => {
						throw new DomainError(
							"METADATA_UNAVAILABLE",
							"Subscription metadata is unavailable.",
						);
					},
					assess: () => {
						throw new DomainError(
							"METADATA_UNAVAILABLE",
							"Subscription metadata is unavailable.",
						);
					},
				},
				transport: options.transport ?? new RssTransport(),
				parse: parseRss,
				normalizeUrl: rssUrl,
				downloads: (signal) => connection.activeHashes(signal),
				logger: options.logger,
				...(options.now ? { now: options.now } : {}),
			})
		: undefined;
	if (options.autoStart !== false) discovery?.start();
	const api: AcquisitionApi = {
		connection,
		...(discovery ? { discovery } : {}),
	};
	return {
		api,
		registerHttp: (app: Parameters<typeof registerAcquisitionHttp>[0]) =>
			registerAcquisitionHttp(app, api),
		close: async () => {
			await discovery?.close();
			await connection.close();
		},
	};
}
