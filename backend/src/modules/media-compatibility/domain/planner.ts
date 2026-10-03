import type {
	CompatibilityEvidence,
	CompatibilityInspection,
	CompatibilityResult,
} from "../../../contracts/http.js";

type Decision = CompatibilityResult["direct"];
export function planCompatibility(
	description: CompatibilityInspection,
	evidence: CompatibilityEvidence[],
	ffmpegAvailable: boolean,
	inventory: CompatibilityResult["processing"] = {
		mp4: null,
		h264: null,
		aac: null,
	},
): CompatibilityResult {
	const byId = new Map(evidence.map((e) => [e.id, e]));
	function decision(id: string): Decision {
		const query = description.queries.find((q) => q.id === id);
		if (!query?.contentType)
			return { status: "unknown", reason: "incomplete-description" };
		const e = byId.get(id);
		return e
			? { status: e.status, reason: e.reason }
			: { status: "unknown", reason: "missing-evidence" };
	}
	const container = decision("original-container");
	let direct = decision("original");
	if (container.status === "unsupported")
		direct = { status: "unsupported", reason: "container-rejected" };
	if (!description.video)
		direct = { status: "unsupported", reason: "no-video-stream" };
	if (description.multipleTracks && direct.status === "supported")
		direct = { status: "unknown", reason: "native-track-selection-uncertain" };
	if (description.video?.hdr && direct.status === "supported")
		direct = { status: "unknown", reason: "hdr-display-unverified" };
	const plans = (["mp4", "mse"] as const).map((target) => {
		const video = decision(`${target}-video`);
		const audio: Decision = description.audio
			? decision(`${target}-audio`)
			: { status: "supported", reason: "no-audio-stream" };
		// Browser acceptance does not prove that arbitrary stream configurations can be muxed.
		const copyable = new Set([
			"h264",
			"hevc",
			"av1",
			"aac",
			"mp3",
			"opus",
			"ac3",
			"eac3",
		]);
		for (const [stream, result] of [
			[description.video, video],
			[description.audio, audio],
		] as const) {
			if (
				stream &&
				result.status === "supported" &&
				!copyable.has(stream.codec ?? "")
			) {
				result.status = "unknown";
				result.reason = "target-packaging-unverified";
			}
			if (stream?.hdr && result.status === "supported") {
				result.status = "unknown";
				result.reason = "hdr-display-unverified";
			}
		}
		const videoAction =
			video.status === "supported"
				? "copy"
				: video.status === "unsupported"
					? "encode"
					: "unknown";
		const audioAction = !description.audio
			? "none"
			: audio.status === "supported"
				? "copy"
				: audio.status === "unsupported"
					? "encode"
					: "unknown";
		const mode =
			target === "mp4" && direct.status === "supported"
				? "direct"
				: videoAction === "unknown" ||
						audioAction === "unknown" ||
						!description.video
					? "unknown"
					: videoAction === "copy"
						? audioAction === "encode"
							? "transcode-audio"
							: "remux"
						: audioAction === "encode"
							? "transcode"
							: "transcode-video";
		const blocked =
			!description.video || (videoAction === "encode" && description.video.hdr);
		const encodedVideo =
			videoAction === "encode" ? decision(`${target}-encoded-video`) : null;
		const encodedAudio =
			audioAction === "encode" ? decision(`${target}-encoded-audio`) : null;
		const toolRejected =
			inventory.mp4 === false ||
			(videoAction === "encode" && inventory.h264 === false) ||
			(audioAction === "encode" && inventory.aac === false);
		const outputRejected =
			encodedVideo?.status === "unsupported" ||
			encodedAudio?.status === "unsupported";
		return {
			target,
			mode,
			video,
			audio,
			outputVideo: encodedVideo ?? video,
			outputAudio: encodedAudio ?? audio,
			videoAction: mode === "direct" ? "copy" : videoAction,
			audioAction:
				mode === "direct" ? (description.audio ? "copy" : "none") : audioAction,
			execution:
				mode === "direct"
					? "not-required"
					: blocked || outputRejected || toolRejected
						? "blocked"
						: target === "mse" || !ffmpegAvailable
							? "unavailable"
							: "unverified",
			reason:
				mode === "direct"
					? "original-supported"
					: !description.video
						? "no-video-stream"
						: blocked
							? "hdr-conversion-unavailable"
							: toolRejected
								? "processing-capability-unavailable"
								: outputRejected
									? "encoded-output-rejected"
									: mode === "unknown"
										? "insufficient-evidence"
										: target === "mse"
											? "hls-executor-unavailable"
											: !ffmpegAvailable
												? "ffmpeg-unavailable"
												: "output-validation-required",
		} as CompatibilityResult["plans"][number];
	});
	const warnings: string[] = [];
	if (description.multipleTracks)
		warnings.push("native-track-selection-uncertain");
	if (description.video?.hdr) warnings.push("hdr-display-unverified");
	if (evidence.some((e) => e.smooth === false))
		warnings.push("playback-may-not-be-smooth");
	if (
		plans.some(
			(plan) => plan.videoAction === "encode" || plan.audioAction === "encode",
		)
	)
		warnings.push("encoded-output-requires-probe-and-playback-validation");
	warnings.push("browser-report-is-not-playback-certification");
	return {
		fileId: description.fileId,
		sourceVersion: description.sourceVersion,
		rulesVersion: "1",
		processing: inventory,
		direct,
		video: decision("original-video"),
		audio: description.audio
			? decision("original-audio")
			: { status: "supported", reason: "no-audio-stream" },
		selectedVideo: description.video,
		selectedAudio: description.audio,
		container,
		plans,
		evidence,
		warnings,
	};
}
