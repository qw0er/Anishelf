import type {
	AudioEncoding,
	VideoEncoding,
} from "../../../platform/media/encoding.js";
import { fingerprint } from "../../../shared/fingerprint.js";
import type { DeepReadonly } from "../../../shared/policy.js";

/** Typed output policy shared by configuration and execution without module coupling. */
export interface TranscodeProfile {
	id: string;
	name: string;
	description: string;
	usage: "preparation";
	container: "mp4" | "webm" | "matroska" | "mov";
	copyCompatibleStreams: boolean;
	video: VideoEncoding;
	audio: AudioEncoding;
}

/** Output policy identity shared by negotiation and persistent cache validation. */
export function transcodeProfileFingerprint(
	profile: DeepReadonly<TranscodeProfile>,
): string {
	return fingerprint({
		usage: profile.usage,
		container: profile.container,
		copyCompatibleStreams: profile.copyCompatibleStreams,
		video: profile.video,
		audio: profile.audio,
	});
}
