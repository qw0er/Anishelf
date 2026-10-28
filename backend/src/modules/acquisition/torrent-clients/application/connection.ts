import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { TorrentConfiguration } from "../ports.js";
import {
	type TorrentClient,
	type TorrentConnection,
	type TorrentConnectionCheck,
	TorrentError,
} from "../public.js";

/** Owns one active client and fences operations across provider/account changes. */
export class TorrentClientConnection implements TorrentConnection {
	private client: TorrentClient | undefined;
	private checking = false;
	private closed = false;
	constructor(
		private readonly configuration: TorrentConfiguration,
		private readonly logger: Logger,
	) {}

	connectionGeneration(): string {
		return this.configuration.settings().generation;
	}
	private assertGeneration(generation: string) {
		if (this.closed)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Torrent client connection is stopping.",
			);
		if (generation !== this.connectionGeneration())
			throw new DomainError(
				"ACQUISITION_CONFLICT",
				"The torrent client configuration changed.",
			);
	}
	async invalidate() {
		const client = this.client;
		this.client = undefined;
		await client?.close();
		this.logger.debug(
			{
				event: "torrent_clients.connection_invalidated",
				generation: this.connectionGeneration(),
			},
			"Torrent client connection invalidated.",
		);
	}
	async withClient<T>(
		generation: string,
		operation: (client: TorrentClient) => Promise<T>,
	): Promise<T> {
		this.assertGeneration(generation);
		if (this.configuration.settings().state !== "configured")
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Configure an available torrent client first.",
			);
		this.client ??= this.configuration.createClient();
		const result = await operation(this.client);
		this.assertGeneration(generation);
		return result;
	}
	async activeHashes(signal: AbortSignal): Promise<string[] | null> {
		const status = this.configuration.settings();
		this.assertGeneration(status.generation);
		if (status.state === "unavailable")
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Saved torrent client configuration could not be loaded.",
			);
		if (status.state === "unconfigured") return null;
		return this.withClient(status.generation, async (client) =>
			(await client.tasks(signal)).flatMap((task) => [
				task.hash,
				...(task.v1Hash ? [task.v1Hash] : []),
				...(task.v2Hash ? [task.v2Hash] : []),
			]),
		);
	}
	async probe(generation: string): Promise<TorrentConnectionCheck> {
		this.assertGeneration(generation);
		if (this.checking)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"A torrent client connection test is already running.",
			);
		if (this.configuration.settings().state !== "configured")
			throw new DomainError(
				"INVALID_REQUEST",
				"Save torrent client credentials first.",
			);
		this.checking = true;
		try {
			const result = await this.withClient(generation, (client) =>
				client.probe(),
			);
			this.assertGeneration(generation);
			return {
				generation,
				available: true,
				checkedAt: Date.now(),
				version: result.version,
				code: null,
			};
		} catch (error) {
			this.assertGeneration(generation);
			if (!(error instanceof TorrentError))
				throw new DomainError(
					"ACQUISITION_UNAVAILABLE",
					"Torrent client connection test failed.",
				);
			return {
				generation,
				available: false,
				checkedAt: Date.now(),
				version: null,
				code: error.code,
			};
		} finally {
			this.checking = false;
		}
	}
	async close() {
		this.closed = true;
		await this.invalidate();
		this.logger.debug(
			{ event: "torrent_clients.stopped" },
			"Torrent client connection stopped.",
		);
	}
}
