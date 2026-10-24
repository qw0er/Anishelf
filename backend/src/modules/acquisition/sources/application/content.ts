import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { ReleaseDownload } from "../domain/download.js";
import type { DownloadContent, ReleaseEvidence } from "../domain/evidence.js";
import {
	type SourceEntry,
	SourceError,
	type SourceRecord,
} from "../domain/model.js";
import type {
	SourceDownload,
	SourceLifecycleStore,
} from "../infrastructure/store.js";
import type { JackettConnection } from "../jackett/connection.js";

export interface SourceTorrentTransport {
	read(url: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
	close(): Promise<void>;
}
interface PendingContent {
	controller: AbortController;
	promise: Promise<DownloadContent>;
	readers: number;
	settled: boolean;
}
interface CachedContent {
	value: DownloadContent;
	expiresAt: number;
	size: number;
}
const contentCacheTtlMs = 10 * 60_000;
const contentCacheMaximumBytes = 32 * 1024 * 1024;
const contentCacheMaximumEntries = 64;
const contentMaximumPending = 32;

/** Private durable locator ownership; consumers retain only opaque IDs. */
export class SourceContent {
	private readonly pending = new Set<Promise<DownloadContent>>();
	private readonly inFlight = new Map<string, PendingContent>();
	private readonly cache = new Map<string, CachedContent>();
	private cachedBytes = 0;
	constructor(
		private readonly store: SourceLifecycleStore,
		private readonly transport: SourceTorrentTransport,
		private readonly jackett: JackettConnection | undefined,
		private readonly signal: AbortSignal,
		private readonly logger: Logger,
		private readonly record?: (id: string) => SourceRecord | null,
		private readonly now = Date.now,
	) {}
	private locator(sourceId: string, entry: SourceEntry): SourceDownload | null {
		const descriptor: ReleaseDownload | null =
			entry.download ??
			(entry.downloadUrl
				? entry.downloadUrl.startsWith("magnet:?")
					? { kind: "magnet", uri: entry.downloadUrl }
					: { kind: "public-torrent", url: entry.downloadUrl }
				: null);
		if (!descriptor) return null;
		const generation = entry.generation ?? null;
		return {
			id: `${sourceId}.${createHash("sha256")
				.update(JSON.stringify([sourceId, generation, descriptor]))
				.digest("hex")}`,
			sourceId,
			generation,
			descriptor,
		};
	}
	project(sourceId: string, entry: SourceEntry): Readonly<ReleaseEvidence> {
		return Object.freeze({
			id: entry.id,
			observationId: entry.observationId,
			title: entry.title,
			publishedAt: entry.publishedAt,
			hash: entry.hash,
			size: entry.size ?? null,
			peers: entry.peers ?? null,
			seeders: entry.seeders ?? null,
			seedersObservedAt: entry.seedersObservedAt ?? null,
			download: this.locator(sourceId, entry)?.id ?? null,
		});
	}
	publish(record: SourceRecord, generation: string | null) {
		for (const entry of record.entries) {
			const locator = this.locator(
				record.id,
				generation ? { ...entry, generation } : entry,
			);
			if (locator) this.store.saveDownload(locator);
		}
	}
	private lookup(reference: string): SourceDownload | null {
		const saved = this.store.download(reference);
		if (saved) return saved;
		const separator = reference.indexOf("..");
		if (separator < 1) return null;
		const sourceId = reference.slice(0, separator);
		const record = this.record?.(sourceId);
		for (const entry of record?.entries ?? []) {
			const locator = this.locator(sourceId, entry);
			if (locator?.id === reference) return locator;
		}
		return null;
	}
	isCurrent(reference: string) {
		if (this.signal.aborted) return false;
		const saved = this.lookup(reference);
		return (
			!this.signal.aborted &&
			Boolean(
				saved && (!saved.generation || this.jackett?.current(saved.generation)),
			)
		);
	}
	async read(reference: string, signal: AbortSignal): Promise<DownloadContent> {
		if (this.signal.aborted) throw new SourceError("source_unavailable");
		if (signal.aborted) throw new SourceError("request_cancelled");
		const saved = this.lookup(reference);
		if (!saved) throw new SourceError("download_missing");
		if (!this.isCurrent(reference)) throw new SourceError("source_conflict");
		const key = createHash("sha256")
			.update(JSON.stringify([saved.generation, saved.descriptor]))
			.digest("hex");
		const cached = this.cached(key);
		if (cached) {
			this.logger.debug(
				{
					event: "acquisition.source_download_cache_hit",
					sourceId: saved.sourceId,
				},
				"Source download content reused.",
			);
			return this.copy(cached);
		}
		let entry = this.inFlight.get(key);
		if (!entry) {
			if (this.pending.size >= contentMaximumPending)
				throw new SourceError("source_busy");
			const controller = new AbortController();
			const combined = AbortSignal.any([controller.signal, this.signal]);
			entry = {
				controller,
				promise: this.readContent(saved, combined),
				readers: 0,
				settled: false,
			};
			const created = entry;
			this.inFlight.set(key, created);
			this.pending.add(created.promise);
			void created.promise
				.then((content) => {
					if (!combined.aborted && this.isCurrent(reference))
						this.remember(key, content);
				})
				.finally(() => {
					created.settled = true;
					this.pending.delete(created.promise);
					if (this.inFlight.get(key) === created) this.inFlight.delete(key);
				})
				.catch(() => {});
		} else {
			this.logger.debug(
				{
					event: "acquisition.source_download_joined",
					sourceId: saved.sourceId,
				},
				"Source download content request joined.",
			);
		}
		entry.readers++;
		const current = entry;
		try {
			const result = await this.wait(current.promise, signal);
			if (this.signal.aborted) throw new SourceError("source_unavailable");
			if (signal.aborted) throw new SourceError("request_cancelled");
			if (!this.isCurrent(reference)) throw new SourceError("source_conflict");
			return this.copy(result);
		} finally {
			current.readers--;
			if (current.readers === 0 && !current.settled) {
				current.controller.abort();
				if (this.inFlight.get(key) === current) this.inFlight.delete(key);
			}
		}
	}
	private wait(promise: Promise<DownloadContent>, signal: AbortSignal) {
		return new Promise<DownloadContent>((resolve, reject) => {
			const abort = () => reject(new SourceError("request_cancelled"));
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			void promise
				.then(resolve, reject)
				.finally(() => signal.removeEventListener("abort", abort));
		});
	}
	private copy(value: DownloadContent): DownloadContent {
		return value.kind === "bytes"
			? { kind: "bytes", bytes: value.bytes.slice() }
			: { ...value };
	}
	private cached(key: string): DownloadContent | undefined {
		for (const [id, entry] of this.cache) {
			if (entry.expiresAt <= this.now()) {
				this.cache.delete(id);
				this.cachedBytes -= entry.size;
			}
		}
		const entry = this.cache.get(key);
		if (!entry) return undefined;
		this.cache.delete(key);
		this.cache.set(key, entry);
		return entry.value;
	}
	private remember(key: string, value: DownloadContent) {
		const size =
			value.kind === "bytes"
				? value.bytes.byteLength
				: Buffer.byteLength(value.uri);
		if (size > contentCacheMaximumBytes) return;
		const previous = this.cache.get(key);
		if (previous) {
			this.cachedBytes -= previous.size;
			this.cache.delete(key);
		}
		this.cache.set(key, {
			value: this.copy(value),
			expiresAt: this.now() + contentCacheTtlMs,
			size,
		});
		this.cachedBytes += size;
		while (
			this.cache.size > contentCacheMaximumEntries ||
			this.cachedBytes > contentCacheMaximumBytes
		) {
			const oldest = this.cache.entries().next().value;
			if (!oldest) break;
			this.cache.delete(oldest[0]);
			this.cachedBytes -= oldest[1].size;
		}
	}
	private async readContent(
		saved: SourceDownload,
		signal: AbortSignal,
	): Promise<DownloadContent> {
		signal.throwIfAborted();
		const descriptor = saved.descriptor;
		if (saved.generation && !this.jackett)
			throw new SourceError("source_unconfigured");
		const content = saved.generation
			? await this.readJackett(saved.generation, descriptor, signal)
			: descriptor.kind === "magnet"
				? { kind: "magnet" as const, uri: descriptor.uri }
				: descriptor.kind === "public-torrent"
					? {
							kind: "bytes" as const,
							bytes: await this.transport.read(descriptor.url, signal),
						}
					: (() => {
							throw new SourceError("invalid_download_reference");
						})();
		signal.throwIfAborted();
		this.logger.debug(
			{ event: "acquisition.source_download_read", sourceId: saved.sourceId },
			"Source download reference resolved.",
		);
		return content;
	}
	private readJackett(
		generation: string,
		descriptor: ReleaseDownload,
		signal: AbortSignal,
	) {
		if (!this.jackett) throw new SourceError("source_unconfigured");
		return this.jackett.readTorrent(generation, descriptor, signal);
	}
	async close() {
		for (const entry of this.inFlight.values()) entry.controller.abort();
		this.cache.clear();
		this.cachedBytes = 0;
		await this.transport.close();
		await Promise.allSettled(this.pending);
	}
}
