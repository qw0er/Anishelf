import { LRUCache } from "lru-cache";
import type { Logger } from "pino";
import type {
	MediaStream,
	MediaTools,
} from "../../../../platform/media/index.js";
import { DomainError } from "../../../../shared/errors.js";
import type { ResourceAccessApi } from "../../../resources/public.js";
import type { MediaAssetCatalogApi } from "../../assets.js";
import type { MediaInspectionApi } from "../../inspection/public.js";
import type { PreparationApi } from "../../preparation/public.js";

interface EmbeddedSubtitleBinding {
	fileId: string;
	sourceVersion: string;
	assetId: string;
	assetRevision: string;
}

interface ExtractedTrack {
	text: string;
	fonts: Awaited<ReturnType<MediaTools["listSubtitleFonts"]>> | null;
}

export class EmbeddedSubtitles {
	private active = 0;
	private readonly shutdown = new AbortController();
	private readonly tracks = new LRUCache<string, ExtractedTrack>({
		max: 128,
		maxSize: 64 * 1024 * 1024,
		sizeCalculation: ({ text, fonts }, key) =>
			256 + 2 * (text.length + key.length) + 64 * (fonts?.length ?? 0),
	});
	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			catalog: MediaAssetCatalogApi;
			inspection: MediaInspectionApi;
			preparation: Pick<PreparationApi, "catalog" | "openArtifact">;
			tools: Pick<
				MediaTools,
				"extractAss" | "listSubtitleFonts" | "extractSubtitleFont"
			>;
			maximumBytes: number;
			logger: Logger;
		},
	) {}

	close() {
		this.shutdown.abort();
		this.tracks.clear();
	}

	private async read<T extends object>(
		binding: EmbeddedSubtitleBinding,
		requestSignal: AbortSignal,
		operation: (
			path: string,
			streams: MediaStream[],
			signal: AbortSignal,
		) => Promise<T>,
		cache?: {
			index: number;
			entries: LRUCache<string, T>;
			canStore(result: T): boolean;
		},
	): Promise<T> {
		const { sources, catalog, inspection, preparation } = this.options;
		const { fileId, sourceVersion, assetId, assetRevision } = binding;
		const signal = AbortSignal.any([
			requestSignal,
			this.shutdown.signal,
			AbortSignal.timeout(60_000),
		]);
		let extracting = false;
		let lease: Awaited<ReturnType<PreparationApi["openArtifact"]>> | undefined;
		try {
			signal.throwIfAborted();
			const source = await sources.resolveSource(fileId, sourceVersion);
			const validateAsset = async () => {
				const { assets } = await catalog.list(fileId, sourceVersion);
				const asset = assets.find((item) => item.id === assetId);
				if (!asset || asset.revision !== assetRevision)
					throw new DomainError(
						"PLAYBACK_CONFLICT",
						"The selected media asset changed.",
					);
				return asset;
			};
			const asset = await validateAsset();
			const key =
				cache &&
				JSON.stringify([
					source.accessRevision,
					source.identity.scopeId,
					fileId,
					sourceVersion,
					assetId,
					assetRevision,
					cache.index,
				]);
			const saved = cache && key ? cache.entries.get(key) : undefined;
			if (saved) {
				await sources.revalidateSource(source);
				sources.assertAccessRevision(source.accessRevision);
				signal.throwIfAborted();
				this.options.logger.debug(
					{
						event: "subtitles.embedded_cache_hit",
						fileId,
						assetId,
						streamIndex: cache?.index,
					},
					"Reused an extracted subtitle track.",
				);
				return saved;
			}
			signal.throwIfAborted();
			if (this.active >= 2)
				throw new DomainError(
					"SUBTITLE_PREPARATION_BUSY",
					"Subtitle extraction is busy.",
				);
			this.active++;
			extracting = true;
			let path: string;
			let streams: MediaStream[];
			if (asset.kind === "original") {
				streams = (await inspection.inspect(fileId, sourceVersion)).info
					.streams;
				path = await sources.filePath(source);
			} else {
				const { assets } = await preparation.catalog(fileId);
				const prepared = assets.find(
					(item) =>
						item.id === assetId &&
						item.source.scopeId === source.identity.scopeId &&
						item.source.sourceVersion === sourceVersion &&
						item.source.fileId === fileId,
				);
				if (!prepared)
					throw new DomainError(
						"PLAYBACK_CONFLICT",
						"The prepared asset is no longer available.",
					);
				lease = await preparation.openArtifact(assetId);
				path = lease.path;
				streams = prepared.info.streams;
			}
			signal.throwIfAborted();
			const result = await operation(path, streams, signal);
			await validateAsset();
			await sources.revalidateSource(source);
			sources.assertAccessRevision(source.accessRevision);
			signal.throwIfAborted();
			if (cache && key && cache.canStore(result))
				cache.entries.set(key, result);
			return result;
		} catch (error) {
			if (error instanceof DomainError) throw error;
			this.options.logger.warn(
				{
					event: "subtitles.embedded_read_failed",
					fileId,
					assetId,
					cancelled: signal.aborted,
				},
				"Styled subtitle extraction failed.",
			);
			throw new DomainError(
				"SUBTITLE_PREPARATION_UNAVAILABLE",
				"Styled subtitle extraction failed.",
				{ cause: error },
			);
		} finally {
			try {
				await lease?.release();
			} finally {
				if (extracting) this.active--;
			}
		}
	}

	async track(
		binding: EmbeddedSubtitleBinding,
		index: number,
		requestSignal: AbortSignal,
	) {
		const { text, fonts } = await this.read<ExtractedTrack>(
			binding,
			requestSignal,
			async (path, streams, signal) => {
				const stream = streams.find((item) => item.index === index);
				if (
					stream?.type !== "subtitle" ||
					(stream.codec !== "ass" && stream.codec !== "ssa")
				)
					throw new DomainError(
						"SUBTITLE_UNSUPPORTED",
						"Select an embedded ASS or SSA track.",
					);
				const text = await this.options.tools.extractAss(
					path,
					index,
					this.options.maximumBytes,
					signal,
				);
				const fonts = streams.some((item) => item.type === "attachment")
					? await this.options.tools
							.listSubtitleFonts(path, signal)
							.catch(() => {
								this.options.logger.warn(
									{
										event: "subtitles.font_inventory_unavailable",
										fileId: binding.fileId,
										assetId: binding.assetId,
									},
									"Embedded subtitle fonts are unavailable.",
								);
								return null;
							})
					: [];
				this.options.logger.debug(
					{
						event: "subtitles.embedded_track_extracted",
						fileId: binding.fileId,
						assetId: binding.assetId,
						streamIndex: index,
						fontCount: fonts?.length ?? 0,
					},
					"Styled subtitle track extracted.",
				);
				return { text, fonts };
			},
			{
				index,
				entries: this.tracks,
				canStore: (track) => track.fonts !== null,
			},
		);
		return { text, fonts: fonts ?? [] };
	}

	font(
		binding: EmbeddedSubtitleBinding,
		index: number,
		requestSignal: AbortSignal,
	) {
		return this.read(binding, requestSignal, async (path, _streams, signal) => {
			const fonts = await this.options.tools.listSubtitleFonts(path, signal);
			const font = fonts.find((candidate) => candidate.index === index);
			if (!font)
				throw new DomainError(
					"RESOURCE_NOT_FOUND",
					"The subtitle font is unavailable.",
				);
			return this.options.tools.extractSubtitleFont(path, font, signal);
		});
	}
}
