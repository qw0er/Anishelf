import type {
	CompatibilityQuery,
	CompatibilityStream,
} from "../../../contracts/http.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { TranscodeProfile } from "../../../shared/transcode-profiles.js";
import { transcodeProfileFingerprint } from "../../../shared/transcode-profiles.js";
import type {
	CompatibilityOutput,
	OriginalMediaDescription,
} from "../domain/model.js";

/** Describe the exact source and profile-selected output combinations for browser negotiation. */
function describeSingleOutputCandidates(
	original: OriginalMediaDescription,
	profile: DeepReadonly<TranscodeProfile>,
	target: "file" | "media-source",
): { queries: CompatibilityQuery[]; output: CompatibilityOutput } {
	const audio = original.audio;
	const video =
		original.video &&
		profile.container === "mp4" &&
		["vp8", "vp9"].includes(original.video.codecString ?? "")
			? { ...original.video, codecString: null }
			: original.video;
	const base = {
		mp4: "video/mp4",
		webm: "video/webm",
		matroska: "video/x-matroska",
		mov: "video/quicktime",
	}[profile.container];
	const queries = [...original.queries];
	const add = (
		id: string,
		v: CompatibilityStream | null,
		a: CompatibilityStream | null,
	) => {
		const streams = [v, a].filter((stream) => stream !== null);
		queries.push({
			id,
			type: target,
			contentType:
				streams.length && streams.every((stream) => stream.codecString)
					? `${v ? base : base.replace("video/", "audio/")}; codecs="${streams.map((stream) => stream.codecString).join(", ")}"`
					: null,
			video: v,
			audio: a,
		});
	};
	// Exact encoded H.264/AAC descriptors are implemented first. Other profiles can remux;
	// unsupported descriptor generation stays unknown, rather than inventing codec levels.
	const encodedVideo = video
		? {
				...video,
				codec: profile.video.codec,
				codecString:
					profile.video.encoder === "libx264" &&
					profile.video.pixelFormat === "yuv420p"
						? "avc1.640033"
						: null,
				profile: profile.video.encoder === "libx264" ? "High" : null,
				pixelFormat: profile.video.pixelFormat,
				bitDepth: profile.video.pixelFormat === "yuv420p" ? 8 : null,
				hdr: false,
				width:
					video.width && video.height
						? Math.ceil(
								(video.width *
									Math.min(
										video.height,
										profile.video.maxHeight ?? video.height,
									)) /
									video.height /
									2,
							) * 2
						: null,
				bitrate: null,
				height: video.height
					? Math.ceil(
							Math.min(video.height, profile.video.maxHeight ?? video.height) /
								2,
						) * 2
					: null,
			}
		: null;
	const encodedAudio = audio
		? {
				...audio,
				codec: profile.audio.codec,
				codecString: profile.audio.encoder === "aac" ? "mp4a.40.2" : null,
				profile: null,
				bitrate:
					"bitrateKbps" in profile.audio
						? profile.audio.bitrateKbps * 1000
						: null,
				channels: profile.audio.channels === "stereo" ? 2 : audio.channels,
			}
		: null;
	add("copy-video", video, null);
	if (audio) add("copy-audio", null, audio);
	for (const v of ["copy", "encode"] as const)
		for (const a of ["copy", "encode"] as const)
			add(
				`output-${v}-${a}`,
				v === "copy" ? video : encodedVideo,
				a === "copy" ? audio : encodedAudio,
			);
	const profileFingerprint = transcodeProfileFingerprint(profile);
	return {
		queries,
		output: { profileId: profile.id, target, profileFingerprint },
	};
}

export function describeOutputCandidates(
	original: OriginalMediaDescription,
	profile: DeepReadonly<TranscodeProfile>,
	target: "file" | "media-source",
): { queries: CompatibilityQuery[]; output: CompatibilityOutput } {
	const tracks = original.selectedAudioTracks;
	const candidates = (tracks.length ? tracks : [null]).map(
		(audio, trackPosition) => {
			const result = describeSingleOutputCandidates(
				{ ...original, audio, queries: [] },
				profile,
				target,
			);
			return {
				...result,
				queries: result.queries
					.filter((query) => query.id !== "copy-video" || trackPosition === 0)
					.map((query) => ({
						...query,
						id:
							query.id === "copy-video" ||
							audio?.index === original.audio?.index ||
							!audio
								? query.id
								: `${query.id}-${audio.index}`,
					})),
			};
		},
	);
	return {
		queries: [
			...original.queries,
			...candidates.flatMap((candidate) => candidate.queries),
		],
		output: {
			profileId: profile.id,
			target,
			profileFingerprint: transcodeProfileFingerprint(profile),
		},
	};
}
