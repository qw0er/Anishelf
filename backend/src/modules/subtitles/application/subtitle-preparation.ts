import { join } from "node:path";
import type { Logger } from "pino";
import { publicSubtitleFormat } from "../../../contracts/subtitles.js";
import type { MediaTools } from "../../../platform/media/index.js";
import { MediaToolError } from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type {
	ResolvedSource,
	ResourceAccessApi,
} from "../../resource-access/public.js";
import { subtitleAssetId, subtitleIdentity } from "../domain/identity.js";
import type {
	PreparedSubtitleFormat,
	SubtitleAsset,
	SubtitlePreparation,
	SubtitlePreparationError,
} from "../domain/model.js";
import {
	type SubtitleRuntimePolicy,
	subtitleRuntimePolicy,
} from "../domain/policy.js";
import { SubtitleAssetFiles } from "../infrastructure/assets.js";
import type { SubtitleRepository } from "../infrastructure/repository.js";

export class SubtitlePreparationApplication {
	private readonly logger: Logger | undefined;
	private readonly files: SubtitleAssetFiles;
	private readonly controller = new AbortController();
	private initialization: Promise<void> | undefined;
	private failure: unknown;
	private readonly active = new Map<string, Promise<void>>();
	private publication: Promise<void> = Promise.resolve();
	constructor(
		private readonly options: {
			logger?: Logger;
			sources: ResourceAccessApi;
			policy?: DeepReadonly<SubtitleRuntimePolicy>;
			repository: SubtitleRepository;
			dataDir: string;
			tools: Pick<MediaTools, "extractSubtitle">;
		},
	) {
		this.logger = options.logger?.child({ module: "subtitle-preparation" });
		this.files = new SubtitleAssetFiles(options.dataDir);
	}
	initialize(): Promise<void> {
		this.initialization ??= this.reconcile().catch((cause) => {
			this.logger?.error(
				{ event: "subtitles.cache_initialization_failed", err: cause },
				"Subtitle cache initialization failed.",
			);
			throw new DomainError(
				"SUBTITLE_PREPARATION_UNAVAILABLE",
				"Subtitle cache initialization failed.",
				{ cause },
			);
		});
		return this.initialization;
	}
	private async reconcile(): Promise<void> {
		const started = Date.now();
		let recoveredCount = 0;
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
				recoveredCount++;
			}
		}
		this.logger?.info(
			{
				event: "subtitles.cache_initialized",
				assetCount: assets.length,
				recoveredCount,
				durationMs: Date.now() - started,
			},
			"Subtitle cache reconciled.",
		);
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
		await this.options.sources.revalidateSource({
			identity: asset.source,
			...(epoch === undefined ? {} : { rootEpoch: epoch }),
		});
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
					(this.options.policy ?? subtitleRuntimePolicy).subtitles.maximumBytes,
				);
				this.logger?.debug(
					{ event: "subtitles.asset_reused", assetId: id },
					"Reusing prepared subtitle asset.",
				);
				return this.view(existing);
			} catch (err) {
				this.logger?.warn(
					{ event: "subtitles.asset_invalid", assetId: id, err },
					"Cached subtitle asset is unavailable; preparing again.",
				);
				await this.files.remove(existing);
			}
		}
		if (this.active.has(id)) {
			this.logger?.debug(
				{ event: "subtitles.preparation_joined", assetId: id },
				"Joining active subtitle preparation.",
			);
			return this.view(asset);
		}
		if (
			this.active.size >=
			(this.options.policy ?? subtitleRuntimePolicy).subtitles
				.extractionConcurrency
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
				this.logger?.error(
					{ event: "subtitles.persistence_failed", assetId: id, err: cause },
					"Subtitle worker persistence failed.",
				);
				this.failure = cause;
			});
		return this.view(asset);
	}
	private async extract(asset: SubtitleAsset, epoch: number): Promise<void> {
		const started = Date.now();
		const context = {
			assetId: asset.id,
			fileId: asset.source.fileId,
			trackId: asset.trackId,
			format: asset.format,
		};
		this.logger?.info(
			{ event: "subtitles.preparation_started", ...context },
			"Subtitle preparation started.",
		);
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
				(this.options.policy ?? subtitleRuntimePolicy).subtitles.maximumBytes
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
					(this.options.policy ?? subtitleRuntimePolicy).subtitles
						.maximumCacheBytes
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
			this.logger?.info(
				{
					event: "subtitles.preparation_completed",
					...context,
					sizeBytes,
					durationMs: Date.now() - started,
				},
				"Subtitle asset published.",
			);
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
			const log = {
				event: "subtitles.preparation_failed",
				...context,
				errorCode,
				err: error,
				durationMs: Date.now() - started,
			};
			if (this.controller.signal.aborted)
				this.logger?.debug(
					log,
					"Subtitle preparation interrupted during shutdown.",
				);
			else this.logger?.error(log, "Subtitle preparation failed.");
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
					(this.options.policy ?? subtitleRuntimePolicy).subtitles.maximumBytes,
				);
			} catch (err) {
				this.logger?.warn(
					{ event: "subtitles.asset_invalid", assetId: id, err },
					"Prepared subtitle asset is unavailable.",
				);
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
				(this.options.policy ?? subtitleRuntimePolicy).subtitles.maximumBytes,
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
