import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import { SourceError } from "../domain/model.js";
import type { JackettClient } from "./client.js";
import type {
	JackettConfiguration,
	JackettPlan,
	JackettUpdate,
	ReleaseDownload,
} from "./model.js";
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
	save(input: JackettUpdate) {
		return this.mutate(input.generation, () => {
			const connection = {
				url: input.url,
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
			this.client = undefined;
			await old?.close();
			this.logger.info(
				{
					event: "acquisition.jackett_connection_saved",
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
	plan(input: JackettPlan): JackettPlan {
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
	async search(input: JackettPlan) {
		const plan = this.plan(input),
			started = Date.now();
		try {
			const result = await this.run(plan.generation, (client, signal) =>
				client.search(plan, signal),
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

/** Convert safe source failures at the authenticated API boundary. */
export async function sourceCommand<T>(
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof SourceError)
			throw new DomainError(
				error.code === "source_conflict"
					? "ACQUISITION_CONFLICT"
					: error.code.startsWith("invalid_")
						? "INVALID_REQUEST"
						: "ACQUISITION_UNAVAILABLE",
				error.code,
			);
		throw error;
	}
}
