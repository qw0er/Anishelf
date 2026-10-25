import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { SourceQuery } from "../domain/binding.js";
import type { ReleaseDownload } from "../domain/download.js";
import { SourceError } from "../domain/model.js";
import type { JackettClient } from "./client.js";
import type { JackettConfiguration, JackettUpdate } from "./model.js";
import { indexerId, jackettUrl, titleQueries } from "./validation.js";

type Store = {
	read(): Promise<JackettConfiguration | null>;
	write(value: JackettConfiguration): Promise<void>;
};
export class JackettConnection {
	private saved: JackettConfiguration = {
		version: 1,
		generation: randomUUID(),
		connection: null,
	};
	private unreadable = false;
	private hasSavedConfiguration = false;
	private closed = false;
	private client: JackettClient | undefined;
	private writes: Promise<unknown> = Promise.resolve();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly shutdown = new AbortController();
	private generationAbort = new AbortController();
	constructor(
		private readonly store: Store,
		private readonly createClient: (
			configuration: JackettConfiguration,
		) => JackettClient,
		private readonly logger: Logger,
	) {}
	async initialize() {
		try {
			const value = await this.store.read();
			if (value) {
				this.hasSavedConfiguration = true;
				if (value.connection) this.validate(value.connection);
				this.saved = value;
			}
		} catch {
			this.unreadable = true;
			this.logger.warn(
				{ event: "acquisition.jackett_configuration_unavailable" },
				"Jackett configuration could not be loaded.",
			);
		}
	}
	settings() {
		const connection = this.saved.connection;
		return {
			generation: this.saved.generation,
			url: connection?.url ?? null,
			managementUrl: connection?.managementUrl ?? null,
			origin: connection?.origin ?? null,
			indexers: [...(connection?.indexers ?? [])],
			hasApiKey: Boolean(connection?.apiKey),
			ready:
				!this.unreadable &&
				Boolean(connection?.apiKey && connection.indexers.length),
			error: this.unreadable ? "configuration_unavailable" : null,
		};
	}
	private validate(
		connection: NonNullable<JackettConfiguration["connection"]>,
	) {
		connection.url = jackettUrl(connection.url);
		if (connection.managementUrl)
			connection.managementUrl = jackettUrl(connection.managementUrl);
		if (
			!["bundled", "external"].includes(connection.origin) ||
			connection.indexers.length > 32 ||
			new Set(connection.indexers).size !== connection.indexers.length
		)
			throw new SourceError("invalid_configuration");
		connection.indexers.forEach(indexerId);
		if (
			connection.apiKey !== null &&
			(!connection.apiKey ||
				connection.apiKey.length > 4096 ||
				/[\r\n\0]/.test(connection.apiKey))
		)
			throw new SourceError("invalid_configuration");
	}
	private check(generation: string) {
		if (this.closed || this.unreadable)
			throw new SourceError("source_unavailable");
		if (generation !== this.saved.generation)
			throw new SourceError("source_conflict");
	}
	current(generation: string) {
		return (
			!this.closed && !this.unreadable && generation === this.saved.generation
		);
	}
	matchesBundled(url: string, apiKey: string) {
		return (
			!this.closed &&
			!this.unreadable &&
			this.saved.connection?.origin === "bundled" &&
			this.saved.connection.url === url &&
			this.saved.connection.apiKey === apiKey
		);
	}
	signal(generation: string): AbortSignal {
		this.check(generation);
		return this.generationAbort.signal;
	}

	save(input: JackettUpdate) {
		return this.mutate(input.generation, () => {
			if (
				this.saved.connection?.apiKey &&
				jackettUrl(input.url) !== this.saved.connection.url &&
				input.apiKey === undefined
			)
				throw new SourceError("invalid_configuration");
			const connection = {
				url: input.url,
				managementUrl:
					input.managementUrl === undefined
						? (this.saved.connection?.managementUrl ?? null)
						: input.managementUrl,
				origin: input.origin,
				indexers: [...input.indexers],
				apiKey:
					input.apiKey === undefined
						? (this.saved.connection?.apiKey ?? null)
						: input.apiKey,
			};
			this.validate(connection);
			return connection;
		});
	}
	async importBundled(value: JackettConfiguration, generation?: string) {
		if (value.connection?.origin !== "bundled")
			throw new SourceError("invalid_configuration");
		if (
			generation === undefined &&
			(this.hasSavedConfiguration || this.unreadable || this.closed)
		)
			return;
		try {
			await this.mutate(generation ?? this.saved.generation, () => {
				if (generation === undefined && this.hasSavedConfiguration)
					throw new SourceError("source_conflict");
				const connection = structuredClone(value.connection);
				if (!connection) throw new SourceError("source_unconfigured");
				this.validate(connection);
				return connection;
			});
		} catch (error) {
			if (
				generation === undefined &&
				error instanceof SourceError &&
				error.code === "source_conflict"
			)
				return;
			throw error;
		}
	}

