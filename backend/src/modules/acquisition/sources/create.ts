import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import { SourcesApplication } from "./application/application.js";
import type { SourceTorrentTransport } from "./application/content.js";
import { SourceError } from "./domain/model.js";
import { registerSourceRoutes } from "./http/routes.js";
import { SourceRequestGate } from "./infrastructure/request-gate.js";
import type { SourceLifecycleStore } from "./infrastructure/store.js";
import type { SourcesRuntime } from "./integration.js";
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
	const gate = new SourceRequestGate();
	const connection = new JackettConnection(
		new JackettConfigurationFile(options.dataDir),
		(configuration) => {
			const saved = configuration.connection;
			if (!saved?.apiKey) throw new SourceError("source_unconfigured");
			return new JackettClient(
				new JackettTransport(saved.url, saved.apiKey, configuration.generation),
				gate,
			);
		},
		options.logger,
	);
	await connection.initialize();
	const application = new SourcesApplication({
		store: options.store,
		rss: {
			gate,
			store: options.store,
			transport: options.transport ?? new RssTransport(),
			parse: parseRss,
			normalizeUrl: rssUrl,
			logger: options.logger,
		},
		jackett: connection,
		logger: options.logger,
		...(options.torrentTransport
			? { torrentTransport: options.torrentTransport }
			: {}),
		...(options.now ? { now: options.now } : {}),
		...(options.refreshIntervalMinutes
			? { refreshIntervalMinutes: options.refreshIntervalMinutes }
			: {}),
	});
	const runtime: SourcesRuntime = Object.freeze<SourcesRuntime>({
		start: (activeIds, poll) => application.start(activeIds, poll),
		close: () => application.close(),
	});
	const settings = () => {
		const { indexers, ...value } = connection.settings();
		return { ...value, providers: indexers };
	};
	const api: SourcesApi = Object.freeze<SourcesApi>({
		snapshot: (input) => command(() => application.snapshot(input)),
		fetch: (input) => application.fetch(input),
		readContent: (reference, signal) =>
			application.readDownload(reference, signal),
		isContentCurrent: (reference) => application.isDownloadCurrent(reference),
		connector: Object.freeze<SourceConnectorApi>({
			settings,
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
				const result = await application.refresh(
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
