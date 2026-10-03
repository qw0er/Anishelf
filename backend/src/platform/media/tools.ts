import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { deploymentDefaults } from "../../contracts/defaults.js";
import { preparedSubtitleFormats } from "../../contracts/subtitles.js";
import type { MediaToolsConfig } from "../../modules/configuration/public.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	captureRuntimeEnvironment,
	type DeepReadonly,
} from "../../modules/configuration/public.js";
import type {
	ExtractedSubtitle,
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
	return typeof value === "string" ? value : null;
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
export function parseMediaInfo(json: string): MediaInfo {
	try {
		const root = record(JSON.parse(json));
		const format = record(root.format);
		if (!Array.isArray(root.streams)) throw new Error("Missing streams");
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
			return {
				index,
				type: stream.codec_type,
				codec: text(stream.codec_name),
				profile: text(stream.profile),
				width: number(stream.width),
				height: number(stream.height),
				pixelFormat: text(stream.pix_fmt),
				frameRate: text(stream.avg_frame_rate),
				sampleRate: number(stream.sample_rate),
				channels: number(stream.channels),
				channelLayout: text(stream.channel_layout),
				duration: number(stream.duration),
				bitRate: number(stream.bit_rate),
				tags: tags(stream.tags),
				default: disposition.default === 1,
				forced: disposition.forced === 1,
			};
		});
		return {
			format: text(format.format_name),
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
		private readonly policy: DeepReadonly<BuiltinPolicy>,
	) {}

	static async create(
		config: MediaToolsConfig = {
			ffmpegPath: deploymentDefaults.ffmpeg,
			ffprobePath: deploymentDefaults.ffprobe,
		},
		policy: DeepReadonly<BuiltinPolicy> = builtinPolicy,
		environment = captureRuntimeEnvironment().executableSearch,
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
						timeoutMs: policy.media.detectionTimeoutMs,
						maxBytes: policy.media.detectionMaximumBytes,
					},
					policy.media,
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
		return new MediaTools({ ffmpeg, ffprobe }, policy);
	}

	private executable(tool: "ffmpeg" | "ffprobe"): string {
		const status = this.status[tool];
		if (!status.available)
			throw new MediaToolError("TOOL_UNAVAILABLE", status.message);
		return status.path;
	}

	/** Trusted backend API: caller must enforce resource-root access before use. */
	async probe(path: string, signal?: AbortSignal): Promise<MediaInfo> {
		const executable = this.executable("ffprobe");
		await localFile(path);
		return parseMediaInfo(
			await runTool(
				executable,
				[
					"-v",
					"error",
					"-protocol_whitelist",
					"file,pipe",
					"-show_format",
					"-show_streams",
					"-of",
					"json",
					"-i",
					path,
				],
				signal ? { signal } : {},
				this.policy.media,
			),
		);
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
				timeoutMs: this.policy.media.extractionTimeoutMs,
				...(options.signal ? { signal: options.signal } : {}),
			},
			this.policy.media,
		);
		return { streamIndex, format, text: output };
	}
}
