import { dirname, join } from "node:path";
import type { SubtitleRepository } from "../database/subtitle-repository.js";
import { DomainError } from "../errors.js";
import type { MediaInfo, MediaTools } from "../media/index.js";
import { MediaToolError } from "../media/index.js";
import type { ResolvedPlaybackSource } from "../playback/model.js";
import {
	defaultSubtitleName,
	subtitleTrackId,
} from "../public/subtitle-identity.js";
import {
	preparedSubtitleFormat,
	publicSubtitleFormat,
} from "../public/subtitles.js";
import { ResourceAccess } from "../resources/access.js";
import { readSubtitleText } from "../subtitles/content.js";
import { discoverExternalSubtitles } from "../subtitles/discovery.js";
import type { SubtitleDiscovery } from "../subtitles/model.js";
import type { LibraryApplication } from "./library.js";
import { SubtitlePreparationApplication } from "./subtitle-preparation.js";

/** Subtitle discovery and delivery share source/version access checks. */
export class SubtitleApplication {
	private readonly library: LibraryApplication;
	private readonly tools: Pick<MediaTools, "probe"> | undefined;
	private readonly cache = new Map<string, MediaInfo>();
	private readonly active = new Map<string, Promise<MediaInfo>>();
	private readonly preparation: SubtitlePreparationApplication | undefined;
	private readonly controller = new AbortController();
	constructor(options: {
		library: LibraryApplication;
		tools?: Pick<MediaTools, "probe"> &
			Partial<Pick<MediaTools, "extractSubtitle">>;
		repository?: SubtitleRepository;
		dataDir?: string;
	}) {
		this.library = options.library;
		this.tools = options.tools;
		if (
			options.repository &&
			options.dataDir &&
			options.tools?.extractSubtitle
		) {
			this.preparation = new SubtitlePreparationApplication({
				library: options.library,
				repository: options.repository,
				dataDir: options.dataDir,
				tools: {
					extractSubtitle: options.tools.extractSubtitle.bind(options.tools),
				},
			});
		}
	}
	private get policy() {
		return this.library.policy;
	}
	async close(): Promise<void> {
		this.controller.abort();
		await this.preparation?.close();
		await Promise.allSettled(this.active.values());
		this.cache.clear();
	}
	private async inspect(key: string, path: string): Promise<MediaInfo> {
		const cached = this.cache.get(key);
		if (cached) return cached;
		const pending = this.active.get(key);
		if (pending) return pending;
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
		identity: ResolvedPlaybackSource["identity"],
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
		const source = await this.library.resolvePlaybackSource(id);
		const resources = await ResourceAccess.create(
			this.library.getSettings(),
			this.policy,
		);
		if (
			resources.canonicalRoot !== source.identity.canonicalRoot ||
			source.rootEpoch !== this.library.resourceRootEpoch
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
			source.rootEpoch !== this.library.resourceRootEpoch ||
			current.sourceVersion !== source.identity.sourceVersion
		)
			throw new DomainError(
				"PLAYBACK_CONFLICT",
				"The playback source changed.",
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
		const preparation = this.preparationService();
		const source = await this.library.resolvePlaybackSource(fileId);
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
		return this.preparationService().status(id);
	}
	async getSubtitleAssetContent(id: string) {
		return this.preparationService().content(id);
	}

	async getSubtitleContent(
		id: string,
		trackId: string,
		sourceVersion: string,
		subtitleVersion: string,
	): Promise<{ text: string }> {
		const source = await this.library.resolvePlaybackSource(id);
		if (source.identity.sourceVersion !== sourceVersion)
			throw new DomainError("PLAYBACK_CONFLICT", "The video changed.");
		const resources = await ResourceAccess.create(
			this.library.getSettings(),
			this.policy,
		);
		if (
			source.rootEpoch !== this.library.resourceRootEpoch ||
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
			source.rootEpoch !== this.library.resourceRootEpoch ||
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
