import type { Logger } from "pino";
import { DomainError } from "../../shared/errors.js";
import type { AnimeApi, ReleaseAssessmentApi } from "../anime/public.js";
import type { AcquisitionResources } from "../resources/public.js";
import { QbittorrentConnection } from "./connection/application.js";
import { QbittorrentConfigurationFile } from "./connection/infrastructure/configuration.js";
import { DiscoveryApplication } from "./discovery/application.js";
import { parseRss } from "./discovery/infrastructure/rss.js";
import { RssTransport, rssUrl } from "./discovery/infrastructure/transport.js";
import type { FeedTransport } from "./discovery/public.js";
import { DownloadsApplication } from "./downloads/application.js";
import type { DownloadStore, TorrentTransport } from "./downloads/public.js";
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
	downloadStore?: DownloadStore;
	resources?: AcquisitionResources;
	ingestion?: NonNullable<AnimeApi["ingestion"]>;
	torrentTransport?: TorrentTransport;
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
	const downloads =
		options.downloadStore &&
		options.store &&
		options.resources &&
		options.anime &&
		options.ingestion
			? new DownloadsApplication({
					store: options.downloadStore,
					discovery: options.store,
					resources: options.resources,
					anime: options.anime,
					ingestion: options.ingestion,
					transport: options.torrentTransport ?? new RssTransport(),
					connectionGeneration: () => connection.settings().generation,
					withClient: (generation, operation) =>
						connection.withClient(generation, operation),
					logger: options.logger,
					...(options.now ? { now: options.now } : {}),
				})
			: undefined;
	const discovery = options.store
		? new DiscoveryApplication({
				store: options.store,
				...(downloads
					? {
							downloadPreview: (key, target) => downloads.preview(key, target),
							authorizeDownloads: (subscription, revision) =>
								downloads.authorize(
									subscription.workKey,
									subscription.revision,
									revision,
								),
						}
					: {}),
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
	if (options.autoStart !== false) {
		discovery?.start();
		downloads?.start();
	}
	const api: AcquisitionApi = {
		connection,
		...(downloads ? { downloads } : {}),
		...(discovery ? { discovery } : {}),
	};
	return {
		api,
		registerHttp: (app: Parameters<typeof registerAcquisitionHttp>[0]) =>
			registerAcquisitionHttp(app, api),
		close: async () => {
			await downloads?.close();
			await discovery?.close();
			await connection.close();
		},
	};
}
