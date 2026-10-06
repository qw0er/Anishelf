import type {
	CompatibilityAudioStream,
	CompatibilityQuery,
	CompatibilityVideoStream,
} from "../../../contracts/http.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { TranscodeProfile } from "../../../shared/transcode-profiles.js";
import { transcodeProfileFingerprint } from "../../../shared/transcode-profiles.js";
import type {
	CompatibilityOutput,
	OriginalMediaDescription,
} from "../domain/model.js";
import {
	browserQuery,
	encodedAudioSpec,
	encodedVideoSpec,
} from "../domain/output-spec.js";

/** Describe the exact source and profile-selected output combinations for browser negotiation. */
function describeSingleOutputCandidates(
	original: OriginalMediaDescription,
	audio: CompatibilityAudioStream | null,
	profile: DeepReadonly<TranscodeProfile>,
	target: "file" | "media-source",
): { queries: CompatibilityQuery[]; output: CompatibilityOutput } {
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
		v: CompatibilityVideoStream | null,
		a: CompatibilityAudioStream | null,
	) => {
		const streams = [v, a].filter((stream) => stream !== null);
		const contentType =
			streams.length && streams.every((stream) => stream.codecString)
				? `${v ? base : base.replace("video/", "audio/")}; codecs="${streams.map((stream) => stream.codecString).join(", ")}"`
				: null;
		queries.push(browserQuery(id, target, contentType, base, v, a));
	};
	const encodedVideo = video ? encodedVideoSpec(video, profile.video) : null;
	const encodedAudio = audio ? encodedAudioSpec(audio, profile.audio) : null;
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
	const tracks = original.selectedAudioStreamIndices.map((index) => {
		const track = original.audioTracks.find((track) => track.index === index);
		if (!track) throw new Error("Normalized audio selection is inconsistent.");
		return track;
	});
	const candidates = (tracks.length ? tracks : [null]).map(
		(audio, trackPosition) => {
			const result = describeSingleOutputCandidates(
				{ ...original, queries: [] },
				audio,
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
							audio?.index === original.defaultAudioStreamIndex ||
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
