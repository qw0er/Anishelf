import { randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	readdir,
	rename,
	rm,
	statfs,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type {
	OfflineCacheEntry,
	OfflineCachePlayback,
} from "@anishelf/contracts/offline-cache";
import { subtitleMimeTypes } from "@anishelf/contracts/subtitles";
import { net, type Session, type WebContents } from "electron";
import {
	downloadPercent,
	transferDownload,
} from "../native/download-transfer.js";
import {
	CacheError,
	type CacheServer,
	cacheFailure,
	createCacheSource,
} from "./source.js";
import type {
	CacheFile,
	CacheManifest,
	CacheRecord,
	OfflineCacheStore,
} from "./store.js";
import { startCacheStream } from "./stream.js";

const taskId = /^[a-f\d-]{36}$/;
const fileIdPattern = /^[A-Za-z0-9_-]{1,256}$/;

function idle(status: OfflineCacheEntry["status"]) {
	return status === "ready" || status === "failed" || status === "unavailable";
}

function validTarget(value: unknown) {
	if (
		!value ||
		typeof value !== "object" ||
		!("fileId" in value) ||
		typeof value.fileId !== "string" ||
		!fileIdPattern.test(value.fileId)
	)
		throw new Error("Invalid cache target.");
	const sourceVersion =
		"sourceVersion" in value ? value.sourceVersion : undefined;
	if (
		sourceVersion !== undefined &&
		(typeof sourceVersion !== "string" || !fileIdPattern.test(sourceVersion))
	)
		throw new Error("Invalid source version.");
	return {
		fileId: value.fileId,
		sourceVersion: sourceVersion ?? null,
		name:
			"name" in value && typeof value.name === "string"
				? value.name.slice(0, 1024)
				: value.fileId,
	};
}

async function describeFile(
	directory: string,
	name: string,
	mime: string,
	size: number,
) {
	const stat = await lstat(join(directory, name));
	if (!stat.isFile() || stat.size !== size) throw new CacheError("download");
	return { name, mime, size, modifiedAt: stat.mtimeMs };
}

async function hasFile(directory: string, file: CacheFile) {
	const stat = await lstat(join(directory, file.name)).catch(() => null);
	return (
		!!stat?.isFile() &&
		stat.size === file.size &&
		stat.mtimeMs === file.modifiedAt
	);
}

export class DesktopOfflineCache {
	private readonly records = new Map<string, CacheRecord>();
	private readonly leases = new Map<
		string,
		{ id: string; sender: WebContents }
	>();
	private readonly readers = new Map<string, number>();
	private readonly removing = new Set<string>();
	private readonly queue: string[] = [];
	private running:
		| { id: string; abort: AbortController; finished: Promise<void> }
		| undefined;
	private stream: Awaited<ReturnType<typeof startCacheStream>> | undefined;
	private disposed = false;

	constructor(
		private readonly directory: string,
		private readonly store: OfflineCacheStore,
		private readonly session: Session,
		private readonly server: () => CacheServer,
		private readonly publish: (
			entry: OfflineCacheEntry | null,
			id: string,
		) => void,
	) {}

	get origin() {
		return this.stream?.origin;
	}

	async initialize() {
		const staging = join(this.directory, "staging");
		const media = join(this.directory, "media");
		await rm(staging, { recursive: true, force: true });
		await mkdir(staging, { mode: 0o700 });
		await mkdir(media, { recursive: true, mode: 0o700 });
		for (const record of this.store.list()) {
			if (!idle(record.entry.status)) {
				record.entry.status = "failed";
				record.entry.failure = "interrupted";
				record.entry.percent = null;
				this.store.save(record);
				console.info("desktop.cache_recovered", { id: record.entry.id });
			}
			this.records.set(record.entry.id, record);
		}
		for (const name of await readdir(media)) {
			if (taskId.test(name) && !this.records.get(name)?.manifest)
				await rm(join(media, name), { recursive: true, force: true });
		}
		this.stream = await startCacheStream((lease, asset) =>
			this.resolveStream(lease, asset),
		);
	}

	dispose() {
		this.disposed = true;
		this.stream?.close();
		this.running?.abort.abort();
		if (!this.running) this.store.close();
	}

	async list() {
		await Promise.all(
			[...this.records.values()].map(async (record) => {
				if (record.entry.status === "ready" && !(await this.available(record)))
					this.markMissing(record);
			}),
		);
		return [...this.records.values()].map((record) => this.publicEntry(record));
	}

	start(value: unknown) {
		const target = validTarget(value);
		const server = this.server().key;
		const existing = [...this.records.values()].find(
			({ entry }) =>
				entry.server === server &&
				entry.fileId === target.fileId &&
				(entry.sourceVersion === target.sourceVersion ||
					(!target.sourceVersion && !idle(entry.status))),
		);
		if (existing) {
			if (
				existing.entry.status === "failed" ||
				existing.entry.status === "unavailable"
			)
				return this.retry(existing.entry.id);
			return;
		}
		const id = randomUUID();
		this.save({
			positionMs: 0,
			entry: {
				...target,
				id,
				server,
				episodes: [],
				status: "queued",
				percent: null,
				sizeBytes: 0,
				failure: null,
			},
		});
		this.enqueue(id);
	}

	async cancel(id: unknown) {
		const record = this.get(id);
		if (idle(record.entry.status)) return;
		const index = this.queue.indexOf(record.entry.id);
		if (index >= 0) {
			this.queue.splice(index, 1);
			this.erase(record.entry.id);
		} else if (this.running?.id === record.entry.id) {
			const task = this.running;
			task.abort.abort();
			await task.finished;
		}
	}

	async retry(id: unknown) {
		const record = this.get(id);
		const { entry } = record;
		if (entry.status !== "failed" && entry.status !== "unavailable") return;
		if (entry.server !== this.server().key) throw new CacheError("unreachable");
		if (this.playing(entry.id) || this.removing.has(entry.id)) return;
		this.removing.add(entry.id);
		try {
			await rm(this.mediaDirectory(entry.id), { recursive: true, force: true });
			this.save({
				positionMs: record.positionMs,
				entry: {
					...entry,
					status: "queued",
					failure: null,
					percent: null,
					sizeBytes: 0,
				},
			});
			this.enqueue(entry.id);
		} finally {
			this.removing.delete(entry.id);
		}
	}

	async remove(id: unknown) {
		const record = this.get(id);
		const key = record.entry.id;
		if (
			!idle(record.entry.status) ||
			this.playing(key) ||
			this.removing.has(key)
		)
			throw new Error("Cache entry is in use.");
		this.removing.add(key);
		try {
			await rm(this.mediaDirectory(key), { recursive: true, force: true });
			this.erase(key);
		} finally {
			this.removing.delete(key);
		}
	}

	async open(
		sender: WebContents,
		id: unknown,
	): Promise<OfflineCachePlayback | null> {
		const record = this.get(id);
		const { manifest, entry } = record;
		if (
			!manifest ||
			entry.status !== "ready" ||
			this.removing.has(entry.id) ||
			!this.origin
		)
			return null;
		if (!(await this.available(record))) {
			this.markMissing(record);
			return null;
		}
		if (
			this.disposed ||
			sender.isDestroyed() ||
			this.records.get(entry.id) !== record ||
			this.removing.has(entry.id)
		)
			return null;
		const lease = randomUUID();
		this.leases.set(lease, { id: entry.id, sender });
		this.emit(entry.id);
		const base = `${this.origin}/${lease}`;
		return {
			lease,
			name: entry.name,
			url: `${base}/video`,
			format: manifest.format,
			positionMs: record.positionMs,
			subtitles: manifest.subtitles.map(
				({ id, label, language, format }, index) => ({
					id,
					label,
					language,
					format,
					url: `${base}/${index}`,
				}),
			),
		};
	}

	position(sender: WebContents, lease: unknown, value: unknown) {
		const item = typeof lease === "string" ? this.leases.get(lease) : null;
		if (
			item?.sender !== sender ||
			typeof value !== "number" ||
			!Number.isSafeInteger(value) ||
			value < 0
		)
			return;
		const record = this.records.get(item.id);
		if (!record || record.positionMs === value) return;
		this.store.save({ ...record, positionMs: value });
		record.positionMs = value;
	}

	close(sender: WebContents, lease: unknown) {
		if (typeof lease !== "string") return;
		const item = this.leases.get(lease);
		if (item?.sender !== sender) return;
		this.leases.delete(lease);
		this.emit(item.id);
	}

	closeWindow(sender: WebContents) {
		for (const [lease, item] of this.leases)
			if (item.sender === sender) this.close(sender, lease);
	}

	private get(id: unknown) {
		const record =
			typeof id === "string" && taskId.test(id) && this.records.get(id);
		if (!record || this.disposed) throw new Error("Unknown cache entry.");
		return record;
	}

	private mediaDirectory(id: string) {
		return join(this.directory, "media", id);
	}

	private playing(id: string) {
		return (
			this.readers.has(id) ||
			[...this.leases.values()].some((lease) => lease.id === id)
		);
	}

	private publicEntry(record: CacheRecord) {
		return { ...record.entry, playing: this.playing(record.entry.id) };
	}

	private emit(id: string) {
		if (this.disposed) return;
		const record = this.records.get(id);
		this.publish(record ? this.publicEntry(record) : null, id);
	}

	private save(record: CacheRecord) {
		this.store.save(record);
		this.records.set(record.entry.id, record);
		this.emit(record.entry.id);
	}

	private update(id: string, changes: Partial<CacheRecord["entry"]>) {
		const record = this.get(id);
		const entry = { ...record.entry, ...changes };
		this.save({ ...record, entry });
		console.info("desktop.cache_status", {
			id,
			phase: entry.status,
			reason: entry.failure,
		});
		return entry;
	}

	private erase(id: string) {
		this.store.remove(id);
		this.records.delete(id);
		this.emit(id);
		console.info("desktop.cache_removed", { id });
	}

	private async available({ entry, manifest }: CacheRecord) {
		if (!manifest) return false;
		const directory = this.mediaDirectory(entry.id);
		return (
			(await hasFile(directory, manifest.video)) &&
			(
				await Promise.all(
					manifest.subtitles.map(({ file }) => hasFile(directory, file)),
				)
			).every(Boolean)
		);
	}

	private markMissing(record: CacheRecord) {
		const { id } = record.entry;
		if (
			!this.disposed &&
			!this.removing.has(id) &&
			this.records.get(id) === record
		) {
			try {
				this.update(id, { status: "unavailable", failure: "missing" });
			} catch (error) {
				console.warn("desktop.cache_status_failed", {
					id,
					reason: cacheFailure(error),
				});
			}
		}
	}

	private enqueue(id: string) {
		this.queue.push(id);
		this.runNext();
	}

	private runNext() {
		if (this.running || this.disposed) return;
		const id = this.queue.shift();
		if (!id) return;
		const abort = new AbortController();
		const finished = this.run(id, abort.signal)
			.catch((error: unknown) => {
				console.warn("desktop.cache_task_failed", {
					id,
					reason: cacheFailure(error),
				});
			})
			.finally(() => {
				this.running = undefined;
				if (this.disposed) this.store.close();
				else this.runNext();
			});
		this.running = { id, abort, finished };
	}

	private async run(id: string, signal: AbortSignal) {
		const staging = join(this.directory, "staging", id);
		const destination = this.mediaDirectory(id);
		try {
			const entry = this.update(id, { status: "preparing" });
			const server = this.server();
			if (entry.server !== server.key) throw new CacheError("unreachable");
			const source = createCacheSource(
				server,
				entry.fileId,
				signal,
				(url, init) => net.fetch(url, init),
			);
			const file = await source.file(entry.sourceVersion);
			const duplicate = [...this.records.values()].some(
				({ entry: other }) =>
					other.id !== id &&
					other.server === entry.server &&
					other.fileId === entry.fileId &&
					other.sourceVersion === file.sourceVersion &&
					other.status !== "failed" &&
					other.status !== "unavailable",
			);
			if (duplicate) {
				this.erase(id);
				return;
			}
			// A previous failed request for the discovered version is superseded.
			const previous = [...this.records.values()].find(
				({ entry: other }) =>
					other.id !== id &&
					other.server === entry.server &&
					other.fileId === entry.fileId &&
					other.sourceVersion === file.sourceVersion,
			);
			if (previous) {
				if (
					this.playing(previous.entry.id) ||
					this.removing.has(previous.entry.id)
				)
					throw new CacheError("storage");
				await this.remove(previous.entry.id);
			}
			const [episodes, tracks] = await Promise.all([
				source.episodes(file.sourceVersion),
				source.subtitles(file.sourceVersion),
			]);
			signal.throwIfAborted();
			this.update(id, {
				name: file.name,
				sourceVersion: file.sourceVersion,
				episodes,
			});
			await mkdir(staging, { mode: 0o700 });
			const subtitles: CacheManifest["subtitles"] = [];
			for (const track of tracks) {
				const contents = await source.subtitle(file.sourceVersion, track);
				const name = `subtitle-${subtitles.length}.${track.format}`;
				await writeFile(join(staging, name), contents, { mode: 0o600, signal });
				subtitles.push({
					id: track.id,
					format: track.format,
					language: track.language,
					label: track.label ?? track.name,
					file: await describeFile(
						staging,
						name,
						subtitleMimeTypes[track.format],
						contents.length,
					),
				});
			}
			await this.checkSpace(staging, file.sizeBytes);
			const href = await source.link();
			const videoName = `video.${file.format}`;
			const temporary = join(staging, `${videoName}.part`);
			this.update(id, { status: "downloading" });
			let saved: string | null;
			try {
				saved = await transferDownload({
					session: this.session,
					url: href,
					signal,
					begin: () => this.session.downloadURL(href),
					matches: () => true,
					configure(item) {
						if (item.getURLChain().length !== 1)
							throw new CacheError("download");
						item.setSavePath(temporary);
					},
					progress: (item) => {
						const current = this.records.get(id);
						const percent = downloadPercent(item);
						if (!current || percent === current.entry.percent) return;
						current.entry.percent = percent;
						this.emit(id);
					},
				});
			} catch (error) {
				signal.throwIfAborted();
				const partial = await lstat(temporary).catch(() => null);
				await this.checkSpace(
					staging,
					Math.max(0, file.sizeBytes - (partial?.size ?? 0)),
				);
				throw error;
			}
			if (saved !== temporary) throw new CacheError("download");
			this.update(id, { status: "finalizing" });
			await source.file(file.sourceVersion);
			await rename(temporary, join(staging, videoName));
			const video = await describeFile(
				staging,
				videoName,
				file.mimeType,
				file.sizeBytes,
			);
			signal.throwIfAborted();
			await rename(staging, destination);
			signal.throwIfAborted();
			const record = this.get(id);
			this.save({
				...record,
				entry: {
					...record.entry,
					status: "ready",
					percent: 100,
					sizeBytes:
						video.size +
						subtitles.reduce((bytes, track) => bytes + track.file.size, 0),
				},
				manifest: { video, subtitles, format: file.format },
			});
			console.info("desktop.cache_status", { id, phase: "ready" });
		} catch (error) {
			const reason = cacheFailure(error);
			try {
				await rm(staging, { recursive: true, force: true });
				await rm(destination, { recursive: true, force: true });
			} catch (cleanupError) {
				console.warn("desktop.cache_cleanup_failed", {
					id,
					reason: cacheFailure(cleanupError),
				});
			}
			if (this.disposed) return;
			if (signal.aborted) this.erase(id);
			else
				this.update(id, { status: "failed", failure: reason, percent: null });
		}
	}

	private async checkSpace(directory: string, needed: number) {
		const { bavail, bsize } = await statfs(directory, { bigint: true });
		if (bavail * bsize < BigInt(needed)) throw new CacheError("space");
	}

	private resolveStream(lease: string, asset: string) {
		const owner = this.leases.get(lease);
		const record = owner && this.records.get(owner.id);
		if (!record?.manifest || record.entry.status !== "ready") return null;
		const file =
			asset === "video"
				? record.manifest.video
				: record.manifest.subtitles[Number(asset)]?.file;
		if (!file) return null;
		const { id } = record.entry;
		this.readers.set(id, (this.readers.get(id) ?? 0) + 1);
		return {
			path: join(this.mediaDirectory(id), file.name),
			file,
			missing: () => this.markMissing(record),
			release: () => {
				const count = this.readers.get(id) ?? 0;
				if (count > 1) this.readers.set(id, count - 1);
				else {
					this.readers.delete(id);
					if (!this.playing(id)) this.emit(id);
				}
			},
		};
	}
}
