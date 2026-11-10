import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { Logger } from "pino";
import { Check } from "typebox/value";
import {
	TranscodeAudioSchema,
	TranscodeVideoSchema,
} from "../../contracts/schemas/transcode-profiles.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type { EncodingOptions } from "./encoding.js";
import {
	filterName,
	legacyAudio,
	legacyVideo,
	type OptionScope,
	validateEncodingOptions,
	validEncodingOptions,
} from "./encoding-policy.js";
import { MediaOutputBudgetError, MediaToolError } from "./errors.js";
import type { MediaInfo, MediaProcessingOptions, ToolStatus } from "./model.js";
import { type MediaToolPolicy, mediaToolPolicy } from "./policy.js";
import { startMediaProcess } from "./processing-process.js";

/** Compile scoped options without a shell; input/output ownership remains with the application. */
export function compileFfmpegArguments(
	input: string,
	output: string,
	options: MediaProcessingOptions,
	info?: MediaInfo,
): string[] {
	const { plan } = options;
	const invalid = (message: string): never => {
		throw new MediaToolError("INVALID_INPUT", message);
	};
	if (
		![input, output].every((p) => isAbsolute(p) && !p.includes("\0")) ||
		input === output ||
		!Number.isSafeInteger(options.maximumBytes) ||
		options.maximumBytes <= 0 ||
		!Number.isSafeInteger(options.videoStreamIndex) ||
		options.videoStreamIndex < 0 ||
		!Array.isArray(options.audioStreamIndices) ||
		new Set(options.audioStreamIndices).size !==
			options.audioStreamIndices.length ||
		options.audioStreamIndices.some((i) => !Number.isSafeInteger(i) || i < 0)
	)
		invalid("Invalid FFmpeg paths, stream selection or output budget.");
	if (!["mp4", "mov", "matroska", "webm"].includes(plan.container))
		invalid("Unsupported FFmpeg delivery container.");
	try {
		const needed = [
			...(plan.video.action === "encode"
				? [
						"buffer",
						"buffersink",
						"null",
						"scale",
						...(plan.videoFilters ?? []).map(filterName),
					]
				: []),
			...(options.audioStreamIndices.length &&
			(plan.audio.action === "encode" ||
				plan.audioTracks?.some((t) => t.execution.action === "encode"))
				? [
						"abuffer",
						"abuffersink",
						"aresample",
						"aformat",
						"anull",
						...(plan.audioParameters?.filters ?? []).map(filterName),
						...(plan.audioTracks ?? []).flatMap((t) =>
							(t.parameters?.filters ?? []).map(filterName),
						),
					]
				: []),
		];
		if (needed.some((name) => !plan.filters.includes(name)))
			invalid("Execution plan omits required filters.");
	} catch {
		invalid("Execution plan contains invalid or missing filters.");
	}
	const args = [
		"-nostdin",
		"-hide_banner",
		"-v",
		"error",
		"-n",
		"-progress",
		"pipe:1",
		"-nostats",
	];
	const append = (
		values: DeepReadonly<EncodingOptions> | undefined,
		scope: OptionScope,
		suffix = "",
	) => {
		try {
			validateEncodingOptions(values, scope);
		} catch {
			invalid("Invalid or reserved FFmpeg options.");
		}
		for (const [key, value] of Object.entries(values ?? {})) {
			args.push(`-${key}${suffix}`);
			if (value !== null) args.push(String(value));
		}
	};
	append(plan.globalOptions, "global");
	append(plan.inputOptions, "input");
	args.push(
		"-protocol_whitelist",
		"file,pipe",
		"-i",
		input,
		"-map",
		`0:${options.videoStreamIndex}`,
		"-map_metadata",
		plan.preserveSubtitles ? "0" : "-1",
		"-map_chapters",
		plan.preserveSubtitles ? "0" : "-1",
		"-dn",
	);
	if (plan.preserveSubtitles)
		args.push("-map", "0:s?", "-map", "0:t?", "-c:s", "copy", "-c:t", "copy");
	else args.push("-sn");

	if (plan.preserveSubtitles) {
		args.push("-map_metadata:s:v:0", `0:s:${options.videoStreamIndex}`);
		for (const type of ["subtitle", "attachment"]) {
			for (const [position, stream] of (
				info?.streams.filter((s) => s.type === type) ?? []
			).entries()) {
				const spec = type === "subtitle" ? "s" : "t";
				args.push(`-map_metadata:s:${spec}:${position}`, `0:s:${stream.index}`);
				if (type === "subtitle")
					args.push(
						`-disposition:s:${position}`,
						[stream.default ? "default" : "", stream.forced ? "forced" : ""]
							.filter(Boolean)
							.join("+") || "0",
					);
			}
		}
	}

	if (plan.video.action === "copy") {
		if (plan.videoParameters || plan.videoFilters?.length || plan.h264Level)
			invalid("Copied video cannot have encoding settings.");
		args.push("-c:v", "copy");
	} else {
		const raw = plan.videoParameters;
		const video =
			raw &&
			(plan.compilerVersion === 2
				? raw
				: legacyVideo(raw as unknown as Record<string, unknown>));
		if (
			!video ||
			!Check(TranscodeVideoSchema, video) ||
			video.encoder !== plan.video.encoder ||
			video.codec !== plan.video.codec ||
			video.pixelFormat !== plan.video.pixelFormat ||
			!validEncodingOptions(video, { encoder: "copy", codec: "" })
		)
			invalid("Video encoding requires matching parameters.");
		if (video) {
			args.push("-c:v", video.encoder);
			append(video.options, "video", ":v");
			if (video.pixelFormat) args.push("-pix_fmt:v", video.pixelFormat);
			if (plan.h264Level)
				args.push("-profile:v", "high", "-level:v", plan.h264Level);
			if (plan.videoFilters?.length)
				args.push("-vf", plan.videoFilters.join(","));
		}
	}
	if (
		plan.audioTracks &&
		(plan.audioTracks.length !== options.audioStreamIndices.length ||
			plan.audioTracks.some(
				(t, i) => t.sourceIndex !== options.audioStreamIndices[i],
			))
	)
		invalid("Audio plan selection is inconsistent.");
	if (!options.audioStreamIndices.length) args.push("-an");
	options.audioStreamIndices.forEach((index, position) => {
		args.push(
			"-map",
			`0:${index}`,
			`-map_metadata:s:a:${position}`,
			`0:s:${index}`,
		);
		const track = plan.audioTracks?.[position];
		const action = track?.execution ?? plan.audio;
		const raw = track ? track.parameters : plan.audioParameters;
		const suffix = `:a:${position}`;
		if (action.action === "copy") {
			if (raw) invalid("Copied audio cannot have encoding settings.");
			args.push(`-c${suffix}`, "copy");
		} else {
			const audio =
				raw &&
				(plan.compilerVersion === 2
					? raw
					: legacyAudio(raw as unknown as Record<string, unknown>));
			if (
				!audio ||
				!Check(TranscodeAudioSchema, audio) ||
				audio.encoder !== action.encoder ||
				audio.codec !== action.codec ||
				!validEncodingOptions({ encoder: "copy", codec: "" }, audio)
			)
				invalid("Audio encoding requires matching parameters.");
			if (audio) {
				args.push(`-c${suffix}`, audio.encoder);
				append(audio.options, "audio", suffix);
				if (audio.channels) args.push(`-ac${suffix}`, String(audio.channels));
				if (audio.sampleRate)
					args.push(`-ar${suffix}`, String(audio.sampleRate));
				const filters = [
					...(audio.filters ?? []),
					...(audio.sampleRate ? [`aresample=${audio.sampleRate}`] : []),
				];
				if (audio.channels)
					filters.push(`aformat=channel_layouts=${audio.channels}c`);
				if (filters.length) args.push(`-filter${suffix}`, filters.join(","));
			}
		}
		if (track)
			args.push(`-disposition:a:${position}`, track.default ? "default" : "0");
	});
	if (plan.delivery === "media-source") {
		if (plan.container !== "mp4" || plan.muxerOptions?.movflags !== undefined)
			invalid("Fragmented delivery requires application-owned MP4 packaging.");
		args.push("-movflags", "+frag_keyframe+empty_moov+default_base_moof");
	} else if (plan.delivery !== undefined && plan.delivery !== "file")
		invalid("Invalid delivery target.");
	else if (
		(plan.container === "mp4" || plan.container === "mov") &&
		plan.muxerOptions?.movflags === undefined
	)
		args.push("-movflags", "+faststart");
	append(plan.muxerOptions, "muxer");
	args.push("-fs", String(options.maximumBytes), "-f", plan.container, output);
	return args;
}

