import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileTypeFromFile } from "file-type";
import type { Logger } from "pino";
import { deploymentDefaults } from "../../contracts/defaults.js";
import { preparedSubtitleFormats } from "../../contracts/subtitles.js";
import type { ServerMediaCapabilities } from "../../shared/media-capabilities.js";
import type { DeepReadonly } from "../../shared/policy.js";
import { captureRuntimeEnvironment } from "../environment.js";
import { detectMediaCapabilities } from "./capabilities.js";
import { codecDescriptor } from "./codec-descriptor.js";
import {
	type MediaToolsConfig,
	type SubtitleExtractionPolicy,
	subtitleExtractionPolicy,
} from "./config.js";
import { type MediaToolPolicy, mediaToolPolicy } from "./policy.js";

export interface MediaToolsPolicy {
	mediaTools: MediaToolPolicy;
	subtitles: SubtitleExtractionPolicy;
}

import type {
	ExtractedSubtitle,
	HdrSideData,
	MediaContainer,
	MediaInfo,
	MediaStream,
	SubtitleFormat,
	ToolStatus,
} from "./model.js";
import { MediaToolError, resolveExecutable, runTool } from "./process.js";

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new MediaToolError(
			"INVALID_MEDIA",
			"FFprobe returned an invalid media descriptor.",
		);
	return value as Record<string, unknown>;
}
function text(value: unknown): string | null {
	return typeof value === "string" &&
		value.trim() !== "" &&
		!/^(N\/A|unknown|unspecified)$/i.test(value)
		? value
		: null;
}
function number(value: unknown): number | null {
	if (typeof value !== "number" && typeof value !== "string") return null;
	if (value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function tags(value: unknown): Record<string, string> {
	if (value === undefined) return {};
	return Object.fromEntries(
		Object.entries(record(value)).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}
function rate(value: unknown): {
	frameRate: string | null;
	framesPerSecond: number | null;
} {
	const raw = text(value);
	const parts = raw?.match(/^(\d+)\/(\d+)$/);
	const fps = parts ? Number(parts[1]) / Number(parts[2]) : null;
	return fps !== null && Number.isFinite(fps) && fps > 0
		? { frameRate: raw, framesPerSecond: fps }
		: { frameRate: null, framesPerSecond: null };
}
export function parseMediaInfo(
	json: string,
	container: MediaContainer | null = null,
): MediaInfo {
	try {
		const root = record(JSON.parse(json));
		const format = record(root.format);
		if (!Array.isArray(root.streams)) throw new Error("Missing streams");
		const pixelDepths = new Map<string, number>();
		if (Array.isArray(root.pixel_formats)) {
			for (const value of root.pixel_formats) {
				const pixel = record(value);
				if (typeof pixel.name !== "string" || !Array.isArray(pixel.components))
					continue;
				const depths = pixel.components.map((component) =>
					number(record(component).bit_depth),
				);
				if (
					depths.length &&
					depths.every((depth): depth is number => depth !== null && depth > 0)
				)
					pixelDepths.set(pixel.name, Math.max(...depths));
			}
		}
		const streams: MediaStream[] = root.streams.map((value) => {
			const stream = record(value);
			const index = number(stream.index);
			if (
				index === null ||
				!Number.isSafeInteger(index) ||
				typeof stream.codec_type !== "string"
			)
				throw new Error("Invalid stream");
			const disposition =
				stream.disposition === undefined ? {} : record(stream.disposition);
			const sideData: HdrSideData[] = [];
			if (Array.isArray(stream.side_data_list)) {
				for (const value of stream.side_data_list) {
					const data = record(value);
					const type = text(data.side_data_type);
					if (
						!type ||
						!/mastering display|content light|dovi|dolby vision|smpte2094|hdr/i.test(
							type,
						)
					)
						continue;
					const values: Record<string, number | string> = {};
					for (const [key, value] of Object.entries(data)) {
						if (
							!/^(red_x|red_y|green_x|green_y|blue_x|blue_y|white_point_x|white_point_y|min_luminance|max_luminance|max_content|max_average|dv_version_major|dv_version_minor|dv_profile|dv_level|rpu_present_flag|el_present_flag|bl_present_flag|dv_bl_signal_compatibility_id)$/.test(
								key,
							)
						)
							continue;
						if (
							typeof value === "number" &&
							Number.isFinite(value) &&
							value >= 0
						)
							values[key] = value;
						else if (
							typeof value === "string" &&
							/^\d+(?:\.\d+|\/[1-9]\d*)?$/.test(value)
						)
							values[key] = value;
					}
					sideData.push({ type, values });
				}
			}
			const sideDataTypes = [...new Set(sideData.map((data) => data.type))];
			const rawDepth = number(stream.bits_per_raw_sample);
			return {
				index,
				type: stream.codec_type,
				codec: text(stream.codec_name),
				codecTag: text(stream.codec_tag_string),
				codecString: codecDescriptor(stream),
				profile: text(stream.profile),
				level: number(stream.level),
				bitDepth:
					stream.codec_type === "video"
						? rawDepth && rawDepth > 0
							? rawDepth
							: (pixelDepths.get(text(stream.pix_fmt) ?? "") ?? null)
						: null,
				colorRange: text(stream.color_range),
				colorSpace: text(stream.color_space),
				colorTransfer: text(stream.color_transfer),
				colorPrimaries: text(stream.color_primaries),
				hdr: {
					pq: stream.color_transfer === "smpte2084",
					hlg: stream.color_transfer === "arib-std-b67",
					sideDataTypes,
					sideData,
				},
				attachedPicture: number(disposition.attached_pic) === 1,
				width: number(stream.width),
				height: number(stream.height),
				pixelFormat: text(stream.pix_fmt),
				...rate(stream.avg_frame_rate),
				sampleRate: number(stream.sample_rate),
				channels: number(stream.channels),
				channelLayout: text(stream.channel_layout),
				duration: number(stream.duration),
				bitRate: number(stream.bit_rate),
				tags: tags(stream.tags),
				default: number(disposition.default) === 1,
				forced: number(disposition.forced) === 1,
			};
		});
		return {
			format: text(format.format_name),
			formatAliases: [
				...new Set(
					(text(format.format_name) ?? "")
						.split(",")
						.map((name) => name.trim().toLowerCase())
						.filter(Boolean),
				),
			],
			container,
			duration: number(format.duration),
			size: number(format.size),
			bitRate: number(format.bit_rate),
			tags: tags(format.tags),
			streams,
		};
	} catch (cause) {
		throw new MediaToolError(
			"INVALID_MEDIA",
			"FFprobe returned invalid media information.",
			{ cause },
		);
	}
}

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
		readonly status: Readonly<{ ffmpeg: ToolStatus; ffprobe: ToolStatus }>,
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
		async function discover(
			command: string,
			tool: string,
		): Promise<ToolStatus> {
			try {
				const path = await resolveExecutable(command, environment);
				const output = await runTool(
					path,
					["-version"],
					{
						timeoutMs: policy.mediaTools.detectionTimeoutMs,
						maxBytes: policy.mediaTools.detectionMaximumBytes,
					},
					policy.mediaTools,
					logger,
				);
				const version = output.split(/\r?\n/)[0] ?? "";
				if (!version.startsWith(`${tool} version `))
					throw new Error("Unexpected executable");
				return { available: true, path, version };
			} catch {
				return {
					available: false,
					message: `Cannot run ${tool} at ${command}. Install the tool or check PATH / ANISHELF_${tool.toUpperCase()}_PATH, then restart.`,
				};
			}
		}
		const [ffmpeg, ffprobe] = await Promise.all([
			discover(config.ffmpegPath, "ffmpeg"),
			discover(config.ffprobePath, "ffprobe"),
		]);
		return new MediaTools(
			{ ffmpeg, ffprobe },
			policy,
			logger?.child({ module: "media-tools" }),
		);
	}

	private executable(tool: "ffmpeg" | "ffprobe"): string {
		const status = this.status[tool];
		if (!status.available)
			throw new MediaToolError("TOOL_UNAVAILABLE", status.message);
		return status.path;
	}

	private capabilityInventory: Promise<ServerMediaCapabilities> | undefined;
	/** Enumerate once per service lifetime; callers receive isolated snapshots. */
	async capabilities(): Promise<ServerMediaCapabilities> {
		this.capabilityInventory ??= detectMediaCapabilities(
			this.status,
			this.policy.mediaTools,
			this.logger,
		);
		return structuredClone(await this.capabilityInventory);
	}
	async probe(path: string, signal?: AbortSignal): Promise<MediaInfo> {
		const executable = this.executable("ffprobe");
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
				const data = record(
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
						.map(record)
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

	/** Select by absolute FFprobe stream index, never by a raw selector. */
	async extractSubtitle(
		path: string,
		streamIndex: number,
		options: { format?: SubtitleFormat; signal?: AbortSignal } = {},
	): Promise<ExtractedSubtitle> {
		const executable = this.executable("ffmpeg");
		if (!Number.isSafeInteger(streamIndex) || streamIndex < 0)
			throw new MediaToolError(
				"INVALID_INPUT",
				"Subtitle stream index must be a non-negative integer.",
			);
		const info = await this.probe(path, options.signal);
		const stream = info.streams.find(
			(candidate) =>
				candidate.index === streamIndex && candidate.type === "subtitle",
		);
		if (!stream)
			throw new MediaToolError(
				"INVALID_INPUT",
				"Selected stream is not a subtitle track.",
			);
		const native = this.policy.subtitles.nativeFormats[stream.codec ?? ""];
		const format = options.format ?? native;
		if (
			!format ||
			!preparedSubtitleFormats.includes(format) ||
			!this.policy.subtitles.textCodecs.includes(stream.codec ?? "")
		)
			throw new MediaToolError(
				"UNSUPPORTED_SUBTITLE",
				"Subtitle codec or output format is unsupported. Bitmap subtitles require a separate extraction path; mov_text/text require an explicit output format.",
			);
		const codec = format === native ? "copy" : format;
		const output = await runTool(
			executable,
			[
				"-nostdin",
				"-hide_banner",
				"-v",
				"error",
				"-protocol_whitelist",
				"file,pipe",
				"-i",
				path,
				"-map",
				`0:${streamIndex}`,
				"-c:s",
				codec,
				"-f",
				format,
				"pipe:1",
			],
			{
				timeoutMs: this.policy.subtitles.extractionTimeoutMs,
				...(options.signal ? { signal: options.signal } : {}),
			},
			this.policy.mediaTools,
			this.logger,
		);
		return { streamIndex, format, text: output };
	}
}
