import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileTypeFromFile } from "file-type";
import type { Logger } from "pino";
import { deploymentDefaults } from "../../contracts/defaults.js";
import type { DeepReadonly } from "../../shared/policy.js";
import { captureRuntimeEnvironment } from "../environment.js";
import { detectMediaCapabilities } from "./capabilities.js";
import type { ServerMediaCapabilities } from "./capability-model.js";
import { codecDescriptor } from "./codec-descriptor.js";
import {
	type MediaToolsConfig,
	type MediaToolsPolicy,
	subtitleExtractionPolicy,
} from "./config.js";
import { extractAttachment, extractSubtitle } from "./extraction.js";
import type {
	ExtractedSubtitle,
	MediaContainer,
	MediaInfo,
	SubtitleFormat,
	ToolStatus,
} from "./model.js";
import { parseMediaInfo, probeRecord } from "./probe-parser.js";

export { parseMediaInfo } from "./probe-parser.js";

import { mediaToolPolicy, validateMediaToolPolicy } from "./policy.js";
import { MediaToolError, runTool } from "./process.js";
import { MediaToolDiscovery } from "./tool-discovery.js";

async function localFile(path: string): Promise<void> {
	if (!isAbsolute(path) || path.includes("\0"))
		throw new MediaToolError(
			"INVALID_INPUT",
			"Media input must be an absolute local file path.",
		);
	try {
		if (!(await stat(path)).isFile()) throw new Error("Not a file");
	} catch (cause) {
		throw new MediaToolError(
			"INVALID_INPUT",
			"Media input is not an accessible regular file.",
			{ cause },
		);
	}
}

export class MediaTools {
	private constructor(
		private readonly discovery: MediaToolDiscovery,
		private readonly policy: DeepReadonly<MediaToolsPolicy>,
		private readonly logger?: Logger,
	) {}

	static async create(
		config: MediaToolsConfig = {
			ffmpegPath: deploymentDefaults.ffmpeg,
			ffprobePath: deploymentDefaults.ffprobe,
		},
		policy: DeepReadonly<MediaToolsPolicy> = {
			mediaTools: mediaToolPolicy,
			subtitles: subtitleExtractionPolicy,
		},
		environment = captureRuntimeEnvironment().executableSearch,
		logger?: Logger,
	): Promise<MediaTools> {
		validateMediaToolPolicy(policy.mediaTools);
		const discovery = new MediaToolDiscovery(
			config,
			policy.mediaTools,
			environment,
			logger?.child({ module: "media-tools" }),
		);
		await Promise.all([discovery.get("ffmpeg"), discovery.get("ffprobe")]);
		return new MediaTools(
			discovery,
			policy,
			logger?.child({ module: "media-tools" }),
		);
	}

	get status(): Readonly<{ ffmpeg: ToolStatus; ffprobe: ToolStatus }> {
		return this.discovery.status;
	}

	toolStatus(tool: "ffmpeg" | "ffprobe"): Promise<ToolStatus> {
		return this.discovery.get(tool);
	}

	private async executable(tool: "ffmpeg" | "ffprobe"): Promise<string> {
		const status = await this.toolStatus(tool);
		if (!status.available)
			throw new MediaToolError("TOOL_UNAVAILABLE", status.message);
		return status.path;
	}

