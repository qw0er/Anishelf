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
import {
	type MediaInspectionApi,
	MediaInspectionBusyError,
} from "../../media-inspection/public.js";
import type {
	MediaSourceApi,
	ResolvedSource,
} from "../../media-source/public.js";
import { defaultSubtitleName, subtitleTrackId } from "../domain/identity.js";
import type {
	SubtitleDiscovery,
	SubtitlePreparationResult,
} from "../domain/model.js";
import { readSubtitleText } from "../infrastructure/content.js";
import { discoverExternalSubtitles } from "../infrastructure/discovery.js";
import type { SubtitleRepository } from "../infrastructure/repository.js";
import { SubtitlePreparationApplication } from "./subtitle-preparation.js";

/** Subtitle discovery and delivery share source/version access checks. */
export class SubtitleApplication {
	private readonly logger: Logger | undefined;
	private readonly sources: MediaSourceApi;
	private readonly inspection: MediaInspectionApi | undefined;
	private readonly preparation: SubtitlePreparationApplication | undefined;
	constructor(options: {
		logger?: Logger;
		sources: MediaSourceApi;
		policy?: DeepReadonly<BuiltinPolicy>;
		inspection?: MediaInspectionApi;
		tools?: Pick<MediaTools, "extractSubtitle">;
		repository?: SubtitleRepository;
		dataDir?: string;
	}) {
		this.logger = options.logger?.child({ module: "subtitles" });
		this.sources = options.sources;
		this.policy = options.policy ?? builtinPolicy;
		this.inspection = options.inspection;
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
		await this.preparation?.close();
	}
	private async discoverEmbedded(
		identity: ResolvedSource["identity"],
		name: string,
	): Promise<Pick<SubtitleDiscovery, "tracks" | "warnings">> {
		// No provider means this application is configured for external subtitles only.
		if (!this.inspection) return { tracks: [], warnings: [] };
		const key = JSON.stringify([
			identity.canonicalRoot,
			identity.fileId,
			identity.sourceVersion,
		]);
		let info: MediaInfo;
		try {
			const result = await this.inspection.inspect(
				identity.fileId,
				identity.sourceVersion,
			);
			info = result.info;
		} catch (error) {
			if (error instanceof MediaInspectionBusyError)
				return {
					tracks: [],
					warnings: [{ name, code: "SUBTITLE_PROBE_BUSY" }],
				};
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
		if (source.rootEpoch !== this.sources.resourceRootEpoch)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
		const tracks = await this.discoverEmbedded(
			source.identity,
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
		subtitleVersion?: string,
	): Promise<SubtitlePreparationResult> {
		this.logger?.debug(
			{ event: "subtitles.prepare_requested", fileId, trackId },
			"Subtitle preparation requested.",
		);
		const source = await this.sources.resolveSource(fileId);
		if (source.identity.sourceVersion !== sourceVersion)
			throw new DomainError("PLAYBACK_CONFLICT", "The video changed.");
		const discovery = await this.discoverSubtitles(fileId);
		if (discovery.sourceVersion !== sourceVersion)
			throw new DomainError("PLAYBACK_CONFLICT", "The video changed.");
		const track = discovery.tracks.find((track) => track.id === trackId);
		if (!track)
			throw new DomainError("RESOURCE_NOT_FOUND", "Unknown subtitle track.");
		if (track.origin === "external") {
			if (track.sourceVersion !== subtitleVersion)
				throw new DomainError(
					"PLAYBACK_CONFLICT",
					"The subtitle changed. Refresh the subtitle list.",
				);
			await this.getSubtitleContent(
				fileId,
				trackId,
				sourceVersion,
				subtitleVersion,
			);
			return {
				id: trackId,
				status: "ready",
				format: track.format,
				errorCode: null,
				external: { fileId, trackId, sourceVersion, subtitleVersion },
			};
		}
		if (
			subtitleVersion !== undefined &&
			track.sourceVersion !== subtitleVersion
		)
			throw new DomainError("PLAYBACK_CONFLICT", "The subtitle changed.");
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
		let info: MediaInfo | undefined;
		try {
			info = (await this.inspection?.inspect(fileId, sourceVersion))?.info;
		} catch (error) {
			if (
				error instanceof MediaInspectionBusyError ||
				error instanceof MediaToolError
			)
				throw new DomainError(
					"SUBTITLE_PREPARATION_BUSY",
					"Subtitle inspection is unavailable. Retry.",
				);
			throw error;
		}
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
		return this.preparationService().prepare(
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
