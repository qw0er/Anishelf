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
import { SourcesApplication } from "./sources/application/application.js";
import { JackettClient } from "./sources/jackett/client.js";
import { JackettConfigurationFile } from "./sources/jackett/configuration.js";
import {
	JackettConnection,
	sourceCommand,
} from "./sources/jackett/connection.js";
import { JackettTransport } from "./sources/jackett/transport.js";
import { type FeedTransport, SourceError } from "./sources/public.js";
import { SourceRequestGate } from "./sources/request-gate.js";
import { parseRss, RssTransport, rssUrl } from "./sources/rss/public.js";
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
	store: AcquisitionStore;
	downloadStore: DownloadStore;
	resources?: AcquisitionResources;
	ingestion?: NonNullable<AnimeApi["ingestion"]>;
	torrentTransport?: import("./sources/downloads.js").SourceTorrentTransport;
	anime?: ReleaseAssessmentApi;
	transport?: FeedTransport;
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
	const gate = new SourceRequestGate();
	const jackett = new JackettConnection(
		new JackettConfigurationFile(options.dataDir),
		(configuration) => {
			const connection = configuration.connection;
			if (!connection?.apiKey) throw new SourceError("source_unconfigured");
			return new JackettClient(
				new JackettTransport(
					connection.url,
					connection.apiKey,
					configuration.generation,
				),
				gate,
			);
		},
		options.logger,
	);
	await jackett.initialize();
	const sources = new SourcesApplication({
		store: subscriptionStore,
		...(options.torrentTransport
			? { torrentTransport: options.torrentTransport }
			: {}),
		rss: {
			gate,
			store: subscriptionStore,
			transport: options.transport ?? new RssTransport(),
			parse: parseRss,
			normalizeUrl: rssUrl,
			logger: options.logger,
		},
		jackett,
		logger: options.logger,
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
		sources,
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
							sources.readDownload(reference, signal),
						isCurrent: (reference) => sources.isDownloadCurrent(reference),
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
		subscriptions.start();
		downloads?.start();
	}
	const downloadApi = downloads;
	const api: AcquisitionApi = {
		sources: {
			settings: () => jackett.settings(),
			save: (input) => sourceCommand(() => jackett.save(input)),
			clear: (generation) => sourceCommand(() => jackett.clear(generation)),
			indexers: (generation) =>
				sourceCommand(() => jackett.indexers(generation)),
			probe: (generation, id) =>
				sourceCommand(() => jackett.probe(generation, id)),
			search: (plan) =>
				sourceCommand(async () => {
					const result = await sources.refresh(sources.jackettReference(plan));
					if (!sources.isCurrent(result))
						throw new SourceError("source_conflict");
					if (!result.coverage || !result.outcome)
						throw new SourceError("malformed_response");
					return {
						source: result.label,
						outcome: result.outcome,
						coverage: result.coverage,
						entries: result.entries.map((entry) => ({
							id: entry.id,
							title: entry.title,
							publishedAt: entry.publishedAt,
							size: entry.size ?? null,
							seeders: entry.seeders ?? null,
							peers: entry.peers ?? null,
							downloadAvailable: Boolean(entry.download),
						})),
					};
				}),
		},
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
			save: async ({
				rssUrl,
				destinationRevision,
				connectionGeneration,
				...input
			}) => {
				try {
					const source = rssUrl.trim()
						? sources.rssReference(rssUrl.trim())
						: null;
					return await subscriptions.save({
						...input,
						source,
						target: { destinationRevision, connectionGeneration },
					});
				} catch (error) {
					if (
						error instanceof SourceError &&
						error.code === "invalid_source_url"
					)
						throw new DomainError(
							"INVALID_REQUEST",
							"Enter a public HTTP(S) RSS URL.",
						);
					if (error instanceof SourceError)
						throw new DomainError(
							error.code === "source_conflict"
								? "ACQUISITION_CONFLICT"
								: "ACQUISITION_UNAVAILABLE",
							"The saved source is unavailable or changed. Check its configuration and save again.",
						);
					throw error;
				}
			},
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
			registerAcquisitionHttp(app, api),
		close: () => {
			closing ??= (async () => {
				await downloads?.close();
				const closingSubscriptions = subscriptions.close();
				await sources.close();
				await closingSubscriptions;
				await connection.close();
			})();
			return closing;
		},
	};
}
