import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import { readBundledConnection } from "./configuration.js";
import type {
	ConnectionInput,
	ConnectionSettings,
	SavedConnection,
} from "./model.js";
import {
	type QbittorrentApi,
	QbittorrentError,
	type QbittorrentOptions,
} from "./model.js";
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
	private checking = false;
	private writes: Promise<unknown> = Promise.resolve();
	private client: QbittorrentApi | undefined;
	private readonly suggestedApiUrl: string | null;
	constructor(
		private readonly store: ConnectionStore,
		private readonly createClient: (
			options: QbittorrentOptions,
		) => QbittorrentApi,
		private readonly logger: Logger,
		suggestedApiUrl?: string,
		private readonly bundledConnectionFile?: string,
	) {
		this.suggestedApiUrl = suggestedApiUrl ? normalize(suggestedApiUrl) : null;
	}
	async initialize() {
		try {
			let saved = await this.store.read();
			let imported = false;
			if (!saved && this.bundledConnectionFile) {
				saved = await readBundledConnection(this.bundledConnectionFile);
				imported = saved !== null;
			}
			if (saved?.connection) {
				saved.connection.url = normalize(saved.connection.url);
				if (
					!validCredential(saved.connection.username, 256) ||
					!validCredential(saved.connection.password, 4096)
				)
					throw new Error();
			}
			if (saved && imported) {
				await this.store.write(saved);
				this.logger.info(
					{ event: "qbittorrent.bundled_initialized" },
					"Bundled qBittorrent credentials initialized.",
				);
			}
			if (saved) this.saved = saved;
		} catch {
			this.unreadable = true;
			this.logger.warn(
				{ event: "qbittorrent.configuration_unavailable" },
				"Saved qBittorrent credentials could not be loaded.",
			);
		}
		if (this.suggestedApiUrl && !this.saved.connection && !this.unreadable)
			this.logger.info(
				{ event: "qbittorrent.endpoint_suggested" },
				"Deployment API address is available; save account credentials in Settings to connect.",
			);
	}
	settings(): ConnectionSettings {
		return {
			generation: this.saved.generation,
			state: this.unreadable
				? "unavailable"
				: this.saved.connection
					? "configured"
					: "unconfigured",
			url: this.saved.connection?.url ?? this.suggestedApiUrl,
			username: this.saved.connection?.username ?? "",
			passwordConfigured: Boolean(this.saved.connection),
			...(this.saved.bundled ? { bundled: true } : {}),
		};
	}
	async initializeBundled() {
		if (!this.bundledConnectionFile || this.saved.connection || this.unreadable)
			return;
		await this.enqueue(() => this.initialize());
	}
	credentials(generation: string) {
		this.assertGeneration(generation);
		if (!this.saved.bundled || !this.saved.connection || this.unreadable)
			throw new DomainError(
				"INVALID_REQUEST",
				"No bundled WebUI credentials are available.",
			);
		this.logger.info(
			{ event: "qbittorrent.credentials_viewed" },
			"Bundled WebUI credentials requested.",
		);
		return {
			username: this.saved.connection.username,
			password: this.saved.connection.password,
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
				...(this.saved.bundled && previous?.url === url
					? { bundled: true }
					: {}),
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
		if (this.checking)
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
			this.checking = false;
		}
	}
	private async closeClients() {
		const client = this.client;
		this.client = undefined;
		await client?.close();
	}
	async withClient<T>(
		generation: string,
		operation: (client: QbittorrentApi) => Promise<T>,
	): Promise<T> {
		this.assertGeneration(generation);
		if (!this.saved.connection || this.unreadable)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Configure qBittorrent first.",
			);
		this.client ??= this.createClient({
			...this.saved.connection,
			logger: this.logger,
		});
		const result = await operation(this.client);
		this.assertGeneration(generation);
		return result;
	}
	async activeHashes(signal: AbortSignal): Promise<string[] | null> {
		if (this.unreadable)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Saved qBittorrent credentials could not be loaded.",
			);
		if (!this.saved.connection) return null;
		return this.withClient(this.saved.generation, async (client) =>
			(await client.tasks(signal)).flatMap((task) => [
				task.hash,
				...(task.v1Hash ? [task.v1Hash] : []),
				...(task.v2Hash ? [task.v2Hash] : []),
			]),
		);
	}
	async close() {
		this.closed = true;
		await this.writes;
		await this.closeClients();
	}
}
