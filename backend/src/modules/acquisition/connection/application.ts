import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import {
	type QbittorrentApi,
	QbittorrentError,
	type QbittorrentOptions,
} from "../qbittorrent/public.js";
import type {
	ConnectionInput,
	ConnectionSettings,
	SavedConnection,
} from "./domain/model.js";
import type { ConnectionStore } from "./ports.js";
import type { QbittorrentConnectionApi } from "./public.js";

function normalize(url: string): string {
	try {
		if (url.length > 2048 || /[\s\\]/.test(url)) throw new Error();
		const parsed = new URL(url);
		if (
			!["http:", "https:"].includes(parsed.protocol) ||
			parsed.username ||
			parsed.password ||
			parsed.search ||
			parsed.hash
		)
			throw new Error();
		parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;
		if (parsed.href.length > 2048) throw new Error();
		return parsed.href;
	} catch {
		throw new DomainError(
			"INVALID_REQUEST",
			"Enter a valid qBittorrent API URL.",
		);
	}
}
function validCredential(value: string, maximum: number): boolean {
	return value.length > 0 && value.length <= maximum && !/[\r\n\0]/.test(value);
}

export class QbittorrentConnection implements QbittorrentConnectionApi {
	private saved: SavedConnection = {
		version: 1,
		generation: randomUUID(),
		connection: null,
	};
	private unreadable = false;
	private closed = false;
	private writes: Promise<unknown> = Promise.resolve();
	private readonly clients = new Set<QbittorrentApi>();
	constructor(
		private readonly store: ConnectionStore,
		private readonly createClient: (
			options: QbittorrentOptions,
		) => QbittorrentApi,
		private readonly logger: Logger,
	) {}
	async initialize() {
		try {
			const saved = await this.store.read();
			if (saved?.connection) {
				normalize(saved.connection.url);
				if (
					!validCredential(saved.connection.username, 256) ||
					!validCredential(saved.connection.password, 4096)
				)
					throw new Error();
			}
			if (saved) this.saved = saved;
		} catch {
			this.unreadable = true;
			this.logger.warn(
				{ event: "qbittorrent.configuration_unavailable" },
				"Saved qBittorrent credentials could not be loaded.",
			);
		}
	}
	settings(): ConnectionSettings {
		return {
			generation: this.saved.generation,
			state: this.unreadable
				? "unavailable"
				: this.saved.connection
					? "configured"
					: "unconfigured",
			url: this.saved.connection?.url ?? null,
			username: this.saved.connection?.username ?? "",
			passwordConfigured: Boolean(this.saved.connection),
		};
	}
	private assertGeneration(generation: string) {
		if (this.closed)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"qBittorrent connection is stopping.",
			);
		if (generation !== this.saved.generation)
			throw new DomainError(
				"ACQUISITION_CONFLICT",
				"The qBittorrent configuration changed.",
			);
	}
	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const pending = this.writes.then(operation);
		this.writes = pending.catch(() => {});
		return pending;
	}
	save(input: ConnectionInput) {
		return this.enqueue(async () => {
			this.assertGeneration(input.generation);
			const url = normalize(input.url.trim());
			const username = input.username.trim();
			const previous = this.saved.connection;
			const sameAccount =
				previous?.url === url && previous.username === username;
			const password = input.password || (sameAccount ? previous.password : "");
			if (!validCredential(username, 256) || !validCredential(password, 4096))
				throw new DomainError(
					"INVALID_REQUEST",
					"Enter the qBittorrent username and password.",
				);
			const next: SavedConnection = {
				version: 1,
				generation: randomUUID(),
				connection: { url, username, password },
			};
			await this.store.write(next);
			this.saved = next;
			this.unreadable = false;
			await this.closeClients();
			this.logger.info(
				{
					event: "qbittorrent.configuration_saved",
					generation: next.generation,
				},
				"qBittorrent API credentials saved.",
			);
			return this.settings();
		});
	}
	clear(generation: string) {
		return this.enqueue(async () => {
			this.assertGeneration(generation);
			const next: SavedConnection = {
				version: 1,
				generation: randomUUID(),
				connection: null,
			};
			await this.store.write(next);
			this.saved = next;
			this.unreadable = false;
			await this.closeClients();
			this.logger.info(
				{ event: "qbittorrent.configuration_cleared" },
				"qBittorrent API credentials removed.",
			);
			return this.settings();
		});
	}
	async probe(generation: string) {
		this.assertGeneration(generation);
		if (this.clients.size)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"A qBittorrent connection test is already running.",
			);
		const connection = this.saved.connection;
		if (!connection || this.unreadable)
			throw new DomainError(
				"INVALID_REQUEST",
				"Save qBittorrent credentials first.",
			);
		const client = this.createClient({ ...connection, logger: this.logger });
		this.clients.add(client);
		try {
			const result = await client.probe();
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
			if (!(error instanceof QbittorrentError))
				throw new DomainError(
					"ACQUISITION_UNAVAILABLE",
					"qBittorrent connection test failed.",
				);
			return {
				generation,
				available: false,
				checkedAt: Date.now(),
				version: null,
				code: error.code,
			};
		} finally {
			await client.close();
			this.clients.delete(client);
		}
	}
	private async closeClients() {
		await Promise.allSettled([...this.clients].map((client) => client.close()));
	}
	async activeHashes(signal: AbortSignal): Promise<string[] | null> {
		if (this.unreadable)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Saved qBittorrent credentials could not be loaded.",
			);
		if (!this.saved.connection) return null;
		const generation = this.saved.generation;
		this.assertGeneration(generation);
		const client = this.createClient({
			...this.saved.connection,
			logger: this.logger,
		});
		this.clients.add(client);
		try {
			const tasks = await client.tasks(signal);
			this.assertGeneration(generation);
			return tasks.flatMap((task) => [
				task.hash,
				...(task.v1Hash ? [task.v1Hash] : []),
				...(task.v2Hash ? [task.v2Hash] : []),
			]);
		} finally {
			await client.close();
			this.clients.delete(client);
		}
	}
	async close() {
		this.closed = true;
		await this.writes;
		await this.closeClients();
	}
}
