import { MediaToolError } from "../../../../platform/media/errors.js";
import type {
	MediaInfo,
	MediaStream,
} from "../../../../platform/media/model.js";
import { type DeepReadonly, freeze } from "../../../../shared/policy.js";
import type { expectedOutputSpec } from "../../media-planning/public.js";
import type { MediaExecutionRequest } from "../ports.js";

export function validateExecutionRequest(request: MediaExecutionRequest) {
	if (
		request.maximumBytes !== undefined &&
		(!Number.isSafeInteger(request.maximumBytes) || request.maximumBytes <= 0)
	)
		throw new MediaToolError(
			"INVALID_INPUT",
			"Invalid execution output budget.",
		);
	const plan = freeze(structuredClone(request.plan));
	if (
		typeof plan.id !== "string" ||
		!plan.id ||
		typeof plan.container !== "string" ||
		!plan.container ||
		typeof plan.outputFormat !== "string" ||
		!plan.outputFormat ||
		!Array.isArray(plan.filters) ||
		!plan.filters.every(
			(filter) => typeof filter === "string" && filter.length > 0,
		) ||
		![plan.video, plan.audio].every(
			(stream) =>
				stream?.action === "copy" ||
				(stream?.action === "encode" &&
					typeof stream.encoder === "string" &&
					stream.encoder.length > 0 &&
					typeof stream.codec === "string" &&
					stream.codec.length > 0 &&
					(stream.pixelFormat === undefined ||
						(typeof stream.pixelFormat === "string" &&
							stream.pixelFormat.length > 0))),
		)
	)
		throw new MediaToolError(
			"INVALID_INPUT",
			"Invalid explicit execution requirements.",
		);
	if (
		!Number.isSafeInteger(request.videoStreamIndex) ||
		request.videoStreamIndex < 0 ||
		!Array.isArray(request.audioStreamIndices) ||
		new Set(request.audioStreamIndices).size !==
			request.audioStreamIndices.length ||
		request.audioStreamIndices.some(
			(index) => !Number.isSafeInteger(index) || index < 0,
		)
	)
		throw new MediaToolError(
			"INVALID_INPUT",
			"Invalid explicit execution selection.",
		);
	return { ...request, plan };
}

export function validateProcessedMedia(
	output: MediaInfo,
	info: MediaInfo,
	video: MediaStream,
	selectedAudios: MediaStream[],
	plan: DeepReadonly<MediaExecutionRequest["plan"]>,
	expected: ReturnType<typeof expectedOutputSpec>,
	durationToleranceSeconds: number,
): void {
	const videos = output.streams.filter((stream) => stream.type === "video");
	const audios = output.streams.filter((stream) => stream.type === "audio");
	if (
		videos.length !== 1 ||
		audios.length !== selectedAudios.length ||
		videos[0]?.codec !== expected.video.codec ||
		selectedAudios.some(
			(_audio, index) => audios[index]?.codec !== expected.audios[index]?.codec,
		) ||
		!output.formatAliases.includes(plan.outputFormat)
	)
		throw new MediaToolError(
			"TOOL_FAILED",
			"Output does not match explicit execution requirements.",
		);
	if (
		(expected.video.width !== null &&
			videos[0]?.width !== expected.video.width) ||
		(expected.video.height !== null &&
			videos[0]?.height !== expected.video.height) ||
		(expected.video.pixelFormat !== null &&
			videos[0]?.pixelFormat !== expected.video.pixelFormat) ||
		expected.audios.some(
			(audio, index) =>
				audio.channels !== null && audios[index]?.channels !== audio.channels,
		) ||
		(plan.h264Level && videos[0]?.codecString !== expected.video.codecString)
	)
		throw new MediaToolError(
			"TOOL_FAILED",
			"Output does not match encoding constraints.",
		);
	const before = video.duration ?? info.duration;
	const after = videos[0]?.duration ?? output.duration;
	if (
		before !== null &&
		after !== null &&
		Math.abs(before - after) > durationToleranceSeconds
	)
		throw new MediaToolError(
			"TOOL_FAILED",
			"Output duration does not match the source.",
		);

	for (const [index, audio] of selectedAudios.entries()) {
		const audioBefore = audio.duration;
		const audioAfter = audios[index]?.duration;
		if (
			audioBefore != null &&
			audioAfter != null &&
			Math.abs(audioBefore - audioAfter) > durationToleranceSeconds
		)
			throw new MediaToolError(
				"TOOL_FAILED",
				"Output audio duration does not match the source.",
			);
	}
}
