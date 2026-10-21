import type { Logger } from "pino";
import { DomainError } from "../../shared/errors.js";
import type { AnimeApi, ReleaseAssessmentApi } from "../anime/public.js";
import type { AcquisitionResources } from "../resources/public.js";
import { DiscoveryApplication } from "./discovery/application/application.js";
import { parseRss } from "./discovery/infrastructure/rss.js";
import { RssTransport, rssUrl } from "./discovery/infrastructure/transport.js";
import type { FeedTransport } from "./discovery/public.js";
import type { DownloadStore, TorrentTransport } from "./downloads/public.js";
import { registerAcquisitionHttp } from "./http.js";
import type { DiscoveryStore } from "./persistence.js";
import type { AcquisitionApi } from "./public.js";
import { QbittorrentConnection } from "./qbittorrent/application.js";
import { QbittorrentClient } from "./qbittorrent/client.js";
import { QbittorrentConfigurationFile } from "./qbittorrent/configuration.js";
import type {
	QbittorrentApi,
	QbittorrentOptions,
} from "./qbittorrent/public.js";
import { SubscriptionConfirmation } from "./subscription-confirmation.js";
import { AcquisitionApplication } from "./workflows/application.js";

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
	store: DiscoveryStore;
	downloadStore: DownloadStore;
	resources?: AcquisitionResources;
	ingestion?: NonNullable<AnimeApi["ingestion"]>;
	torrentTransport?: TorrentTransport;
	anime?: ReleaseAssessmentApi;
	transport?: FeedTransport;
	now?: () => number;
	autoStart?: boolean;
	rssRefreshIntervalMinutes?: () => number | undefined;
}) {
	const connection = new QbittorrentConnection(
		new QbittorrentConfigurationFile(options.dataDir),
		options.createClient ?? createQbittorrentClient,
		options.logger.child({ module: "acquisition" }),
		options.suggestedApiUrl,
	);
	await connection.initialize();
	let workflow: AcquisitionApplication | undefined;
	const discoveryStore = options.store;
	const discovery = new DiscoveryApplication({
		store: discoveryStore,
		downloadPreview: (key, target) => workflow?.preview(key, target) ?? null,
		confirmation: new SubscriptionConfirmation({
			logger: options.logger,
			transaction: (operation) => discoveryStore.transaction(operation),
			authorize: (key, revision, destinationRevision) =>
				workflow?.authorizeSubscription(key, revision, destinationRevision),
		}),
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
		...(options.rssRefreshIntervalMinutes
			? { refreshIntervalMinutes: options.rssRefreshIntervalMinutes }
			: {}),
		normalizeUrl: rssUrl,
		downloads: (signal) => connection.activeHashes(signal),
		logger: options.logger,
		...(options.now ? { now: options.now } : {}),
	});
	workflow =
		options.resources && options.anime && options.ingestion
			? new AcquisitionApplication({
					store: options.downloadStore,
					selection: discovery.acquisition(),
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
	if (options.autoStart !== false) {
		discovery.start();
		workflow?.start();
	}
	const downloadApi = workflow;
	const api: AcquisitionApi = {
		connection: {
			settings: () => connection.settings(),
			save: (input) => connection.save(input),
			clear: (generation) => connection.clear(generation),
			probe: (generation) => connection.probe(generation),
		},
		...(downloadApi
			? {
					downloads: {
						settings: () => downloadApi.settings(),
						saveDestination: (input) => downloadApi.saveDestination(input),
						validate: (revision) => downloadApi.validate(revision),
						activity: (key, page) => downloadApi.activity(key, page),
						retry: (...args) => downloadApi.retry(...args),
					},
				}
			: {}),
		discovery: {
			get: (key, page) => discovery.get(key, page),
			preview: (session, input) => discovery.preview(session, input),
			confirm: (session, key, token) => discovery.confirm(session, key, token),
			setEnabled: (key, revision, enabled) =>
				discovery.setEnabled(key, revision, enabled),
			remove: (key, revision) => discovery.remove(key, revision),
			refresh: (key, revision) => discovery.refresh(key, revision),
		},
	};
	let closing: Promise<void> | undefined;
	return {
		api,
		registerHttp: (app: Parameters<typeof registerAcquisitionHttp>[0]) =>
			registerAcquisitionHttp(app, api),
		close: () => {
			closing ??= (async () => {
				await workflow?.close();
				await discovery.close();
				await connection.close();
			})();
			return closing;
		},
	};
}
