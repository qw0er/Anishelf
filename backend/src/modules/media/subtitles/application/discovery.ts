import type { Logger } from "pino";
import { publicSubtitleFormat } from "../../../../contracts/subtitles.js";
import type { MediaInfo } from "../../../../platform/media/index.js";
import { MediaToolError } from "../../../../platform/media/index.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type {
	ResolvedSource,
	ResourceAccessApi,
	ResourceFiles,
} from "../../../resources/public.js";
import {
	type MediaInspectionApi,
	MediaInspectionBusyError,
} from "../../media-inspection/public.js";
import { defaultSubtitleName, subtitleTrackId } from "../domain/identity.js";
import type { SubtitleDiscovery } from "../domain/model.js";
import { discoverExternalSubtitles } from "../infrastructure/discovery.js";
import type { SubtitleRuntimePolicy } from "../policy.js";

export class SubtitleDiscoveryService {
	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			inspection?: MediaInspectionApi;
			policy: DeepReadonly<SubtitleRuntimePolicy>;
			logger?: Logger;
		},
	) {}
	private get sources() {
		return this.options.sources;
	}
	private get inspection() {
		return this.options.inspection;
	}
	private get policy() {
		return this.options.policy;
	}
	private get logger() {
		return this.options.logger;
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
			identity.scopeId,
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
	async discoverForSource(source: ResolvedSource): Promise<{
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
		this.sources.assertAccessRevision(source.accessRevision);
		const embedded = await this.discoverEmbedded(
			source.identity,
			source.file.name,
		);
		// Successful inspection already validated this video after external discovery.
		// Busy, unavailable and external-only discovery still need an end-of-operation check.
		if (!embedded.info) await this.sources.revalidateSource(source);
		this.sources.assertAccessRevision(source.accessRevision);
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
}
