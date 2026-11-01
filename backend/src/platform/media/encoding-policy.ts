import type { DeepReadonly } from "../../shared/policy.js";
import type { AudioEncoding, VideoEncoding } from "./encoding.js";
/** Encoder-specific options are deliberately bounded rather than passed through as raw flags. */
export function validEncodingOptions(
	video: DeepReadonly<VideoEncoding>,
	audio: DeepReadonly<AudioEncoding>,
): boolean {
	const profiles: Record<string, string[]> = {
		libx264: ["baseline", "main", "high", "high10", "high422", "high444"],
		libx265: ["main", "main10", "mainstillpicture"],
		"libvpx-vp9": ["0", "1", "2", "3"],
	};
	return (
		(!video.profile || !!profiles[video.encoder]?.includes(video.profile)) &&
		(!video.level || ["libx264", "libx265"].includes(video.encoder)) &&
		(!audio.profile || audio.encoder === "aac") &&
		!(
			audio.channels === "stereo" &&
			audio.channelCount !== undefined &&
			audio.channelCount !== 2
		)
	);
}