	clear(generation: string) {
		return this.mutate(generation, () => null);
	}
	private mutate(
		generation: string,
		change: () => JackettConfiguration["connection"],
	) {
		const task = this.writes.then(async () => {
			this.check(generation);
			const value: JackettConfiguration = {
				version: 1,
				generation: randomUUID(),
				connection: change(),
			};
			await this.store.write(value);
			const old = this.client;
			this.generationAbort.abort();
			this.generationAbort = new AbortController();
			this.saved = value;
			this.hasSavedConfiguration = true;
			this.client = undefined;
			await old?.close();
			this.logger.info(
				{
					event: "acquisition.jackett_connection_saved",
					indexerCount: value.connection?.indexers.length ?? 0,
					generation: value.generation,
					origin: value.connection?.origin ?? null,
				},
				"Jackett configuration saved; earlier source references are invalid.",
			);
			return this.settings();
		});
		this.writes = task.catch(() => {});
		return task;
	}
	plan(input: SourceQuery): SourceQuery {
		this.check(input.generation);
		if (!this.saved.connection?.apiKey)
			throw new SourceError("source_unconfigured");
		if (!this.saved.connection.indexers.includes(indexerId(input.indexerId)))
			throw new SourceError("source_disabled");
		return Object.freeze({
			...input,
			titles: Object.freeze(titleQueries(input.titles)),
		});
	}
	private run<T>(
		generation: string,
		operation: (client: JackettClient, signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		const task = (async () => {
			this.check(generation);
			if (!this.saved.connection?.apiKey)
				throw new SourceError("source_unconfigured");
			this.client ??= this.createClient(this.saved);
			try {
				const result = await operation(
					this.client,
					AbortSignal.any([this.shutdown.signal, this.generationAbort.signal]),
				);
				this.check(generation);
				return result;
			} catch (error) {
				this.check(generation);
				throw error;
			}
		})();
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => {});
		return task;
	}
	indexers(generation: string) {
		return this.run(generation, (client, signal) => client.indexers(signal));
	}
	async probe(generation: string, id: string) {
		const plan = this.plan({ generation, indexerId: id, titles: ["probe"] });
		return this.run(generation, async (client, signal) => {
			const capabilities = await client.capabilities(plan.indexerId, signal);
			this.logger.info(
				{
					event: "acquisition.source_probe",
					indexerId: id,
					generation,
					search: capabilities.search,
				},
				"Indexer capabilities received; upstream search remains untested.",
			);
			return {
				generation,
				indexerId: id,
				capabilities,
				searchVerified: false as const,
			};
		});
	}
	async search(
		input: SourceQuery,
		accept?: (
			entries: readonly import("../domain/model.js").SourceEntry[],
		) => boolean,
	) {
		const plan = this.plan(input),
			started = Date.now();
		try {
			const result = await this.run(plan.generation, (client, signal) =>
				client.search(plan, signal, accept),
			);
			this.logger.info(
				{
					event: "acquisition.search_completed",
					indexerId: plan.indexerId,
					generation: plan.generation,
					count: result.entries.length,
					coverage: result.coverage,
					durationMs: Date.now() - started,
				},
				"Source search completed.",
			);
			return result;
		} catch (error) {
			this.logger.warn(
				{
					event: "acquisition.search_failed",
					indexerId: plan.indexerId,
					generation: plan.generation,
					code: error instanceof SourceError ? error.code : "upstream_failure",
				},
				"Source search failed.",
			);
			throw error;
		}
	}
	readTorrent(
		generation: string,
		descriptor: ReleaseDownload,
		signal?: AbortSignal,
	) {
		if (descriptor.kind === "jackett-torrent") {
			if (descriptor.generation !== generation)
				throw new SourceError("source_conflict");
			this.plan({
				generation,
				indexerId: descriptor.indexerId,
				titles: ["download"],
			});
		}
		return this.run(generation, (client, abort) =>
			client.readTorrent(
				descriptor,
				signal ? AbortSignal.any([signal, abort]) : abort,
			),
		);
	}
	async close() {
		this.closed = true;
		this.shutdown.abort();
		await this.writes;
		await this.client?.close();
		await Promise.allSettled(this.pending);
	}
}
