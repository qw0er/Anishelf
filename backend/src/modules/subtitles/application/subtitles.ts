import { dirname, join } from "node:path";
import type { Logger } from "pino";
import {
	preparedSubtitleFormat,
	publicSubtitleFormat,
} from "../../../contracts/subtitles.js";
import type { MediaInfo, MediaTools } from "../../../platform/media/index.js";
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
	ResourceAccess,
} from "../../media-source/public.js";
import { defaultSubtitleName, subtitleTrackId } from "../domain/identity.js";
import type { SubtitleDiscovery } from "../domain/model.js";
import { readSubtitleText } from "../infrastructure/content.js";
import { discoverExternalSubtitles } from "../infrastructure/discovery.js";
import type { SubtitleRepository } from "../infrastructure/repository.js";
import { SubtitlePreparationApplication } from "./subtitle-preparation.js";

/** Subtitle discovery and delivery share source/version access checks. */
export class SubtitleApplication {
	private readonly logger: Logger | undefined;
	private readonly sources: MediaSourceApi;
	private readonly tools: Pick<MediaTools, "probe"> | undefined;
	private readonly cache = new Map<string, MediaInfo>();
	private readonly active = new Map<string, Promise<MediaInfo>>();
	private readonly preparation: SubtitlePreparationApplication | undefined;
	private readonly controller = new AbortController();
	constructor(options: {
		logger?: Logger;
		sources: MediaSourceApi;
		policy?: DeepReadonly<BuiltinPolicy>;
		tools?: Pick<MediaTools, "probe"> &
			Partial<Pick<MediaTools, "extractSubtitle">>;
		repository?: SubtitleRepository;
		dataDir?: string;
	}) {
		this.logger = options.logger?.child({ module: "subtitles" });
		this.sources = options.sources;
		this.policy = options.policy ?? builtinPolicy;
		this.tools = options.tools;
		if (
			options.repository &&
			options.dataDir &&
			options.tools?.extractSubtitle
		) {
			this.preparation = new SubtitlePreparationApplication({
				sources: options.sources,
				...(this.logger ? { logger: this.logger } : {}),
				policy: this.policy,
				repository: options.repository,
				dataDir: options.dataDir,
				tools: {
					extractSubtitle: options.tools.extractSubtitle.bind(options.tools),
				},
			});
		}
	}
	private readonly policy: DeepReadonly<BuiltinPolicy>;
	async close(): Promise<void> {
		this.controller.abort();
		await this.preparation?.close();
		await Promise.allSettled(this.active.values());
		this.cache.clear();
	}
	private async inspect(key: string, path: string): Promise<MediaInfo> {
		const cached = this.cache.get(key);
		if (cached) {
			this.logger?.trace(
				{ event: "subtitles.probe_cache_hit" },
				"Reusing cached media inspection.",
			);
			return cached;
		}
		const pending = this.active.get(key);
		if (pending) {
			this.logger?.trace(
				{ event: "subtitles.probe_joined" },
				"Joining media inspection.",
			);
			return pending;
		}
		if (this.active.size >= this.policy.media.probeConcurrency)
			throw new MediaToolError("TOOL_FAILED", "Media inspection is busy.");
		if (!this.tools)
			throw new MediaToolError(
				"TOOL_UNAVAILABLE",
				"Media inspection is unavailable.",
			);
		const promise = this.tools.probe(path, this.controller.signal);
		this.active.set(key, promise);
		try {
			const info = await promise;
			this.cache.set(key, info);
			if (this.cache.size > this.policy.media.maximumProbeCacheEntries) {
				const oldest = this.cache.keys().next().value;
				if (oldest !== undefined) this.cache.delete(oldest);
			}
			return info;
		} finally {
			this.active.delete(key);
		}
	}
	private async discoverEmbedded(
		identity: ResolvedSource["identity"],
		resources: ResourceAccess,
		name: string,
	): Promise<Pick<SubtitleDiscovery, "tracks" | "warnings">> {
		// No provider means this application is configured for external subtitles only.
		if (!this.tools) return { tracks: [], warnings: [] };
		const key = JSON.stringify([
			identity.canonicalRoot,
			identity.fileId,
			identity.sourceVersion,
		]);
		if (
			!this.cache.has(key) &&
			!this.active.has(key) &&
			this.active.size >= this.policy.media.probeConcurrency
		)
			return { tracks: [], warnings: [{ name, code: "SUBTITLE_PROBE_BUSY" }] };
		let info: MediaInfo;
		try {
			info = await this.inspect(
				key,
				join(resources.canonicalRoot, identity.relativePath),
			);
		} catch (error) {
			this.logger?.warn(
				{
					event: "subtitles.probe_failed",
					fileId: identity.fileId,
					err: error,
				},
				"Embedded subtitle discovery failed.",
			);
			if (!(error instanceof MediaToolError)) throw error;
			return {
				tracks: [],
				warnings: [
					{
						name,
						code:
							error.code === "TOOL_UNAVAILABLE"
								? "SUBTITLE_PROBE_UNAVAILABLE"
								: "SUBTITLE_PROBE_FAILED",
					},
				],
			};
		}
		return {
			warnings: [],
			tracks: info.streams
				.filter((stream) => stream.type === "subtitle")
				.map((stream) => {
					const codec = stream.codec;
					const extractionSupported =
						codec !== null && this.policy.subtitles.textCodecs.includes(codec);
					const output =
						codec === null
							? undefined
							: this.policy.subtitles.nativeFormats[codec];
					const format = extractionSupported
						? publicSubtitleFormat(
								output ?? this.policy.subtitles.defaultExtractionFormat,
							)
						: null;
					const webSupported =
						format !== null &&
						Object.values(this.policy.subtitles.formats).includes(format);
					return {
						id: subtitleTrackId([key, "embedded", stream.index]),
						origin: "embedded" as const,
						name: stream.tags.title || defaultSubtitleName(stream.index),
						label: stream.tags.title ?? null,
						language: stream.tags.language ?? null,
						codec,
						format,
						sizeBytes: null,
						sourceVersion: identity.sourceVersion,
						default: stream.default,
						forced: stream.forced,
						extractionSupported,
						webSupported,
						unsupportedReason: !extractionSupported
							? ("UNSUPPORTED_CODEC" as const)
							: !webSupported
								? ("UNSUPPORTED_FORMAT" as const)
								: null,
					};
				}),
		};
	}
	async discoverSubtitles(id: string): Promise<SubtitleDiscovery> {
		const started = Date.now();
		this.logger?.debug(
			{ event: "subtitles.discovery_started", fileId: id },
			"Subtitle discovery started.",
		);
		const source = await this.sources.resolveSource(id);
		const resources = await this.sources.openResources();
		if (
			resources.canonicalRoot !== source.identity.canonicalRoot ||
			source.rootEpoch !== this.sources.resourceRootEpoch
		)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
		const result = await discoverExternalSubtitles(
			resources,
			source.identity.relativePath,
			source.identity.sourceVersion,
			this.policy.subtitles,
			this.policy.library,
		);
		const tracks = await this.discoverEmbedded(
			source.identity,
			resources,
			source.file.name,
		);
		const discovery: SubtitleDiscovery = {
			...result,
			tracks: [...result.tracks, ...tracks.tracks],
			warnings: [...result.warnings, ...tracks.warnings],
		};
		const current = await resources.inspectVideoFileWithVersion(
			source.identity.relativePath,
		);
		if (
			source.rootEpoch !== this.sources.resourceRootEpoch ||
			current.sourceVersion !== source.identity.sourceVersion
		)
			throw new DomainError(
				"PLAYBACK_CONFLICT",
				"The playback source changed.",
			);
		this.logger?.debug(
			{
				event: "subtitles.discovered",
				fileId: id,
				trackCount: discovery.tracks.length,
				warningCount: discovery.warnings.length,
				durationMs: Date.now() - started,
			},
			"Subtitle discovery completed.",
		);
		return discovery;
	}

