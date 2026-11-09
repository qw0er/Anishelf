import type { DeepReadonly } from "../../shared/policy.js";
import type { AudioEncoding, VideoEncoding } from "./encoding.js";

interface CopyStream {
	codec: string | null;
}
interface CopyVideo extends CopyStream {
	pixelFormat: string | null;
	width: number | null;
	height: number | null;
	frameRate: number | null;
}
interface CopyAudio extends CopyStream {
	channels: number | null;
	sampleRate: number | null;
}
function withinLimit(
	actual: number | null,
	limit: number | undefined,
): boolean {
	return (
		limit === undefined || (actual !== null && actual > 0 && actual <= limit)
	);
}
/** All encoder options apply only when encoding. Omitted structural constraints stay unrestricted. */
export function matchesVideoTarget(
	source: DeepReadonly<CopyVideo>,
	target: DeepReadonly<VideoEncoding>,
): boolean {
	if (
		!source.codec ||
		!target.codec ||
		source.codec !== target.codec ||
		target.filters?.length
	)
		return false;
	if (
		target.pixelFormat !== undefined &&
		source.pixelFormat !== target.pixelFormat
	)
		return false;
	return (
		withinLimit(source.width, target.maxWidth) &&
		withinLimit(source.height, target.maxHeight) &&
		withinLimit(source.frameRate, target.maxFrameRate)
	);
}
export function matchesAudioTarget(
	source: DeepReadonly<CopyAudio>,
	target: DeepReadonly<AudioEncoding>,
): boolean {
	return (
		!!source.codec &&
		!!target.codec &&
		source.codec === target.codec &&
		!target.filters?.length &&
		(target.channels === undefined || source.channels === target.channels) &&
		(target.sampleRate === undefined || source.sampleRate === target.sampleRate)
	);
}
