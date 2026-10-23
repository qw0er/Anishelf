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
/** Private durable locator ownership; consumers retain only opaque IDs. */
export class SourceContent {
	private readonly pending = new Set<Promise<DownloadContent>>();
	constructor(
		private readonly store: SourceLifecycleStore,
		private readonly transport: SourceTorrentTransport,
		private readonly jackett: JackettConnection | undefined,
		private readonly signal: AbortSignal,
		private readonly logger: Logger,
		private readonly record?: (id: string) => SourceRecord | null,
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
	read(reference: string, signal: AbortSignal): Promise<DownloadContent> {
		if (this.signal.aborted)
			return Promise.reject(new SourceError("source_unavailable"));
		if (this.pending.size >= 2)
			return Promise.reject(new SourceError("source_busy"));
		const task = this.readContent(reference, signal);
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => {});
		return task;
	}
	private async readContent(
		reference: string,
		signal: AbortSignal,
	): Promise<DownloadContent> {
		const saved = this.lookup(reference);
		if (!saved) throw new SourceError("download_missing");
		if (!this.isCurrent(reference)) throw new SourceError("source_conflict");
		const combined = AbortSignal.any([signal, this.signal]);
		combined.throwIfAborted();
		const descriptor = saved.descriptor;
		if (saved.generation && !this.jackett)
			throw new SourceError("source_unconfigured");
		const content = saved.generation
			? await this.readJackett(saved.generation, descriptor, combined)
			: descriptor.kind === "magnet"
				? { kind: "magnet" as const, uri: descriptor.uri }
				: descriptor.kind === "public-torrent"
					? {
							kind: "bytes" as const,
							bytes: await this.transport.read(descriptor.url, combined),
						}
					: (() => {
							throw new SourceError("invalid_download_reference");
						})();
		combined.throwIfAborted();
		if (!this.isCurrent(reference)) throw new SourceError("source_conflict");
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
		await this.transport.close();
		await Promise.allSettled(this.pending);
	}
}
