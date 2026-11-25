import PQueue from "p-queue";
import type { Logger } from "pino";
import { isWindowsPathPart } from "../../platform/paths.js";
import { abortable } from "../../shared/abortable.js";
import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
} from "../anime/public.js";
import { relativeDownloadPath } from "./downloads/domain/paths.js";
import { inspectTorrentContent } from "./downloads/infrastructure/torrent.js";
import { DownloadError } from "./downloads/public.js";
import {
	type ReleaseEvidence,
	SourceError,
	type SourcePublication,
} from "./sources/public.js";
import {
	type TorrentConnection,
	TorrentError,
	type TorrentManifest,
} from "./torrent-clients/public.js";

export interface ManifestPreviewCandidate {
	publication: SourcePublication;
	entry: Readonly<ReleaseEvidence>;
}

const lookupsPerPass = 4;
const pendingLimit = 16;
const cacheLimit = 32;
const successTtlMs = 5 * 60_000;
const retryDelayMs = 30_000;

function validateManifest(
	manifest: TorrentManifest,
	hash: string,
): TorrentManifest {
	if (manifest.hash !== hash)
		throw new DownloadError("torrent_identity_conflict");
	if (!manifest.files.length || manifest.files.length > 4096)
		throw new DownloadError("invalid_torrent_manifest");
	let totalBytes = 0;
	let pathLength = 0;
	const indices = new Set<number>();
	const paths = new Set<string>();
	for (const file of manifest.files) {
		relativeDownloadPath(file.path);
		if (
			/^[a-z]:/iu.test(file.path) ||
			(process.platform === "win32" &&
				!file.path.split("/").every(isWindowsPathPart))
		)
			throw new DownloadError("invalid_file_path");
		const path = file.path.normalize("NFC");
		if (
			!Number.isSafeInteger(file.index) ||
			file.index < 0 ||
			file.index >= manifest.files.length ||
			indices.has(file.index) ||
			paths.has(path) ||
			!Number.isSafeInteger(file.sizeBytes) ||
			file.sizeBytes < 0
		)
			throw new DownloadError("invalid_torrent_manifest");
		indices.add(file.index);
		paths.add(path);
		totalBytes += file.sizeBytes;
		pathLength += path.length;
	}
	if (!Number.isSafeInteger(totalBytes) || pathLength > 1024 * 1024)
		throw new DownloadError("invalid_torrent_manifest");
	for (const path of paths) {
		for (
			let end = path.lastIndexOf("/");
			end >= 0;
			end = path.lastIndexOf("/", end - 1)
		)
			if (paths.has(path.slice(0, end)))
				throw new DownloadError("invalid_torrent_manifest");
	}
	return manifest;
}

function failureCode(error: unknown): string {
	if (error instanceof DownloadError || error instanceof SourceError)
		return error.code;
	if (error instanceof TorrentError)
		return `metadata_${error.code.replace("-", "_")}`;
	return "metadata_unavailable";
}

/** Validated manifests are cached apart from the work-specific interpretation. */
export class ManifestPreview {
	private readonly queue = new PQueue({ concurrency: 2 });
	private readonly shutdown = new AbortController();
	private readonly pending = new Map<string, Promise<TorrentManifest>>();
	private readonly cache = new Map<
		string,
		{ manifest: TorrentManifest; expiresAt: number }
	>();
	private readonly failures = new Map<
		string,
		{ code: string; expiresAt: number }
	>();
	constructor(
		private readonly connection: TorrentConnection,
		private readonly mapFiles: NonNullable<
			ReleaseAssessmentApi["mapReleaseFiles"]
		>,
		private readonly logger: Logger,
		private readonly now = Date.now,
		private readonly deadlineMs = 8_000,
	) {}

