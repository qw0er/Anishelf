import { join } from "node:path";
import { publicSubtitleFormat } from "../../../contracts/subtitles.js";
import type { MediaTools } from "../../../platform/media/index.js";
import { MediaToolError } from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../../configuration/public.js";
import type {
	MediaSourceApi,
	ResolvedSource,
} from "../../media-source/public.js";
import { subtitleAssetId, subtitleIdentity } from "../domain/identity.js";
import type {
	PreparedSubtitleFormat,
	SubtitleAsset,
	SubtitlePreparation,
	SubtitlePreparationError,
} from "../domain/model.js";
import { SubtitleAssetFiles } from "../infrastructure/assets.js";
import type { SubtitleRepository } from "../infrastructure/repository.js";

export class SubtitlePreparationApplication {
	private readonly files: SubtitleAssetFiles;
	private readonly controller = new AbortController();
	private initialization: Promise<void> | undefined;
	private failure: unknown;
	private readonly active = new Map<string, Promise<void>>();
	private publication: Promise<void> = Promise.resolve();
	constructor(
		private readonly options: {
			sources: MediaSourceApi;
			policy?: DeepReadonly<BuiltinPolicy>;
			repository: SubtitleRepository;
			dataDir: string;
			tools: Pick<MediaTools, "extractSubtitle">;
		},
	) {
		this.files = new SubtitleAssetFiles(options.dataDir);
	}
	initialize(): Promise<void> {
		this.initialization ??= this.reconcile().catch((cause) => {
			throw new DomainError(
				"SUBTITLE_PREPARATION_UNAVAILABLE",
				"Subtitle cache initialization failed.",
				{ cause },
			);
		});
		return this.initialization;
	}
	private async reconcile(): Promise<void> {
		const assets = this.options.repository.list();
		const valid = await this.files.initialize(assets);
		for (const asset of assets) {
			if (
				asset.status === "pending" ||
				(asset.status === "ready" && !valid.has(asset.id))
			) {
				this.options.repository.save({
					...asset,
					status: "failed",
					sizeBytes: null,
					errorCode: "SUBTITLE_INTERRUPTED",
				});
				await this.files.remove(asset);
			}
		}
	}
	private view(asset: SubtitleAsset): SubtitlePreparation {
		return {
			id: asset.id,
			status: asset.status,
			format: publicSubtitleFormat(asset.format),
			errorCode: asset.errorCode,
		};
	}
	private async validate(asset: SubtitleAsset, epoch?: number): Promise<void> {
		if (epoch !== undefined && this.options.sources.resourceRootEpoch !== epoch)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
		const source = await this.options.sources.resolveSource(
			asset.source.fileId,
		);
		if (
			source.identity.canonicalRoot !== asset.source.canonicalRoot ||
			source.identity.sourceVersion !== asset.source.sourceVersion ||
			(epoch !== undefined && source.rootEpoch !== epoch)
		)
			throw new DomainError(
				"PLAYBACK_CONFLICT",
				"The subtitle source changed.",
			);
	}
	async prepare(
		source: ResolvedSource,
		trackId: string,
		streamIndex: number,
		format: PreparedSubtitleFormat,
	): Promise<SubtitlePreparation> {
		await this.initialize();
		if (this.failure)
			throw new DomainError(
				"SUBTITLE_PREPARATION_UNAVAILABLE",
				"Subtitle persistence failed.",
				{ cause: this.failure },
			);
		if (this.controller.signal.aborted)
			throw new DomainError(
				"SUBTITLE_PREPARATION_UNAVAILABLE",
				"Subtitle preparation is closed.",
			);
		const id = subtitleAssetId([
			source.identity.canonicalRoot,
			source.identity.fileId,
			source.identity.sourceVersion,
			trackId,
			format,
		]);
		const asset: SubtitleAsset = {
			id,
			source: source.identity,
			trackId,
			streamIndex,
			processingVersion: subtitleIdentity.processingVersion,
			format,
			status: "pending",
			sizeBytes: null,
			errorCode: null,
		};
		await this.validate(asset, source.rootEpoch);
		const existing = this.options.repository.get(id);
		if (existing?.status === "ready") {
			try {
				await this.files.read(
					existing,
					(this.options.policy ?? builtinPolicy).subtitles.maximumBytes,
				);
				return this.view(existing);
			} catch {
				await this.files.remove(existing);
			}
		}
		if (this.active.has(id)) return this.view(asset);
		if (
			this.active.size >=
			(this.options.policy ?? builtinPolicy).subtitles.extractionConcurrency
		)
			throw new DomainError(
				"SUBTITLE_PREPARATION_BUSY",
				"Subtitle preparation is busy.",
			);
		this.options.repository.save(asset);
		const promise = this.extract(asset, source.rootEpoch);
		this.active.set(id, promise);
		// The worker owns errors and terminal persistence; HTTP returns pending immediately.
		void promise
			.finally(() => {
				this.active.delete(id);
			})
			.catch((cause) => {
				this.failure = cause;
			});
		return this.view(asset);
	}
	private async extract(asset: SubtitleAsset, epoch: number): Promise<void> {
		let published = false;
		try {
			await this.files.remove(asset);
			await this.validate(asset, epoch);
			const result = await this.options.tools.extractSubtitle(
				join(asset.source.canonicalRoot, asset.source.relativePath),
				asset.streamIndex,
				{ format: asset.format, signal: this.controller.signal },
			);
			const sizeBytes = Buffer.byteLength(result.text, "utf8");
			if (
				result.format !== asset.format ||
				result.streamIndex !== asset.streamIndex ||
				!result.text.trim()
			)
				throw new MediaToolError("INVALID_MEDIA", "Invalid subtitle output.");
			if (
				sizeBytes >
				(this.options.policy ?? builtinPolicy).subtitles.maximumBytes
			)
				throw new DomainError(
					"SUBTITLE_TOO_LARGE",
					"Subtitle output exceeds the size limit.",
				);
			// Serialize budget checks through publication so parallel workers cannot oversubscribe the cache.
			const publication = this.publication.then(async () => {
				const total = await this.files.totalBytes();
				if (
					total + sizeBytes >
					(this.options.policy ?? builtinPolicy).subtitles.maximumCacheBytes
				)
					throw new Error("SUBTITLE_CACHE_FULL");
				await this.validate(asset, epoch);
				if (this.controller.signal.aborted)
					throw new Error("SUBTITLE_INTERRUPTED");
				await this.files.publish(asset, result.text);
				published = true;
				await this.validate(asset, epoch);
				if (this.controller.signal.aborted)
					throw new Error("SUBTITLE_INTERRUPTED");
				this.options.repository.save({
					...asset,
					status: "ready",
					sizeBytes,
					errorCode: null,
				});
			});
			this.publication = publication.catch(() => {});
			await publication;
		} catch (error) {
			if (published) await this.files.remove(asset).catch(() => {});
			let errorCode: SubtitlePreparationError = "SUBTITLE_EXTRACTION_FAILED";
			if (this.controller.signal.aborted) errorCode = "SUBTITLE_INTERRUPTED";
			else if (
				error instanceof DomainError &&
				(error.code === "PLAYBACK_CONFLICT" ||
					error.code === "SUBTITLE_TOO_LARGE")
			)
				errorCode = error.code;
			else if (
				error instanceof MediaToolError &&
				error.code === "TOOL_UNAVAILABLE"
			)
				errorCode = "SUBTITLE_TOOL_UNAVAILABLE";
			else if (
				error instanceof Error &&
				(error.message === "SUBTITLE_CACHE_FULL" ||
					("code" in error && error.code === "ENOSPC"))
			)
				errorCode = "SUBTITLE_CACHE_FULL";
			this.options.repository.save({
				...asset,
				status: "failed",
				sizeBytes: null,
				errorCode,
			});
		}
	}
	private async asset(id: string): Promise<SubtitleAsset> {
		await this.initialize();
		if (this.failure)
			throw new DomainError(
				"SUBTITLE_PREPARATION_UNAVAILABLE",
				"Subtitle persistence failed.",
				{ cause: this.failure },
			);
		const asset = this.options.repository.get(id);
		if (!asset)
			throw new DomainError("RESOURCE_NOT_FOUND", "Unknown subtitle asset.");
		await this.validate(asset);
		return asset;
	}
	async status(id: string): Promise<SubtitlePreparation> {
		const asset = await this.asset(id);
		if (asset.status === "ready") {
			try {
				await this.files.read(
					asset,
					(this.options.policy ?? builtinPolicy).subtitles.maximumBytes,
				);
			} catch {
				const failed: SubtitleAsset = {
					...asset,
					status: "failed",
					sizeBytes: null,
					errorCode: "SUBTITLE_INTERRUPTED",
				};
				this.options.repository.save(failed);
				await this.files.remove(asset);
				return this.view(failed);
			}
		}
		await this.validate(asset);
		return this.view(asset);
	}
	async content(id: string): Promise<{ text: string }> {
		const asset = await this.asset(id);
		if (asset.status !== "ready")
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"Subtitle asset is not ready.",
			);
		try {
			const text = await this.files.read(
				asset,
				(this.options.policy ?? builtinPolicy).subtitles.maximumBytes,
			);
			await this.validate(asset);
			return { text };
		} catch (error) {
			if (error instanceof DomainError) throw error;
			this.options.repository.save({
				...asset,
				status: "failed",
				sizeBytes: null,
				errorCode: "SUBTITLE_INTERRUPTED",
			});
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"Subtitle asset is unavailable.",
			);
		}
	}
	async close(): Promise<void> {
		this.controller.abort();
		await Promise.allSettled(this.active.values());
	}
}
