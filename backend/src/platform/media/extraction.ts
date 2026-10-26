import { isAbsolute } from "node:path";
import type { Logger } from "pino";
import { preparedSubtitleFormats } from "../../contracts/subtitles.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type { MediaToolsPolicy } from "./config.js";
import type { ExtractedSubtitle, MediaInfo, SubtitleFormat } from "./model.js";
import { MediaToolError, runTool } from "./process.js";

interface ExtractionTools {
	executable(tool: "ffmpeg" | "ffprobe"): Promise<string>;
	policy: DeepReadonly<MediaToolsPolicy>;
	probe(path: string, signal?: AbortSignal): Promise<MediaInfo>;
	logger: Logger | undefined;
}
/** Bounded attachment extradata only; ordinary inspection never dumps attachments. */
export async function extractAttachment(
	dependencies: ExtractionTools,
	path: string,
	streamIndex: number,
	options: {
		maximumBytes: number;
		signal?: AbortSignal;
	},
): Promise<Buffer> {
	if (
		!isAbsolute(path) ||
		!Number.isSafeInteger(streamIndex) ||
		streamIndex < 0 ||
		!Number.isSafeInteger(options.maximumBytes) ||
		options.maximumBytes < 1
	)
		throw new MediaToolError("INVALID_INPUT", "Invalid attachment request.");
	const output = JSON.parse(
		await runTool(
			await dependencies.executable("ffprobe"),
			[
				"-v",
				"error",
				"-protocol_whitelist",
				"file,pipe",
				"-select_streams",
				String(streamIndex),
				"-show_entries",
				"stream=index,codec_type,extradata,extradata_size",
				"-show_data",
				"-of",
				"json",
				"-i",
				path,
			],
			{
				...options,
				timeoutMs: dependencies.policy.subtitles.extractionTimeoutMs,
				maxBytes: options.maximumBytes * 5 + 4096,
			},
			dependencies.policy.mediaTools,
			dependencies.logger,
		),
	);
	const stream = output.streams?.[0];
	if (
		stream?.index !== streamIndex ||
		stream.codec_type !== "attachment" ||
		typeof stream.extradata !== "string" ||
		stream.extradata_size > options.maximumBytes
	)
		throw new MediaToolError(
			"INVALID_MEDIA",
			"Invalid or oversized attachment.",
		);
	const hex = stream.extradata
		.split("\n")
		.flatMap((line: string) => {
			const match = /^[0-9a-f]{8}: ([0-9a-f ]+?)(?: {2}|$)/i.exec(line.trim());
			return match?.[1]?.replaceAll(" ", "") ?? [];
		})
		.join("");
	const bytes = Buffer.from(hex, "hex");
	if (
		!bytes.length ||
		bytes.length > options.maximumBytes ||
		bytes.length !== stream.extradata_size
	)
		throw new MediaToolError("INVALID_MEDIA", "Invalid attachment payload.");
	return bytes;
}

/** Select by absolute FFprobe stream index, never by a raw selector. */
export async function extractSubtitle(
	dependencies: ExtractionTools,
	path: string,
	streamIndex: number,
	options: { format?: SubtitleFormat; signal?: AbortSignal } = {},
): Promise<ExtractedSubtitle> {
	const executable = await dependencies.executable("ffmpeg");
	if (!Number.isSafeInteger(streamIndex) || streamIndex < 0)
		throw new MediaToolError(
			"INVALID_INPUT",
			"Subtitle stream index must be a non-negative integer.",
		);
	const info = await dependencies.probe(path, options.signal);
	const stream = info.streams.find(
		(candidate) =>
			candidate.index === streamIndex && candidate.type === "subtitle",
	);
	if (!stream)
		throw new MediaToolError(
			"INVALID_INPUT",
			"Selected stream is not a subtitle track.",
		);
	const native =
		dependencies.policy.subtitles.nativeFormats[stream.codec ?? ""];
	const format = options.format ?? native;
	if (
		!format ||
		!preparedSubtitleFormats.includes(format) ||
		!dependencies.policy.subtitles.textCodecs.includes(stream.codec ?? "")
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
			timeoutMs: dependencies.policy.subtitles.extractionTimeoutMs,
			...(options.signal ? { signal: options.signal } : {}),
		},
		dependencies.policy.mediaTools,
		dependencies.logger,
	);
	return { streamIndex, format, text: output };
}
