import type { Logger } from "pino";
import { preparedSubtitleFormat } from "../../../../contracts/subtitles.js";
import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { ResourceAccessApi } from "../../../resources/public.js";
import { assertSourceVersion } from "../../../resources/public.js";
import { subtitleTrackId } from "../domain/identity.js";
import type {
	SubtitleDiscovery,
	SubtitlePreparationResult,
} from "../domain/model.js";
import { discoverExternalSubtitles } from "../infrastructure/discovery.js";
import type { SubtitleRuntimePolicy } from "../policy.js";
import type { SubtitleApi } from "../public.js";
import type { SubtitleDiscoveryService } from "./discovery.js";
import { readExternalSubtitle } from "./external-content.js";
import type { SubtitleFontPreparation } from "./font-preparation.js";
import type { SubtitlePreparationApplication } from "./subtitle-preparation.js";

/** Subtitle discovery and delivery share source/version access checks. */
export class SubtitleApplication implements SubtitleApi {
	private readonly logger: Logger | undefined;
	private readonly sources: ResourceAccessApi;
	private readonly discovery: SubtitleDiscoveryService;
	private readonly fonts: SubtitleFontPreparation | undefined;
	private readonly preparation: SubtitlePreparationApplication | undefined;
	constructor(options: {
		logger?: Logger;
		sources: ResourceAccessApi;
		policy: DeepReadonly<SubtitleRuntimePolicy>;
		discovery: SubtitleDiscoveryService;
		fonts?: SubtitleFontPreparation;
		preparation?: SubtitlePreparationApplication;
	}) {
		this.logger = options.logger;
		this.sources = options.sources;
		this.policy = options.policy;
		this.discovery = options.discovery;
		this.fonts = options.fonts;
		this.preparation = options.preparation;
	}
	private readonly policy: DeepReadonly<SubtitleRuntimePolicy>;
	async close(): Promise<void> {
		await Promise.allSettled([this.preparation?.close(), this.fonts?.close()]);
	}

	async discoverSubtitles(id: string): Promise<SubtitleDiscovery> {
		const started = Date.now();
		this.logger?.debug(
			{ event: "subtitles.discovery_started", fileId: id },
			"Subtitle discovery started.",
		);
		const source = await this.sources.resolveSource(id);
		const { discovery } = await this.discovery.discoverForSource(source);
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
		await this.fonts?.initialize().catch((err) => {
			this.logger?.warn(
				{ event: "subtitles.font_cache_unavailable", err },
				"Font cache unavailable; fallback fonts remain usable.",
			);
		});
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
		const { discovery, resources, info } =
			await this.discovery.discoverForSource(source);
		const track = discovery.tracks.find((track) => track.id === trackId);
		if (!track)
			throw new DomainError("RESOURCE_NOT_FOUND", "Unknown subtitle track.");
		if (track.origin === "external") {
			assertSourceVersion(subtitleVersion ?? "", track.sourceVersion);
			await readExternalSubtitle(
				this.sources,
				this.policy,
				source,
				track,
				resources,
			);
			const fonts =
				track.format === "ass" || track.format === "ssa"
					? await this.fonts?.prepare(source, info)
					: undefined;
			return {
				...(fonts ? { fonts } : {}),
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
			source.identity.scopeId,
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
		const fonts =
			track.format === "ass" || track.format === "ssa"
				? await this.fonts?.prepare(source, info)
				: undefined;
		const result = await this.preparationService().prepare(
			source,
			trackId,
			stream.index,
			preparedSubtitleFormat(track.format),
		);
		return { ...result, ...(fonts ? { fonts } : {}) };
	}
	async getSubtitleFontStatus(id: string) {
		if (!this.fonts)
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"Font preparation unavailable.",
			);
		return this.fonts.status(id);
	}
	async getSubtitleFontContent(id: string, fontId: string) {
		if (!this.fonts)
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"Font preparation unavailable.",
			);
		return this.fonts.content(id, fontId);
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
		const source = await this.sources.resolveSource(id, sourceVersion);
		const resources = await this.sources.openResources(source);
		const discovered = await discoverExternalSubtitles(
			resources,
			source.identity.relativePath,
			sourceVersion,
			this.policy.subtitles,
			this.policy.library,
		);
		this.sources.assertAccessRevision(source.accessRevision);
		const track = discovered.tracks.find(
			(candidate) => candidate.id === trackId,
		);
		if (!track)
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"The subtitle is unavailable. Refresh the subtitle list.",
			);
		assertSourceVersion(subtitleVersion, track.sourceVersion);
		return readExternalSubtitle(
			this.sources,
			this.policy,
			source,
			track,
			resources,
		);
	}
}
