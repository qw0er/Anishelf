import type { Logger } from "pino";
import { DomainError } from "../../shared/errors.js";
import type { AnimeApi, ReleaseAssessmentApi } from "../anime/public.js";
import type { AcquisitionResources } from "../resources/public.js";
import { DiscoveryApplication } from "./discovery/application/application.js";
import { loadAcquisitionProfiles } from "./discovery/infrastructure/profiles.js";
import type { DownloadStore, TorrentTransport } from "./downloads/public.js";
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
	bundledConnectionFile?: string;
	store: AcquisitionStore;
	downloadStore: DownloadStore;
	resources?: AcquisitionResources;
	ingestion?: NonNullable<AnimeApi["ingestion"]>;
	torrentTransport?: TorrentTransport;
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
	let workflow: AcquisitionApplication | undefined;
	const discoveryStore = options.store;
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
		rss: {
			gate,
			store: discoveryStore,
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
	const discovery = new DiscoveryApplication({
		store: discoveryStore,
		profiles,
		defaultProfileId: () => options.defaultAcquisitionProfileId?.(),
		lockedCandidates: (key) =>
			options.downloadStore.activity(key, 1, 1).candidateIds,
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
		discovery.start();
		workflow?.start();
	}
	const downloadApi = workflow;
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
		discovery: {
			profiles: () => discovery.profiles(),
			get: (key, page) => discovery.get(key, page),
			preview: async (session, { rssUrl, ...input }) => {
				try {
					const source = rssUrl.trim()
						? sources.rssReference(rssUrl.trim())
						: null;
					return await discovery.preview(session, { ...input, source });
				} catch (error) {
					if (
						error instanceof SourceError &&
						error.code === "invalid_source_url"
					)
						throw new DomainError(
							"INVALID_REQUEST",
							"Enter a public HTTP(S) RSS URL.",
						);
					throw error;
				}
			},
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
				const closingDiscovery = discovery.close();
				await sources.close();
				await closingDiscovery;
				await connection.close();
			})();
			return closing;
		},
	};
}
