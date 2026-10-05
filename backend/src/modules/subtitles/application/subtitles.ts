import { dirname, join } from "node:path";
import type { Logger } from "pino";
import {
	preparedSubtitleFormat,
	publicSubtitleFormat,
} from "../../../contracts/subtitles.js";
import type { MediaInfo } from "../../../platform/media/index.js";
import { MediaToolError } from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import {
	type MediaInspectionApi,
	MediaInspectionBusyError,
} from "../../media-inspection/public.js";
import type {
	FileSourceIdentity,
	ResolvedSource,
	ResourceAccessApi,
	ResourceFiles,
} from "../../resource-access/public.js";
import { assertSourceVersion } from "../../resource-access/public.js";
import { defaultSubtitleName, subtitleTrackId } from "../domain/identity.js";
import type {
	ExternalSubtitle,
	SubtitleDiscovery,
	SubtitlePreparationResult,
} from "../domain/model.js";
import {
	type SubtitleRuntimePolicy,
	subtitleRuntimePolicy,
} from "../domain/policy.js";
import { readSubtitleText } from "../infrastructure/content.js";
import { discoverExternalSubtitles } from "../infrastructure/discovery.js";
import type { SubtitleRepository } from "../infrastructure/repository.js";
import type { SubtitleExtractor } from "../ports.js";
import type { SubtitleApi } from "../public.js";
import { SubtitlePreparationApplication } from "./subtitle-preparation.js";

/** Subtitle discovery and delivery share source/version access checks. */
export class SubtitleApplication implements SubtitleApi {
	private readonly logger: Logger | undefined;
	private readonly sources: ResourceAccessApi;
	private readonly inspection: MediaInspectionApi | undefined;
	private readonly preparation: SubtitlePreparationApplication | undefined;
	constructor(options: {
		logger?: Logger;
		sources: ResourceAccessApi;
		policy?: DeepReadonly<SubtitleRuntimePolicy>;
		inspection?: MediaInspectionApi;
		tools?: SubtitleExtractor;
		repository?: SubtitleRepository;
		dataDir?: string;
	}) {
		this.logger = options.logger?.child({ module: "subtitles" });
		this.sources = options.sources;
		this.policy = options.policy ?? subtitleRuntimePolicy;
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
	private readonly policy: DeepReadonly<SubtitleRuntimePolicy>;
	async close(): Promise<void> {
		await this.preparation?.close();
	}
	private async discoverEmbedded(
		identity: ResolvedSource["identity"],
		name: string,
	): Promise<
		Pick<SubtitleDiscovery, "tracks" | "warnings"> & { info?: MediaInfo }
	> {
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
			info,
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
	private async discoverForSource(source: ResolvedSource): Promise<{
		discovery: SubtitleDiscovery;
		resources: ResourceFiles;
		info: MediaInfo | undefined;
	}> {
		const resources = await this.sources.openResources(source);
		const external = await discoverExternalSubtitles(
			resources,
			source.identity.relativePath,
			source.identity.sourceVersion,
			this.policy.subtitles,
			this.policy.library,
		);
		this.sources.assertRootEpoch(source.rootEpoch);
		const embedded = await this.discoverEmbedded(
			source.identity,
			source.file.name,
		);
		// Successful inspection already validated this video after external discovery.
		// Busy, unavailable and external-only discovery still need an end-of-operation check.
		if (!embedded.info) await this.sources.revalidateSource(source);
		this.sources.assertRootEpoch(source.rootEpoch);
		return {
			resources,
			info: embedded.info,
			discovery: {
				...external,
				tracks: [...external.tracks, ...embedded.tracks],
				warnings: [...external.warnings, ...embedded.warnings],
			},
		};
	}

	async discoverSubtitles(id: string): Promise<SubtitleDiscovery> {
		const started = Date.now();
		this.logger?.debug(
			{ event: "subtitles.discovery_started", fileId: id },
			"Subtitle discovery started.",
		);
		const source = await this.sources.resolveSource(id);
		const { discovery } = await this.discoverForSource(source);
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
		const source = await this.sources.resolveSource(fileId, sourceVersion);
		const { discovery, resources, info } = await this.discoverForSource(source);
		const track = discovery.tracks.find((track) => track.id === trackId);
		if (!track)
			throw new DomainError("RESOURCE_NOT_FOUND", "Unknown subtitle track.");
		if (track.origin === "external") {
			assertSourceVersion(subtitleVersion ?? "", track.sourceVersion);
			await this.readExternalSubtitle(source, track, resources);
			return {
				id: trackId,
				status: "ready",
				format: track.format,
				errorCode: null,
				external: {
					fileId,
					trackId,
					sourceVersion,
					subtitleVersion: track.sourceVersion,
				},
			};
		}
		if (subtitleVersion !== undefined)
			assertSourceVersion(subtitleVersion, track.sourceVersion);
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

	private async readExternalSubtitle(
		source: ResolvedSource,
		track: ExternalSubtitle,
		resources: ResourceFiles,
	): Promise<{ text: string }> {
		const identity: FileSourceIdentity = {
			canonicalRoot: source.identity.canonicalRoot,
			relativePath: join(dirname(source.identity.relativePath), track.name),
			sourceVersion: track.sourceVersion,
		};
		this.sources.assertRootEpoch(source.rootEpoch);
		let text: string;
		try {
			const file = await resources.openSubtitleSource(identity);
			try {
				text = await readSubtitleText(
					file,
					this.policy.subtitles.maximumBytes,
					this.policy.subtitles.readChunkBytes,
				);
			} finally {
				await file.release();
			}
			await resources.revalidateSubtitleSource(identity);
		} catch (error) {
			this.sources.assertRootEpoch(source.rootEpoch);
			throw error;
		}
		await this.sources.revalidateSource(source);
		return { text };
	}

	async getSubtitleContent(
		id: string,
		trackId: string,
		sourceVersion: string,
		subtitleVersion: string,
	): Promise<{ text: string }> {
		const source = await this.sources.resolveSource(id, sourceVersion);
		const resources = await this.sources.openResources(source);
		const discovered = await discoverExternalSubtitles(
			resources,
			source.identity.relativePath,
			sourceVersion,
			this.policy.subtitles,
			this.policy.library,
		);
		this.sources.assertRootEpoch(source.rootEpoch);
		const track = discovered.tracks.find(
			(candidate) => candidate.id === trackId,
		);
		if (!track)
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"The subtitle is unavailable. Refresh the subtitle list.",
			);
		assertSourceVersion(subtitleVersion, track.sourceVersion);
		return this.readExternalSubtitle(source, track, resources);
	}
}
