import type { Logger } from "pino";
import { DomainError } from "../../shared/errors.js";
import type { AnimeApi, ReleaseAssessmentApi } from "../anime/public.js";
import type { AcquisitionResources } from "../resources/public.js";
import { DownloadsApplication } from "./downloads/application/application.js";
import type { DownloadStore } from "./downloads/public.js";
import { registerAcquisitionHttp } from "./http.js";
import type { AcquisitionStore } from "./persistence.js";
import type { AcquisitionApi } from "./public.js";
import {
	createSourcesModule,
	type SourcesModuleOptions,
} from "./sources/create.js";
import { SubscriptionsApplication } from "./subscriptions/application/application.js";
import { acquisitionProfileFingerprint } from "./subscriptions/domain/profiles.js";
import { loadAcquisitionProfiles } from "./subscriptions/infrastructure/profiles.js";
import {
	createTorrentClientsModule,
	type TorrentClientsModuleOptions,
} from "./torrent-clients/create.js";
import { WatchingApplication } from "./watching/application/application.js";
import type { WatchingListPort } from "./watching/public.js";

export async function createAcquisitionModule(options: {
	dataDir: string;
	watching?: WatchingListPort;
	logger: Logger;
	createClient?: TorrentClientsModuleOptions["createClient"];
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
	const profileCatalog = await loadAcquisitionProfiles(options.dataDir);
	const profiles = profileCatalog.profiles;
	if (profileCatalog.issue)
		options.logger.warn(
			{
				event: "acquisition.profiles_invalid",
				...profileCatalog.issue,
			},
			"Custom acquisition profiles could not be loaded; using built-in profiles.",
		);
	options.logger.info(
		{ event: "acquisition.profiles_loaded", count: profiles.length },
		"Acquisition profiles loaded.",
	);

	const torrentClients = await createTorrentClientsModule({
		dataDir: options.dataDir,
		logger: options.logger.child({ module: "acquisition" }),
		...(options.createClient ? { createClient: options.createClient } : {}),
		...(options.suggestedApiUrl
			? { suggestedApiUrl: options.suggestedApiUrl }
			: {}),
		...(options.bundledConnectionFile
			? { bundledConnectionFile: options.bundledConnectionFile }
			: {}),
	});
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
	let watching: WatchingApplication | undefined;
	const subscriptions = new SubscriptionsApplication({
		onRemoved: (key) => watching?.manualRemove(key),
		managedStopReason: (subscription) =>
			watching ? watching.stopReason(subscription) : "authorization_required",
		store: subscriptionStore,
		profiles,
		...(profileCatalog.issue ? { profileIssue: profileCatalog.issue } : {}),
		defaultProfileId: () => options.defaultAcquisitionProfileId?.(),
		lockedCandidates: options.downloadStore.lockedCandidates.bind(
			options.downloadStore,
		),
		downloadTarget: () => {
			const destination = options.downloadStore.destination();
			return destination
				? {
						...destination,
						validated:
							destination.validated &&
							destination.connectionGeneration ===
								torrentClients.api.connectionGeneration(),
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
		downloads: torrentClients.api.activeHashes,
		logger: options.logger,
		...(options.now ? { now: options.now } : {}),
	});
	watching = new WatchingApplication({
		store: options.store.watching,
		hasCapacity: subscriptions.hasCapacity.bind(subscriptions),
		renewManaged: subscriptions.renewManaged.bind(subscriptions),
		transaction: options.store.transaction.bind(options.store),
		...(options.watching ? { tracking: options.watching } : {}),
		sources: sources.api,
		subscriptions,
		subscription: options.store.subscription.bind(options.store),
		admit: subscriptions.saveAtomically.bind(subscriptions),
		target: () => {
			const target = options.downloadStore.destination();
			return target
				? {
						...target,
						validated:
							target.validated &&
							target.connectionGeneration ===
								torrentClients.api.connectionGeneration(),
					}
				: null;
		},
		profileFingerprint: (id) => {
			const profile = profiles.find((profile) => profile.id === id);
			return profile ? acquisitionProfileFingerprint(profile) : null;
		},
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
						read: sources.api.readContent,
						isCurrent: sources.api.isContentCurrent,
						close: async () => {},
					},
					connectionGeneration: torrentClients.api.connectionGeneration,
					initializeBundled: torrentClients.runtime.initializeBundled,
					withClient: torrentClients.api.withClient,
					logger: options.logger,
					...(options.now ? { now: options.now } : {}),
				})
			: undefined;
	if (options.autoStart !== false) {
		watching.start();
		subscriptions.start();
		sources.runtime.start(
			() => subscriptions.activeSourceIds(),
			(source) => subscriptions.refreshSource(source.id),
		);
		downloads?.start();
	}
	const downloadApi = downloads;
	const api: AcquisitionApi = {
		watching,
		sources: sources.api,
		connection: torrentClients.api.connection,
		...(downloadApi
			? {
					downloads: {
						settings: downloadApi.settings,
						saveDestination: downloadApi.saveDestination,
						validate: downloadApi.validate,
						summary: downloadApi.summary,
						activity: downloadApi.activity,
						retry: downloadApi.retry,
					},
				}
			: {}),
		subscriptions: {
			profiles: subscriptions.profiles.bind(subscriptions),
			search: subscriptions.search.bind(subscriptions),
			get: subscriptions.get.bind(subscriptions),
			save: ({ destinationRevision, connectionGeneration, ...input }) =>
				subscriptions.save({
					...input,
					target: { destinationRevision, connectionGeneration },
				}),
			setEnabled: subscriptions.setEnabled.bind(subscriptions),
			remove: subscriptions.remove.bind(subscriptions),
			refresh: subscriptions.refresh.bind(subscriptions),
		},
	};
	let closing: Promise<void> | undefined;
	return {
		api,
		registerHttp: (app: Parameters<typeof registerAcquisitionHttp>[0]) =>
			registerAcquisitionHttp(
				app,
				api,
				sources.registerHttp,
				torrentClients.registerHttp,
			),
		close: () => {
			closing ??= (async () => {
				watching?.stop();
				await downloads?.close();
				const closingSubscriptions = subscriptions.close();
				await sources.runtime.close();
				await closingSubscriptions;
				await watching?.close();
				await torrentClients.runtime.close();
			})();
			return closing;
		},
	};
}
