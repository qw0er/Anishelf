import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import { SourcesApplication } from "./application/application.js";
import type { SourceTorrentTransport } from "./application/content.js";
import { SourceError, sourcePolicy } from "./domain/model.js";
import { registerSourceRoutes } from "./http/routes.js";
import { SourceCooldownFile } from "./infrastructure/cooldown-file.js";
import { SourceRequestGate } from "./infrastructure/request-gate.js";
import type { SourceLifecycleStore } from "./infrastructure/store.js";
import type { SourcesRuntime } from "./integration.js";
import { BundledJackett } from "./jackett/bundled.js";
import { JackettClient } from "./jackett/client.js";
import { JackettConfigurationFile } from "./jackett/configuration.js";
import { JackettConnection } from "./jackett/connection.js";
import { JackettTransport } from "./jackett/transport.js";
import type { SourceConnectorApi, SourcesApi } from "./public.js";
import { parseRss } from "./rss/parser.js";
import type { FeedTransport, SourceStore } from "./rss/ports.js";
import { RssTransport, rssUrl } from "./rss/transport.js";

export interface SourcesModuleOptions {
	dataDir: string;
	bundledConfigFile?: string;
	logger: Logger;
	store: SourceStore & SourceLifecycleStore;
	transport?: FeedTransport;
	torrentTransport?: SourceTorrentTransport;
	now?: () => number;
	refreshIntervalMinutes?: () => number | undefined;
}

function sourceError(error: unknown): never {
	if (!(error instanceof SourceError)) throw error;
	throw new DomainError(
		error.code === "source_conflict"
			? "ACQUISITION_CONFLICT"
			: error.code.startsWith("invalid_")
				? "INVALID_REQUEST"
				: "ACQUISITION_UNAVAILABLE",
		error.code === "invalid_source_url"
			? "Enter a public HTTP(S) feed URL."
			: error.code,
	);
}
function command<T>(operation: () => T): T {
	try {
		return operation();
	} catch (error) {
		return sourceError(error);
	}
}
async function asyncCommand<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return sourceError(error);
	}
}

/** The only production construction boundary; protocol implementations never escape. */
export async function createSourcesModule(options: SourcesModuleOptions) {
	const cooldownFile = new SourceCooldownFile(
		options.dataDir,
		options.logger,
		options.now ?? Date.now,
	);
	const cooldowns = await cooldownFile.read();
	const gate = new SourceRequestGate(
		sourcePolicy.requestIntervalMs,
		options.now ?? Date.now,
		{
			minimumIntervalForKey: (key) =>
				key.startsWith("jackett:") || key.startsWith("jackett-indexer:")
					? sourcePolicy.jackettRequestIntervalMs
					: sourcePolicy.requestIntervalMs,
			logger: options.logger,
			cooldowns,
			onCooldown: cooldownFile.set.bind(cooldownFile),
		},
	);
	const connection = new JackettConnection(
		new JackettConfigurationFile(options.dataDir),
		(configuration) => {
			const saved = configuration.connection;
			if (!saved?.apiKey) throw new SourceError("source_unconfigured");
			return new JackettClient(
				new JackettTransport(
					saved.url,
					saved.apiKey,
					configuration.generation,
					options.logger,
					undefined,
					undefined,
					gate,
				),
				gate,
				{ logger: options.logger },
			);
		},
		options.logger,
	);
	await connection.initialize();
	const bundled = new BundledJackett({
		...(options.bundledConfigFile ? { path: options.bundledConfigFile } : {}),
		dataDir: options.dataDir,
		gate,
		connection,
		logger: options.logger,
	});
	bundled.start();
	const application = new SourcesApplication({
		store: options.store,
		rss: {
			gate,
			store: options.store,
			transport: options.transport ?? new RssTransport(undefined, gate),
			parse: parseRss,
			normalizeUrl: rssUrl,
			logger: options.logger,
		},
		jackett: connection,
		logger: options.logger,
		torrentTransport:
			options.torrentTransport ?? new RssTransport(undefined, gate),
		...(options.now ? { now: options.now } : {}),
		...(options.refreshIntervalMinutes
			? { refreshIntervalMinutes: options.refreshIntervalMinutes }
			: {}),
	});
	const runtime: SourcesRuntime = Object.freeze<SourcesRuntime>({
		start: application.start.bind(application),
		close: async () => {
			await Promise.allSettled([bundled.close(), application.close()]);
			await cooldownFile.close();
		},
	});
	const settings = () => {
		const { indexers, ...value } = connection.settings();
		return {
			...value,
			providers: indexers,
			bundledAvailable: bundled.available,
			...(options.bundledConfigFile ? { bundledSetup: bundled.setup } : {}),
		};
	};
	const api: SourcesApi = Object.freeze<SourcesApi>({
		snapshot: (input) => command(() => application.snapshot(input)),
		fetch: application.fetch.bind(application),
		readContent: application.readDownload.bind(application),
		isContentCurrent: application.isDownloadCurrent.bind(application),
		connector: Object.freeze<SourceConnectorApi>({
			settings,
			useBundled: (generation, initializeSite) =>
				asyncCommand(async () => {
					await bundled.activate(generation, initializeSite);
					return settings();
				}),
			save: (input) =>
				asyncCommand(async () => {
					const { providers, ...value } = input;
					await connection.save({ ...value, indexers: providers });
					return settings();
				}),
			clear: (generation) =>
				asyncCommand(async () => {
					await connection.clear(generation);
					return settings();
				}),
			providers: (generation) =>
				asyncCommand(() => connection.indexers(generation)),
			probe: (generation, providerId) =>
				asyncCommand(async () => {
					const result = await connection.probe(generation, providerId);
					return {
						generation: result.generation,
						providerId: result.indexerId,
						searchSupported: result.capabilities.search,
						searchVerified: false as const,
					};
				}),
		}),
		test: (input) =>
			asyncCommand(async () => {
				const result = await application.collect(
					typeof input === "string"
						? application.reference(input)
						: application.referenceFor(input),
				);
				if (!application.isCurrent(result))
					throw new SourceError("source_conflict");
				return {
					source: result.label,
					outcome: result.entries.length
						? ("matches" as const)
						: ("no_match" as const),
					...(result.coverage ? { coverage: result.coverage } : {}),
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
	});
	return {
		api,
		runtime,
		registerHttp: (app: Parameters<typeof registerSourceRoutes>[0]) =>
			registerSourceRoutes(app, api),
	};
}