/** Local complete-file adapter. Publication and source checks belong to the application. */
export class FfmpegExecutionAdapter {
	constructor(
		private readonly ffmpeg: () => Promise<ToolStatus>,
		private readonly policy: DeepReadonly<MediaToolPolicy> = mediaToolPolicy,
		private readonly logger?: Logger,
	) {}
	async execute(
		input: string,
		output: string,
		options: MediaProcessingOptions,
		info: MediaInfo,
	): Promise<void> {
		const ffmpeg = await this.ffmpeg();
		if (!ffmpeg.available)
			throw new MediaToolError("TOOL_UNAVAILABLE", ffmpeg.message);
		if (!isAbsolute(ffmpeg.path))
			throw new MediaToolError(
				"INVALID_INPUT",
				"FFmpeg must be a resolved executable.",
			);
		options.signal?.throwIfAborted();
		if (!(await stat(input)).isFile())
			throw new MediaToolError(
				"INVALID_INPUT",
				"FFmpeg input must be a regular file.",
			);
		const args = compileFfmpegArguments(input, output, options, info);
		const child = startMediaProcess(
			ffmpeg.path,
			args,
			{
				...(options.signal ? { signal: options.signal } : {}),
				timeoutMs: options.timeoutMs,
				durationMs:
					info.duration && info.duration > 0 ? info.duration * 1000 : null,
				...(options.onEvent ? { onEvent: options.onEvent } : {}),
			},
			this.policy,
			this.logger,
		);
		await child.completion;
		options.signal?.throwIfAborted();
		const size = (await stat(output)).size;
		if (size >= options.maximumBytes) throw new MediaOutputBudgetError();
		if (size <= 0)
			throw new MediaToolError(
				"TOOL_FAILED",
				"FFmpeg output is empty or exceeds the output budget.",
			);
	}
}
