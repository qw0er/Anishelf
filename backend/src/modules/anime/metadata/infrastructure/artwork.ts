import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import type { Logger } from "pino";
import { abortable } from "../domain/async.js";
import {
	type ArtworkAsset,
	type ArtworkStatus,
	MetadataError,
	type ReadOptions,
} from "../domain/model.js";
import { metadataPolicy as policy } from "../policy.js";
import type { ArtworkRecord, MetadataStore } from "../ports.js";
import { boundedBody } from "./transport.js";

const validId = /^[a-f0-9]{64}$/;
/** Parallel provider downloads; a poster wall must not serialize behind one slow host. */
const maximumConcurrentDownloads = 4;
/** Only provider-owned image hosts; never an arbitrary URL or filesystem proxy. */
export class MetadataArtworkCache {
	private readonly lifetime = new AbortController();
	private readonly pending = new Map<string, Promise<ArtworkStatus>>();
	private activeDownloads = 0;
	private readonly waitingSlots: (() => void)[] = [];
	private readonly directory: string;
	constructor(
		private readonly options: {
			dataDir: string;
			hosts: readonly string[];
			store: MetadataStore;
			logger?: Logger;
			fetch?: typeof fetch;
			budgetBytes?: number;
			maximumBytes?: number;
		},
	) {
		this.directory = join(options.dataDir, "cache", "metadata-artwork");
	}
	async initialize(): Promise<void> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const known = new Set<string>();
		for (const asset of this.options.store.artworks()) {
			try {
				if (!validId.test(asset.id))
					throw new Error("Invalid artwork identity.");
				const info = await stat(join(this.directory, asset.id));
				if (!info.isFile() || info.size !== asset.sizeBytes)
					throw new Error("Missing artwork.");
				known.add(asset.id);
			} catch {
				this.options.store.removeArtwork(asset.id);
			}
		}
		for (const name of await readdir(this.directory))
			if (!known.has(name) && (validId.test(name) || name.endsWith(".pending")))
				await rm(join(this.directory, name), { force: true });
		await this.prune();
	}
	private url(value: string): URL {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			!this.options.hosts.includes(url.hostname) ||
			url.port ||
			url.username ||
			url.password
		)
			throw new MetadataError({
				code: "invalid-response",
				message: "Provider artwork URL is not allowed.",
				retryAt: null,
			});
		return url;
	}
	async get(
		key: string,
		url: string | null,
		options: ReadOptions,
	): Promise<ArtworkStatus> {
		this.lifetime.signal.throwIfAborted();
		options.signal?.throwIfAborted();
		if (!url) return { id: null, status: "missing", failure: null };
		const records = this.options.store.artworks();
		const existing = records
			.filter((record) => record.key === key && record.url === url)
			.at(-1);
		const fallback = records.filter((record) => record.key === key).at(-1);
		const usable = async (
			asset: ArtworkRecord | undefined,
		): Promise<ArtworkStatus | null> => {
			if (!asset) return null;
			try {
				await this.read(asset.id);
				return { id: asset.id, status: "ready", failure: null };
			} catch {
				return null;
			}
		};
		const cached = await usable(existing);
		if (cached && !options.refresh) return cached;
		if (options.cachedOnly)
			return (
				cached ??
				(await usable(fallback)) ?? {
					id: null,
					status: "missing",
					failure: null,
				}
			);
		const pendingKey = JSON.stringify([key, url]);
		let pending = this.pending.get(pendingKey);
		if (!pending) {
			if (this.pending.size >= 16) {
				// Cached bytes stay available even when the refresh queue is full.
				if (cached) return cached;
				return {
					id: null,
					status: "failed",
					failure: {
						code: "busy",
						message: "Artwork queue is full. Retry shortly.",
						retryAt: null,
					},
				};
			}
			pending = (async () => {
				await this.slot();
				try {
					const signal = AbortSignal.any([
						this.lifetime.signal,
						AbortSignal.timeout(policy.requestTimeoutMs),
					]);
					const started = performance.now();
					const requestId = createHash("sha256")
						.update(pendingKey)
						.digest("hex");
					const temporary = join(this.directory, `${randomUUID()}.pending`);
					try {
						let target = this.url(url),
							response: Response | undefined;
						for (let redirects = 0; redirects <= 3; redirects++) {
							response = await abortable(
								(this.options.fetch ?? fetch)(target, {
									redirect: "manual",
									signal,
								}),
								signal,
							);
							if (![301, 302, 303, 307, 308].includes(response.status)) break;
							await response.body?.cancel();
							const location = response.headers.get("location");
							if (!location || redirects === 3)
								throw new Error("Invalid artwork redirect.");
							target = this.url(new URL(location, target).href);
						}
						if (!response?.ok) throw new Error("Artwork request failed.");
						const bytes = await boundedBody(
							response,
							this.options.maximumBytes ?? policy.artworkMaximumBytes,
							signal,
						);
						const type = await fileTypeFromBuffer(bytes);
						if (
							!type ||
							![
								"image/jpeg",
								"image/png",
								"image/webp",
								"image/avif",
								"image/gif",
							].includes(type.mime)
						)
							throw new MetadataError({
								code: "invalid-response",
								message: "Provider artwork is not a supported image.",
								retryAt: null,
							});
						signal.throwIfAborted();
						if (
							bytes.byteLength >
							(this.options.budgetBytes ?? policy.artworkBudgetBytes)
						)
							throw new Error("Artwork cache budget exceeded.");
						const id = createHash("sha256")
							.update(JSON.stringify([key, url]))
							.update(bytes)
							.digest("hex");
						await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
						await rename(temporary, join(this.directory, id));
						this.options.store.saveArtwork({
							id,
							key,
							url,
							mimeType: type.mime,
							sizeBytes: bytes.byteLength,
							accessedAt: Date.now(),
						});
						await this.prune(id);
						this.options.logger?.debug(
							{
								event: "metadata.artwork_cached",
								requestId,
								artworkId: id,
								sizeBytes: bytes.byteLength,
								elapsedMs: Math.round(performance.now() - started),
							},
							"Provider artwork cached.",
						);
						return { id, status: "ready" as const, failure: null };
					} catch (cause) {
						this.lifetime.signal.throwIfAborted();
						const failure =
							cause instanceof MetadataError
								? cause.failure
								: {
										code: "unavailable" as const,
										message: "Artwork could not be cached. Retry shortly.",
										retryAt: null,
									};
						const retained = await usable(existing ?? fallback);
						this.options.logger?.warn(
							{
								event: "metadata.artwork_failed",
								requestId,
								code: failure.code,
								retained: Boolean(retained),
								elapsedMs: Math.round(performance.now() - started),
							},
							"Artwork caching failed; usable cached artwork is retained.",
						);
						return retained
							? { ...retained, failure }
							: { id: null, status: "failed" as const, failure };
					} finally {
						await rm(temporary, { force: true });
					}
				} finally {
					this.release();
				}
			})();
			this.pending.set(pendingKey, pending);
			void pending
				.finally(() => this.pending.delete(pendingKey))
				.catch(() => {});
		}
		if (cached) {
			// A refresh never keeps the browser waiting for the provider.
			this.options.logger?.debug(
				{
					event: "metadata.artwork_refresh_started",
					artworkId: cached.id,
				},
				"Refreshing cached artwork in the background.",
			);
			void pending.catch(() => {});
			return cached;
		}
		return abortable(pending, options.signal ?? this.lifetime.signal);
	}
	private async slot(): Promise<void> {
		if (this.activeDownloads < maximumConcurrentDownloads) {
			this.activeDownloads++;
			return;
		}
		await new Promise<void>((resolve) => this.waitingSlots.push(resolve));
	}
	private release(): void {
		const waiting = this.waitingSlots.shift();
		if (waiting) waiting();
		else this.activeDownloads--;
	}
	/** Newest record for a key without reading bytes or contacting the provider. */
	async cached(key: string): Promise<string | null> {
		this.lifetime.signal.throwIfAborted();
		// Records are reconciled with the disk at startup and on read/evict failures.
		return this.options.store.artworkByKey(key)?.id ?? null;
	}
	async read(id: string): Promise<ArtworkAsset> {
		this.lifetime.signal.throwIfAborted();
		if (!validId.test(id))
			throw new MetadataError({
				code: "not-found",
				message: "Artwork was not found.",
				retryAt: null,
			});
		const asset = this.options.store.artwork(id);
		if (!asset)
			throw new MetadataError({
				code: "not-found",
				message: "Artwork was not found.",
				retryAt: null,
			});
		try {
			const bytes = await readFile(join(this.directory, id));
			if (bytes.length !== asset.sizeBytes)
				throw new Error("Artwork size changed.");
			this.options.store.saveArtwork({ ...asset, accessedAt: Date.now() });
			return { id, bytes, mimeType: asset.mimeType };
		} catch (cause) {
			this.options.store.removeArtwork(id);
			throw new MetadataError(
				{
					code: "not-found",
					message:
						"Artwork is no longer cached. Reload the work detail to retry.",
					retryAt: null,
				},
				{ cause },
			);
		}
	}
	private async prune(protect?: string): Promise<void> {
		const assets = this.options.store.artworks();
		let size = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
		for (const asset of assets) {
			if (size <= (this.options.budgetBytes ?? policy.artworkBudgetBytes))
				break;
			if (asset.id === protect) continue;
			await rm(join(this.directory, asset.id), { force: true });
			this.options.store.removeArtwork(asset.id);
			this.options.logger?.debug(
				{
					event: "metadata.artwork_evicted",
					artworkId: asset.id,
					sizeBytes: asset.sizeBytes,
				},
				"Artwork evicted to enforce the cache budget.",
			);
			size -= asset.sizeBytes;
		}
	}
	async close(): Promise<void> {
		this.lifetime.abort();
		await Promise.allSettled([...this.pending.values()]);
	}
}
