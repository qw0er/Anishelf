import { matchesGlob } from "node:path";
import type {
	AutoPreparationPreset,
	ViewingState,
} from "../../../contracts/auto-preparation.js";
import {
	acceptsStream,
	canMux,
	dynamicRange,
} from "../../../platform/media/acceptance-policy.js";
import type { MediaInfo, MediaStream } from "../../../platform/media/model.js";
import type { MediaProcessingPlan } from "../../../platform/media/specification.js";
import { fingerprint } from "../../../shared/fingerprint.js";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import type { SourceIdentity } from "../../resources/public.js";
import {
	type TranscodeProfile,
	transcodeProfileFingerprint,
} from "../../system/public.js";
import { describeVideo } from "../media-inspection/public.js";
import type { MediaPlanningResult } from "../media-planning/public.js";
import {
	encodedVideoSpec,
	videoEncodingFilters,
} from "../media-planning/public.js";

export function presetFingerprint(
	preset: DeepReadonly<AutoPreparationPreset>,
): string {
	const { id: _id, name: _name, description: _description, ...policy } = preset;
	return fingerprint(policy);
}
export function matchesPreset(
	preset: DeepReadonly<AutoPreparationPreset>,
	source: SourceIdentity,
	viewing: ViewingState,
): boolean {
	const match = preset.match;
	return (
		(!match?.rootIds?.length || match.rootIds.includes(source.scopeId)) &&
		(!match?.viewingStates?.length || match.viewingStates.includes(viewing)) &&
		(!match?.include?.length ||
			match.include.some((glob) => matchesGlob(source.relativePath, glob))) &&
		!match?.exclude?.some((glob) => matchesGlob(source.relativePath, glob))
	);
}
export function selectAutomaticAudio(
	info: DeepReadonly<MediaInfo>,
	preset: DeepReadonly<AutoPreparationPreset>,
): DeepReadonly<MediaStream>[] | null {
	const audios = info.streams.filter((s) => s.type === "audio");
	const defaultTrack = audios.find((s) => s.default) ?? audios[0];
	const defaultSelection = defaultTrack ? [defaultTrack] : [];
	switch (preset.audio?.selection ?? "all") {
		case "none":
			return [];
		case "default":
			return defaultSelection;
		case "all":
			return audios;
		case "languages": {
			const selected = audios.filter((s) =>
				preset.audio?.languages?.some(
					(l) => l.toLowerCase() === s.tags.language?.toLowerCase(),
				),
			);
			if (selected.length || !audios.length) return selected;
			switch (preset.audio?.fallback ?? "default") {
				case "all":
					return audios;
				case "skip":
					return null;
				default:
					return defaultSelection;
			}
		}
	}
}
export function acceptsMedia(
	info: DeepReadonly<MediaInfo>,
	preset: DeepReadonly<AutoPreparationPreset>,
): boolean {
	const accept = preset.accept;
	return (
		(!accept?.containers?.length ||
			(info.container !== null &&
				accept.containers.includes(info.container))) &&
		info.streams.some(
			(s) =>
				s.type === "video" &&
				!s.attachedPicture &&
				acceptsStream(s, accept?.video) === "accepted",
		) &&
		info.streams
			.filter((s) => s.type === "audio")
			.every((s) => acceptsStream(s, accept?.audio) === "accepted")
	);
}
export function planAutomaticPreparation(
	source: SourceIdentity,
	info: DeepReadonly<MediaInfo>,
	preset: DeepReadonly<AutoPreparationPreset>,
	profile: DeepReadonly<TranscodeProfile>,
): DeepReadonly<MediaPlanningResult> {
	const block = (reason: string): MediaPlanningResult => ({
		kind: "blocked",
		reason,
	});
	const video =
		info.streams.find(
			(s) => s.type === "video" && !s.attachedPicture && s.default,
		) ?? info.streams.find((s) => s.type === "video" && !s.attachedPicture);
	if (!video) return block("no-video-stream");
	const audios = selectAutomaticAudio(info, preset);
	if (audios === null) return block("audio-language-unavailable");
	if (audios.length > 128) return block("too-many-audio-streams");
	const videoAcceptance = acceptsStream(video, preset.accept?.video);
	const audioAcceptance = audios.map((s) =>
		acceptsStream(s, preset.accept?.audio),
	);
	if (
		videoAcceptance === "unknown" ||
		audioAcceptance.includes("unknown") ||
		(preset.accept?.containers?.length && info.container === null)
	)
		return block("metadata-unknown");
	const allAudios = info.streams.filter((s) => s.type === "audio");
	const originalSuitable =
		(!preset.accept?.containers?.length ||
			(info.container !== null &&
				preset.accept.containers.includes(info.container))) &&
		videoAcceptance === "accepted" &&
		audioAcceptance.every((s) => s === "accepted") &&
		audios.length === allAudios.length;
	if (originalSuitable)
		return freeze({
			kind: "playable",
			fileId: source.fileId,
			mimeType: "video/mp4",
		});
	const resize =
		(profile.video.maxWidth !== undefined &&
			(video.width === null || video.width > profile.video.maxWidth)) ||
		(profile.video.maxHeight !== undefined &&
			(video.height === null || video.height > profile.video.maxHeight)) ||
		(profile.video.maxFrameRate !== undefined &&
			(video.framesPerSecond === null ||
				video.framesPerSecond > profile.video.maxFrameRate));
	const copyVideo =
		profile.copyCompatibleStreams &&
		videoAcceptance === "accepted" &&
		!resize &&
		canMux(profile.container, video.codec, "video");
	if (
		!copyVideo &&
		(dynamicRange(video) !== "sdr" ||
			video.hdr.pq ||
			video.hdr.hlg ||
			video.hdr.sideDataTypes.length)
	)
		return block("hdr-conversion-unverified");
	if (!copyVideo && (!video.width || !video.height || !video.framesPerSecond))
		return block("video-dimensions-unverified");
	const predicted = encodedVideoSpec(
		describeVideo(video as MediaStream),
		profile.video,
	);
	const encodedVideo: DeepReadonly<MediaStream> = {
		...structuredClone(video),
		codec: profile.video.codec,
		pixelFormat: profile.video.pixelFormat,
		profile:
			profile.video.profile ??
			(profile.video.codec === "h264"
				? "high"
				: profile.video.codec === "vp9"
					? "0"
					: null),
		width: predicted.width,
		height: predicted.height,
		framesPerSecond: predicted.frameRate,
		bitRate: profile.video.maxBitrateKbps
			? profile.video.maxBitrateKbps * 1000
			: "bitrateKbps" in profile.video
				? profile.video.bitrateKbps * 1000
				: null,
		level: profile.video.level
			? Number(profile.video.level) * (profile.video.codec === "hevc" ? 30 : 10)
			: profile.video.codec === "h264"
				? 51
				: null,
	};
	if (
		!copyVideo &&
		acceptsStream(encodedVideo, preset.accept?.video) !== "accepted"
	)
		return block("output-video-rejected");
	const tracks = audios.map((audio, i) => {
		const channels =
			profile.audio.channelCount ??
			(profile.audio.channels === "stereo" ? 2 : audio.channels);
		const copy =
			profile.copyCompatibleStreams &&
			audioAcceptance[i] === "accepted" &&
			canMux(profile.container, audio.codec, "audio") &&
			channels === audio.channels &&
			(profile.audio.sampleRate === undefined ||
				profile.audio.sampleRate === audio.sampleRate);
		return {
			sourceIndex: audio.index,
			execution: copy
				? { action: "copy" as const }
				: {
						action: "encode" as const,
						encoder: profile.audio.encoder,
						codec: profile.audio.codec,
					},
			...(copy ? {} : { parameters: structuredClone(profile.audio) }),
			default: audio.default,
		};
	});
	for (const [i, track] of tracks.entries()) {
		if (track.execution.action === "copy") continue;
		const audio = audios[i];
		if (!audio) return block("audio-selection-invalid");
		const expected = {
			...audio,
			codec: profile.audio.codec,
			profile: profile.audio.codec === "aac" ? "lc" : null,
			channels:
				profile.audio.channelCount ??
				(profile.audio.channels === "stereo" ? 2 : audio.channels),
			sampleRate: profile.audio.sampleRate ?? audio.sampleRate,
			bitRate:
				"bitrateKbps" in profile.audio
					? profile.audio.bitrateKbps * 1000
					: null,
		};
		if (
			!canMux(profile.container, profile.audio.codec, "audio") ||
			acceptsStream(expected, preset.accept?.audio) !== "accepted"
		)
			return block("output-audio-rejected");
	}
	if (!copyVideo && !canMux(profile.container, profile.video.codec, "video"))
		return block("output-video-packaging-rejected");
	const encodeAudio = tracks.some((t) => t.execution.action === "encode");
	const profileFingerprint = transcodeProfileFingerprint(profile);
	const plan: MediaProcessingPlan = {
		id: "",
		container: profile.container,
		delivery: "file",
		outputFormat: profile.container,
		video: copyVideo
			? { action: "copy" }
			: {
					action: "encode",
					encoder: profile.video.encoder,
					codec: profile.video.codec,
					pixelFormat: profile.video.pixelFormat,
				},
		audio: encodeAudio
			? {
					action: "encode",
					encoder: profile.audio.encoder,
					codec: profile.audio.codec,
				}
			: { action: "copy" },
		audioTracks: tracks,
		...(preset.accept ? { acceptance: preset.accept } : {}),
		filters: [
			...(copyVideo
				? []
				: [
						"buffer",
						"buffersink",
						"null",
						"scale",
						"pad",
						"format",
						...(profile.video.maxFrameRate ? ["fps"] : []),
					]),
			...(encodeAudio
				? ["abuffer", "abuffersink", "aresample", "aformat", "anull"]
				: []),
		],
		...(!copyVideo
			? {
					videoParameters: structuredClone(profile.video),
					videoFilters: videoEncodingFilters(
						describeVideo(video as MediaStream),
						profile.video,
					),
					...(profile.video.encoder === "libx264" &&
					!profile.video.profile &&
					!profile.video.level
						? { h264Level: "5.1" as const }
						: {}),
				}
			: {}),
	};
	plan.id = fingerprint({
		version: "automatic-preparation:1",
		source,
		profileFingerprint,
		plan,
	});
	const mode = copyVideo
		? encodeAudio
			? "transcode-audio"
			: "remux"
		: encodeAudio
			? "transcode"
			: "transcode-video";
	return freeze({
		kind: "processing-required",
		target: "file",
		mode,
		reasons: {
			video: copyVideo ? "preset-accepted" : "preset-encoding-required",
			audio: encodeAudio ? "preset-encoding-required" : "preset-accepted",
		},
		identity: {
			rootId: source.scopeId,
			fileId: source.fileId,
			sourceVersion: source.sourceVersion,
			profileFingerprint,
			executionPlanId: plan.id,
			videoStreamIndex: video.index,
			audioStreamIndices: audios.map((s) => s.index),
		},
		execution: {
			fileId: source.fileId,
			sourceVersion: source.sourceVersion,
			plan,
			videoStreamIndex: video.index,
			audioStreamIndices: audios.map((s) => s.index),
		},
	});
}
