import type { Logger } from "pino";
import { DomainError } from "../../shared/errors.js";
import type { AnimeApi, ReleaseAssessmentApi } from "../anime/public.js";
import type { AcquisitionResources } from "../resources/public.js";
import { DownloadsApplication } from "./downloads/application/application.js";
import type { DownloadStore } from "./downloads/public.js";
import { registerAcquisitionHttp } from "./http.js";
import type { AcquisitionStore } from "./persistence.js";
import type { AcquisitionApi } from "./public.js";
import { QbittorrentConnection } from "./qbittorrent/application.js";
import { QbittorrentClient } from "./qbittorrent/client.js";
import { QbittorrentConfigurationFile } from "./qbittorrent/configuration.js";
import type {
	QbittorrentApi,
	QbittorrentOptions,
} from "./qbittorrent/public.js";
import {
	createSourcesModule,
	type SourcesModuleOptions,
} from "./sources/create.js";
import { SubscriptionsApplication } from "./subscriptions/application/application.js";
import { loadAcquisitionProfiles } from "./subscriptions/infrastructure/profiles.js";

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
	bundledConnectionFile?: string;
	bundledSourcesConfigFile?: string;
	store: AcquisitionStore;
	downloadStore: DownloadStore;
	resources?: AcquisitionResources;
	ingestion?: NonNullable<AnimeApi["ingestion"]>;
	torrentTransport?: SourcesModuleOptions["torrentTransport"];
	anime?: ReleaseAssessmentApi;
	transport?: SourcesModuleOptions["transport"];
	now?: () => number;
	autoStart?: boolean;
	rssRefreshIntervalMinutes?: () => number | undefined;
	defaultAcquisitionProfileId?: () => string | undefined;
}) {
	const profiles = await loadAcquisitionProfiles(options.dataDir);
	options.logger.info(
		{ event: "acquisition.profiles_loaded", count: profiles.length },
		"Acquisition profiles loaded.",
	);
	const connection = new QbittorrentConnection(
		new QbittorrentConfigurationFile(options.dataDir),
		options.createClient ?? createQbittorrentClient,
		options.logger.child({ module: "acquisition" }),
		options.suggestedApiUrl,
		options.bundledConnectionFile,
	);
	await connection.initialize();
	const subscriptionStore = options.store;
	const sources = await createSourcesModule({
		...(options.bundledSourcesConfigFile
			? { bundledConfigFile: options.bundledSourcesConfigFile }
			: {}),
		dataDir: options.dataDir,
		logger: options.logger,
		store: subscriptionStore,
		...(options.transport ? { transport: options.transport } : {}),
		...(options.torrentTransport
			? { torrentTransport: options.torrentTransport }
			: {}),
		...(options.now ? { now: options.now } : {}),
		...(options.rssRefreshIntervalMinutes
			? { refreshIntervalMinutes: options.rssRefreshIntervalMinutes }
			: {}),
	});
	const subscriptions = new SubscriptionsApplication({
		store: subscriptionStore,
		profiles,
		defaultProfileId: () => options.defaultAcquisitionProfileId?.(),
		lockedCandidates: (key) => options.downloadStore.lockedCandidates(key),
		downloadTarget: () => {
			const destination = options.downloadStore.destination();
			return destination
				? {
						...destination,
						validated:
							destination.validated &&
							destination.connectionGeneration ===
								connection.settings().generation,
					}
				: null;
		},
		anime: options.anime ?? {
			target: async () => {
				throw new DomainError(
					"METADATA_UNAVAILABLE",
					"Subscription metadata is unavailable.",
				);
			},
			assessReleaseTitle: () => {
				throw new DomainError(
					"METADATA_UNAVAILABLE",
					"Subscription metadata is unavailable.",
				);
			},
		},
		sources: sources.api,
		downloads: (signal) => connection.activeHashes(signal),
		logger: options.logger,
		...(options.now ? { now: options.now } : {}),
	});
	const downloads =
		options.resources && options.anime && options.ingestion
			? new DownloadsApplication({
					store: options.downloadStore,
					selection: subscriptions.selection(),
					resources: options.resources,
					anime: options.anime,
					ingestion: options.ingestion,
					transport: {
						read: (reference, signal) =>
							sources.api.readContent(reference, signal),
						isCurrent: (reference) => sources.api.isContentCurrent(reference),
						close: async () => {},
					},
					connectionGeneration: () => connection.settings().generation,
					initializeBundled: async () => {
						await connection.initializeBundled();
						return Boolean(connection.settings().bundled);
					},
					withClient: (generation, operation) =>
						connection.withClient(generation, operation),
					logger: options.logger,
					...(options.now ? { now: options.now } : {}),
				})
			: undefined;
	if (options.autoStart !== false) {
		sources.runtime.start(
			() => subscriptions.activeSourceIds(),
			(source) => subscriptions.refreshSource(source.id),
		);
		downloads?.start();
	}
	const downloadApi = downloads;
	const api: AcquisitionApi = {
		sources: sources.api,
		connection: {
			settings: () => connection.settings(),
			credentials: (generation) => connection.credentials(generation),
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
		subscriptions: {
			profiles: () => subscriptions.profiles(),
			get: (key, page) => subscriptions.get(key, page),
			save: ({ destinationRevision, connectionGeneration, ...input }) =>
				subscriptions.save({
					...input,
					target: { destinationRevision, connectionGeneration },
				}),
			setEnabled: (key, revision, enabled) =>
				subscriptions.setEnabled(key, revision, enabled),
			remove: (key, revision) => subscriptions.remove(key, revision),
			refresh: (key, revision) => subscriptions.refresh(key, revision),
		},
	};
	let closing: Promise<void> | undefined;
	return {
		api,
		registerHttp: (app: Parameters<typeof registerAcquisitionHttp>[0]) =>
			registerAcquisitionHttp(app, api, sources.registerHttp),
		close: () => {
			closing ??= (async () => {
				await downloads?.close();
				const closingSubscriptions = subscriptions.close();
				await sources.runtime.close();
				await closingSubscriptions;
				await connection.close();
			})();
			return closing;
		},
	};
}
