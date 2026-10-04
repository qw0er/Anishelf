import type {
	CompatibilityEvidence,
	CompatibilityInspection,
	CompatibilityResult,
} from "../../../contracts/http.js";

type Decision = CompatibilityResult["direct"];

/** Recommend stream operations only. Output selection and execution belong to a future executor. */
export function planCompatibility(
	description: CompatibilityInspection,
	evidence: CompatibilityEvidence[],
): CompatibilityResult {
	const byId = new Map(evidence.map((entry) => [entry.id, entry]));
	function decision(id: string): Decision {
		const query = description.queries.find((query) => query.id === id);
		if (!query?.contentType)
			return { status: "unknown", reason: "incomplete-description" };
		const report = byId.get(id);
		return report
			? { status: report.status, reason: report.reason }
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
	const plans = (["file", "media-source"] as const).map(
		(target): CompatibilityResult["plans"][number] => {
			function streamDecision(kind: "video" | "audio"): Decision {
				if (kind === "audio" && !description.audio)
					return { status: "supported", reason: "no-audio-stream" };
				const candidates = description.queries
					.filter((query) => query.id.startsWith(`${target}-${kind}-`))
					.map((query) => decision(query.id));
				const supported = candidates.find(
					(candidate) => candidate.status === "supported",
				);
				if (supported) return { ...supported };
				if (
					candidates.length &&
					candidates.every((candidate) => candidate.status === "unsupported")
				)
					return { status: "unsupported", reason: "browser-rejected" };
				return (
					candidates.find((candidate) => candidate.status === "unknown") ?? {
						status: "unknown",
						reason: "missing-evidence",
					}
				);
			}
			const video = streamDecision("video");
			const audio = streamDecision("audio");
			if (description.video?.hdr && video.status === "supported") {
				video.status = "unknown";
				video.reason = "hdr-display-unverified";
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
			let mode: CompatibilityResult["plans"][number]["mode"] =
				!description.video ||
				videoAction === "unknown" ||
				audioAction === "unknown"
					? "unknown"
					: videoAction === "copy"
						? audioAction === "encode"
							? "transcode-audio"
							: "remux"
						: audioAction === "encode"
							? "transcode"
							: "transcode-video";
			let reason =
				mode === "unknown"
					? "insufficient-evidence"
					: mode === "remux"
						? "packaging-change-required"
						: mode === "transcode-audio"
							? "audio-encoding-required"
							: mode === "transcode-video"
								? "video-encoding-required"
								: "audio-video-encoding-required";
			// Separate stream acceptance does not establish that the unchanged streams can be packaged together.
			if (
				mode === "remux" &&
				!description.queries.some(
					(query) =>
						query.id.startsWith(`${target}-combined-`) &&
						decision(query.id).status === "supported",
				)
			) {
				mode = "unknown";
				reason = "stream-combination-unverified";
			}
			if (target === "file" && direct.status === "supported") {
				mode = "direct";
				reason = "original-supported";
			}
			if (!description.video) reason = "no-video-stream";
			return {
				target,
				mode,
				video,
				audio,
				videoAction: mode === "direct" ? "copy" : videoAction,
				audioAction:
					mode === "direct"
						? description.audio
							? "copy"
							: "none"
						: audioAction,
				reason,
			};
		},
	);
	const warnings: string[] = [];
	if (description.multipleTracks)
		warnings.push("native-track-selection-uncertain");
	if (description.video?.hdr) warnings.push("hdr-display-unverified");
	if (evidence.some((entry) => entry.smooth === false))
		warnings.push("playback-may-not-be-smooth");
	if (
		plans.some(
			(plan) => plan.videoAction === "encode" || plan.audioAction === "encode",
		)
	)
		warnings.push("encoding-output-not-selected");
	warnings.push("browser-report-is-not-playback-certification");
	return {
		fileId: description.fileId,
		sourceVersion: description.sourceVersion,
		rulesVersion: "2",
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
