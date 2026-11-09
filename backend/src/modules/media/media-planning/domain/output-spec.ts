import type { MediaProcessingPlan } from "../../../../platform/media/specification.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { TranscodeProfile } from "../../../system/public.js";
import type {
	CompatibilityAudioStream,
	CompatibilityQuery,
	CompatibilityVideoStream,
} from "../negotiation.js";

/** FFmpeg scale=-2 rounds the proportional width to the nearest even integer;
 * pad then rounds both dimensions up to even. Unknown dimensions stay unknown. */
function outputDimensions(
	source: Pick<CompatibilityVideoStream, "width" | "height">,
	maxHeight?: number,
	maxWidth?: number,
): { width: number | null; height: number | null } {
	const { width, height } = source;
	if (!width || !height) return { width: null, height: null };
	if (maxWidth === undefined) {
		const resize = maxHeight !== undefined && height > maxHeight;
		return {
			width: resize
				? Math.max(
						2,
						Math.round((width * (maxHeight as number)) / height / 2) * 2,
					)
				: Math.ceil(width / 2) * 2,
			height: Math.ceil((resize ? (maxHeight as number) : height) / 2) * 2,
		};
	}
	const ratio = Math.min(
		1,
		maxHeight === undefined ? 1 : maxHeight / height,
		maxWidth === undefined ? 1 : maxWidth / width,
	);
	const resize = ratio < 1;
	return {
		width: resize
			? Math.max(2, Math.floor((width * ratio) / 2) * 2)
			: Math.ceil(width / 2) * 2,
		height:
			Math.ceil(
				(resize ? Math.max(2, Math.floor((height * ratio) / 2) * 2) : height) /
					2,
			) * 2,
	};
}
export function encodedVideoSpec(
	source: CompatibilityVideoStream,
	profile: DeepReadonly<TranscodeProfile["video"]>,
): CompatibilityVideoStream {
	const transformed = !!profile.filters?.length;
	return {
		...source,
		...(transformed
			? { width: null, height: null }
			: outputDimensions(source, profile.maxHeight, profile.maxWidth)),
		codec: profile.codec || "unknown",
		codecString:
			profile.codec === "h264" &&
			profile.pixelFormat === "yuv420p" &&
			profile.options?.profile === "high" &&
			String(profile.options?.level) === "5.1"
				? "avc1.640033"
				: profile.codec === "vp9" && profile.pixelFormat === "yuv420p"
					? "vp9"
					: null,
		profile:
			typeof profile.options?.profile === "string"
				? profile.options.profile
				: null,
		frameRate: transformed
			? null
			: profile.maxFrameRate === undefined
				? source.frameRate
				: Math.min(
						source.frameRate ?? profile.maxFrameRate,
						profile.maxFrameRate,
					),
		pixelFormat: profile.pixelFormat ?? null,
		bitDepth: profile.pixelFormat === "yuv420p" ? 8 : null,
		hdr: null,
		bitrate: null,
	};
}
export function encodedAudioSpec(
	source: CompatibilityAudioStream,
	profile: DeepReadonly<TranscodeProfile["audio"]>,
): CompatibilityAudioStream {
	return {
		...source,
		codec: profile.codec || "unknown",
		codecString:
			profile.codec === "aac" && profile.options?.profile === "aac_low"
				? "mp4a.40.2"
				: profile.codec === "opus"
					? "opus"
					: null,
		profile: null,
		bitrate: null,
		channels:
			profile.channels ?? (profile.filters?.length ? null : source.channels),
		sampleRate:
			profile.sampleRate ??
			(profile.filters?.length ? null : source.sampleRate),
	};
}

export function videoEncodingFilters(
	source: CompatibilityVideoStream,
	profile: DeepReadonly<TranscodeProfile["video"]>,
): string[] {
	const dimensions = outputDimensions(
		source,
		profile.maxHeight,
		profile.maxWidth,
	);
	return [
		...(profile.filters ?? []),
		...(profile.filters?.length && (profile.maxWidth || profile.maxHeight)
			? [
					`scale=w='${profile.maxWidth ? `min(iw,${profile.maxWidth})` : "iw"}':h='${profile.maxHeight ? `min(ih,${profile.maxHeight})` : "ih"}':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`,
				]
			: profile.maxWidth !== undefined && dimensions.width && dimensions.height
				? [`scale=w=${dimensions.width}:h=${dimensions.height}:flags=lanczos`]
				: profile.maxHeight !== undefined &&
						(source.height === null || source.height > profile.maxHeight)
					? [`scale=w=-2:h=${profile.maxHeight}:flags=lanczos`]
					: []),
		...(profile.maxFrameRate !== undefined &&
		(!!profile.filters?.length ||
			source.frameRate === null ||
			source.frameRate > profile.maxFrameRate)
			? [`fps=${profile.maxFrameRate}`]
			: []),
		"pad=ceil(iw/2)*2:ceil(ih/2)*2",
		...(profile.pixelFormat ? [`format=${profile.pixelFormat}`] : []),
	];
}
/** Only decodingInfo parameters cross the browser boundary. */
export function browserQuery(
	id: string,
	type: CompatibilityQuery["type"],
	contentType: string | null,
	base: string | null,
	video: CompatibilityVideoStream | null,
	audio: CompatibilityAudioStream | null,
): CompatibilityQuery {
	const streamType = (kind: "video" | "audio", codec: string | null) =>
		base && codec
			? `${base.replace(/^(video|audio)\//, `${kind}/`)}; codecs="${codec}"`
			: null;
	return {
		id,
		type,
		contentType,
		video: video
			? {
					contentType: streamType("video", video.codecString),
					width: video.width,
					height: video.height,
					frameRate: video.frameRate,
					bitrate: video.bitrate,
				}
			: null,
		audio: audio
			? {
					contentType: streamType("audio", audio.codecString),
					sampleRate: audio.sampleRate,
					channels: audio.channels,
					bitrate: audio.bitrate,
				}
			: null,
	};
}
/** Derive from the persisted execution settings; no second serialized output snapshot. */
export function expectedOutputSpec(
	video: CompatibilityVideoStream,
	audios: CompatibilityAudioStream[],
	plan: DeepReadonly<MediaProcessingPlan>,
) {
	return {
		video:
			plan.video.action === "copy"
				? video
				: plan.videoParameters
					? encodedVideoSpec(video, plan.videoParameters)
					: {
							...video,
							codec: plan.video.codec,
							pixelFormat: plan.video.pixelFormat ?? null,
							codecString: null,
							width: null,
							height: null,
						},
		audios: audios.map((audio) => {
			const track = plan.audioTracks?.find(
				(t) => t.sourceIndex === audio.index,
			);
			const action = track?.execution ?? plan.audio;
			const parameters = track?.parameters ?? plan.audioParameters;
			return action.action === "copy"
				? audio
				: parameters
					? encodedAudioSpec(audio, parameters)
					: {
							...audio,
							codec: action.codec,
							codecString: null,
							channels: null,
						};
		}),
	};
}