	async preview(input: {
		candidates: readonly ManifestPreviewCandidate[];
		target: AcquisitionTarget;
		workKey: string;
		scope: { episode: number } | { startEpisode: number };
		signal: AbortSignal;
	}) {
		const generation = this.connection.connectionGeneration();
		const signal = AbortSignal.any([this.shutdown.signal, input.signal]);
		const results = await Promise.all(
			input.candidates.slice(0, lookupsPerPass).map(async (candidate) => {
				const { entry, publication } = candidate;
				const log = {
					workKey: input.workKey,
					sourceId: publication.snapshot.id,
					entryId: entry.id,
				};
				try {
					const manifest = await this.inspect(candidate, generation, signal);
					const coverage = this.mapFiles(
						entry.title,
						input.target,
						manifest.files,
					);
					const requested = (episode: number) =>
						!input.target.availableEpisodes.includes(episode) &&
						("episode" in input.scope
							? episode === input.scope.episode
							: episode >= input.scope.startEpisode);
					const selectableEpisodes = [
						...new Set(
							coverage.videos
								.filter((video) => video.episodes.every(requested))
								.flatMap((video) => video.episodes),
						),
					].sort((a, b) => a - b);
					this.logger.info(
						{
							event: "acquisition.manifest_evaluated",
							...log,
							hash: manifest.hash,
							indexSource: manifest.indexSource,
							fileCount: manifest.files.length,
							coverage: coverage.episodes,
							complete: coverage.complete,
							selectableEpisodes,
						},
						"Torrent manifest coverage evaluated.",
					);
					return { code: null, manifest, coverage, selectableEpisodes };
				} catch (error) {
					const code = failureCode(error);
					if (!signal.aborted)
						this.logger.info(
							{
								event: "acquisition.manifest_unavailable",
								...log,
								code,
							},
							"Torrent manifest could not be inspected.",
						);
					return { code };
				}
			}),
		);
		return results;
	}

	close() {
		this.shutdown.abort();
		this.cache.clear();
		this.failures.clear();
	}

	private async inspect(
		{ publication, entry }: ManifestPreviewCandidate,
		generation: string,
		signal: AbortSignal,
	): Promise<TorrentManifest> {
		const content = publication.content;
		const reference = entry.download;
		if (!content || !reference) throw new DownloadError("missing_download");
		const assertCurrent = () => {
			signal.throwIfAborted();
			if (!content.isContentCurrent(reference))
				throw new DownloadError("source_changed");
			if (generation !== this.connection.connectionGeneration())
				throw new DownloadError("downloader_changed");
		};
		const deadline = AbortSignal.timeout(this.deadlineMs);
		const bounded = AbortSignal.any([signal, deadline]);
		try {
			assertCurrent();
			const bytes = await abortable(
				content.readContent(reference, bounded),
				bounded,
			);
			const torrent = await inspectTorrentContent(bytes, entry.hash);
			assertCurrent();
			bounded.throwIfAborted();
			const key = JSON.stringify([
				generation,
				publication.snapshot.id,
				torrent.hash,
			]);
			const cached = this.cache.get(key);
			if (cached && cached.expiresAt > this.now()) return cached.manifest;
			const route = JSON.stringify([
				key,
				"torrent" in torrent.source ? "bytes" : reference,
			]);
			const recentFailure = this.failures.get(route);
			if (recentFailure && recentFailure.expiresAt > this.now())
				throw new DownloadError(recentFailure.code);
			let pending = this.pending.get(route);
			if (!pending) {
				if (this.pending.size >= pendingLimit)
					throw new DownloadError("metadata_busy");
				const lookupDeadline = AbortSignal.timeout(this.deadlineMs);
				const shared = AbortSignal.any([this.shutdown.signal, lookupDeadline]);
				pending = this.queue
					.add(
						async () => {
							if (!content.isContentCurrent(reference))
								throw new DownloadError("source_changed");
							const manifest = await this.connection.withClient(
								generation,
								async (client) => {
									const remote = await client.inspectMetadata?.(
										{
											source: torrent.source,
											expectedHash: torrent.hash,
										},
										shared,
									);
									const result = remote ?? torrent.localManifest();
									if (!result) throw new DownloadError("metadata_unsupported");
									return validateManifest(result, torrent.hash);
								},
							);
							shared.throwIfAborted();
							if (!content.isContentCurrent(reference))
								throw new DownloadError("source_changed");
							this.remember(this.cache, key, {
								manifest,
								expiresAt: this.now() + successTtlMs,
							});
							return manifest;
						},
						{ signal: shared },
					)
					.catch((error: unknown) => {
						const code = lookupDeadline.aborted
							? "metadata_timeout"
							: failureCode(error);
						if (
							!this.shutdown.signal.aborted &&
							content.isContentCurrent(reference)
						)
							this.remember(this.failures, route, {
								code,
								expiresAt: this.now() + retryDelayMs,
							});
						throw new DownloadError(code);
					})
					.finally(() => this.pending.delete(route));
				this.pending.set(route, pending);
			}
			const manifest = await abortable(pending, bounded);
			assertCurrent();
			return manifest;
		} catch (error) {
			if (deadline.aborted) throw new DownloadError("metadata_timeout");
			throw error;
		}
	}

	private remember<T>(cache: Map<string, T>, key: string, value: T) {
		cache.delete(key);
		cache.set(key, value);
		if (cache.size > cacheLimit) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) cache.delete(oldest);
		}
	}
}
