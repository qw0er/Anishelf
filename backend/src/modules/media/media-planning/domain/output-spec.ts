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
	return {
		...source,
		...outputDimensions(source, profile.maxHeight, profile.maxWidth),
		codec: profile.codec,
		codecString:
			profile.encoder === "libx264" &&
			profile.pixelFormat === "yuv420p" &&
			!profile.profile &&
			!profile.level
				? "avc1.640033"
				: profile.encoder === "libvpx-vp9" && profile.pixelFormat === "yuv420p"
					? "vp9"
					: null,
		profile: profile.profile ?? (profile.encoder === "libx264" ? "High" : null),
		frameRate:
			profile.maxFrameRate === undefined
				? source.frameRate
				: Math.min(
						source.frameRate ?? profile.maxFrameRate,
						profile.maxFrameRate,
					),
		pixelFormat: profile.pixelFormat,
		bitDepth: profile.pixelFormat === "yuv420p" ? 8 : null,
		hdr: false,
		bitrate: null,
	};
}
export function encodedAudioSpec(
	source: CompatibilityAudioStream,
	profile: DeepReadonly<TranscodeProfile["audio"]>,
): CompatibilityAudioStream {
	return {
		...source,
		codec: profile.codec,
		codecString:
			profile.encoder === "aac"
				? "mp4a.40.2"
				: profile.encoder === "libopus"
					? "opus"
					: null,
		profile: null,
		bitrate: "bitrateKbps" in profile ? profile.bitrateKbps * 1000 : null,
		channels:
			profile.channelCount ??
			(profile.channels === "stereo" ? 2 : source.channels),
		sampleRate: profile.sampleRate ?? source.sampleRate,
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
		...(profile.maxWidth !== undefined && dimensions.width && dimensions.height
			? [`scale=w=${dimensions.width}:h=${dimensions.height}:flags=lanczos`]
			: profile.maxHeight !== undefined &&
					(source.height === null || source.height > profile.maxHeight)
				? [`scale=w=-2:h=${profile.maxHeight}:flags=lanczos`]
				: []),
		...(profile.maxFrameRate !== undefined &&
		(source.frameRate === null || source.frameRate > profile.maxFrameRate)
			? [`fps=${profile.maxFrameRate}`]
			: []),
		"pad=ceil(iw/2)*2:ceil(ih/2)*2",
		`format=${profile.pixelFormat}`,
	];
}
export function exceedsH264Level(video: CompatibilityVideoStream): boolean {
	const macroblocks =
		Math.ceil((video.width ?? 0) / 16) * Math.ceil((video.height ?? 0) / 16);
	return macroblocks > 36864 || macroblocks * (video.frameRate ?? 0) > 983040;
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