	async initialize(): Promise<void> {
		await this.preparation?.initialize();
	}
	private preparationService(): SubtitlePreparationApplication {
		if (!this.preparation)
			throw new DomainError(
				"SUBTITLE_PREPARATION_UNAVAILABLE",
				"Subtitle preparation is unavailable.",
			);
		return this.preparation;
	}
	async prepareSubtitle(
		fileId: string,
		trackId: string,
		sourceVersion: string,
	) {
		this.logger?.debug(
			{ event: "subtitles.prepare_requested", fileId, trackId },
			"Subtitle preparation requested.",
		);
		const preparation = this.preparationService();
		const source = await this.sources.resolveSource(fileId);
		if (source.identity.sourceVersion !== sourceVersion)
			throw new DomainError("PLAYBACK_CONFLICT", "The video changed.");
		const discovery = await this.discoverSubtitles(fileId);
		if (discovery.sourceVersion !== sourceVersion)
			throw new DomainError("PLAYBACK_CONFLICT", "The video changed.");
		const track = discovery.tracks.find((track) => track.id === trackId);
		if (track?.origin !== "embedded")
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"Unknown embedded subtitle track.",
			);
		if (!track.extractionSupported || !track.webSupported || !track.format)
			throw new DomainError(
				"SUBTITLE_UNSUPPORTED",
				"Unsupported subtitle track.",
			);
		const key = JSON.stringify([
			source.identity.canonicalRoot,
			source.identity.fileId,
			sourceVersion,
		]);
		const info = this.cache.get(key);
		const stream = info?.streams.find(
			(stream) =>
				stream.type === "subtitle" &&
				subtitleTrackId([key, "embedded", stream.index]) === trackId,
		);
		if (!stream)
			throw new DomainError(
				"SUBTITLE_PREPARATION_BUSY",
				"Subtitle inspection is unavailable. Retry.",
			);
		return preparation.prepare(
			source,
			trackId,
			stream.index,
			preparedSubtitleFormat(track.format),
		);
	}
	async getSubtitleAssetStatus(id: string) {
		this.logger?.trace(
			{ event: "subtitles.status_requested", assetId: id },
			"Subtitle status requested.",
		);
		return this.preparationService().status(id);
	}
	async getSubtitleAssetContent(id: string) {
		this.logger?.debug(
			{ event: "subtitles.content_requested", assetId: id },
			"Prepared subtitle content requested.",
		);
		return this.preparationService().content(id);
	}

	async getSubtitleContent(
		id: string,
		trackId: string,
		sourceVersion: string,
		subtitleVersion: string,
	): Promise<{ text: string }> {
		const source = await this.sources.resolveSource(id);
		if (source.identity.sourceVersion !== sourceVersion)
			throw new DomainError("PLAYBACK_CONFLICT", "The video changed.");
		const resources = await this.sources.openResources();
		if (
			source.rootEpoch !== this.sources.resourceRootEpoch ||
			resources.canonicalRoot !== source.identity.canonicalRoot
		)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
		const discovered = await discoverExternalSubtitles(
			resources,
			source.identity.relativePath,
			sourceVersion,
			this.policy.subtitles,
			this.policy.library,
		);
		const track = discovered.tracks.find(
			(candidate) => candidate.id === trackId,
		);
		if (!track)
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"The subtitle is unavailable. Refresh the subtitle list.",
			);
		if (track.sourceVersion !== subtitleVersion)
			throw new DomainError("PLAYBACK_CONFLICT", "The subtitle changed.");
		const path = join(dirname(source.identity.relativePath), track.name);
		const file = await resources.openSubtitleFile(path);
		let text: string;
		try {
			text = await readSubtitleText(
				file,
				this.policy.subtitles.maximumBytes,
				this.policy.subtitles.readChunkBytes,
			);
		} finally {
			await file.release();
		}
		const subtitle = await resources.inspectSubtitleSource(path);
		const video = await resources.inspectVideoFileWithVersion(
			source.identity.relativePath,
		);
		if (
			source.rootEpoch !== this.sources.resourceRootEpoch ||
			subtitle.sourceVersion !== subtitleVersion ||
			video.sourceVersion !== sourceVersion
		)
			throw new DomainError(
				"PLAYBACK_CONFLICT",
				"The subtitle or video changed.",
			);
		return { text };
	}
}