	private capabilityInventory: Promise<ServerMediaCapabilities> | undefined;
	private capabilityTools: string | undefined;
	/** Rebuild cached capabilities when a failed tool recovers. */
	async capabilities(): Promise<ServerMediaCapabilities> {
		const [ffmpeg, ffprobe] = await Promise.all([
			this.toolStatus("ffmpeg"),
			this.toolStatus("ffprobe"),
		]);
		const key = JSON.stringify([ffmpeg, ffprobe]);
		if (!this.capabilityInventory || this.capabilityTools !== key) {
			this.capabilityTools = key;
			this.capabilityInventory = detectMediaCapabilities(
				{ ffmpeg, ffprobe },
				this.policy.mediaTools,
				this.logger,
			);
		}
		return structuredClone(await this.capabilityInventory);
	}
	async probe(path: string, signal?: AbortSignal): Promise<MediaInfo> {
		const executable = await this.executable("ffprobe");
		await localFile(path);
		// Signature detection is supplemental; incomplete headers must not suppress FFprobe.
		const detectionTimeout = AbortSignal.timeout(
			this.policy.mediaTools.detectionTimeoutMs,
		);
		const detected = await fileTypeFromFile(path, {
			signal: signal
				? AbortSignal.any([signal, detectionTimeout])
				: detectionTimeout,
		}).catch(() => undefined);
		const containers: Readonly<Record<string, MediaContainer>> = {
			mp4: "mp4",
			mov: "quicktime",
			mkv: "matroska",
			webm: "webm",
		};
		const info = parseMediaInfo(
			await runTool(
				executable,
				[
					"-v",
					"error",
					"-protocol_whitelist",
					"file,pipe",
					"-show_format",
					"-show_streams",
					"-show_chapters",
					"-show_pixel_formats",
					"-of",
					"json",
					"-i",
					path,
				],
				signal ? { signal } : {},
				this.policy.mediaTools,
				this.logger,
			),
			detected ? (containers[detected.ext] ?? null) : null,
		);
		// Probe initialization data for all audio/video streams. Dumping every
		// attachment would copy embedded fonts into the probe output and exhaust its bound.
		for (const stream of info.streams.filter(
			(stream) =>
				["video", "audio"].includes(stream.type) && !stream.attachedPicture,
		)) {
			if (
				!stream ||
				!["h264", "hevc", "aac", "av1"].includes(stream.codec ?? "")
			)
				continue;
			try {
				const data = probeRecord(
					JSON.parse(
						await runTool(
							executable,
							[
								"-v",
								"error",
								"-protocol_whitelist",
								"file,pipe",
								"-select_streams",
								String(stream.index),
								"-show_entries",
								"stream=index,codec_name,codec_tag_string,profile,extradata",
								"-show_data",
								"-of",
								"json",
								"-i",
								path,
							],
							signal ? { signal } : {},
							{
								...this.policy.mediaTools,
								maximumOutputBytes: Math.min(
									this.policy.mediaTools.maximumOutputBytes,
									256 * 1024,
								),
								executionTimeoutMs: Math.min(
									this.policy.mediaTools.executionTimeoutMs,
									5000,
								),
							},
							this.logger,
						),
					),
				);
				if (Array.isArray(data.streams)) {
					const details = data.streams
						.map(probeRecord)
						.find((candidate) => candidate.index === stream.index);
					stream.codecString = details ? codecDescriptor(details) : null;
				}
			} catch {
				signal?.throwIfAborted();
				this.logger?.debug(
					{
						event: "media.codec_description_unavailable",
						streamIndex: stream.index,
					},
					"Exact codec description is unavailable.",
				);
			}
		}
		return info;
	}

	async extractAttachment(
		path: string,
		streamIndex: number,
		options: { maximumBytes: number; signal?: AbortSignal },
	): Promise<Buffer> {
		return extractAttachment(
			{
				executable: (tool) => this.executable(tool),
				probe: (path, signal) => this.probe(path, signal),
				policy: this.policy,
				logger: this.logger,
			},
			path,
			streamIndex,
			options,
		);
	}
	async extractSubtitle(
		path: string,
		streamIndex: number,
		options: { format?: SubtitleFormat; signal?: AbortSignal } = {},
	): Promise<ExtractedSubtitle> {
		return extractSubtitle(
			{
				executable: (tool) => this.executable(tool),
				probe: (path, signal) => this.probe(path, signal),
				policy: this.policy,
				logger: this.logger,
			},
			path,
			streamIndex,
			options,
		);
	}
}
