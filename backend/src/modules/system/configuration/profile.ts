import type {
	AudioEncoding,
	EncodingOptions,
	EncodingValidation,
	VideoEncoding,
} from "../../../platform/media/encoding.js";
import { fingerprint } from "../../../shared/fingerprint.js";
import type { DeepReadonly } from "../../../shared/policy.js";

/** Typed output policy shared by configuration and execution without module coupling. */
export interface TranscodeProfile {
	id: string;
	name: string;
	description: string;
	container: "mp4" | "webm" | "matroska" | "mov";
	video: VideoEncoding;
	audio: AudioEncoding;
	globalOptions?: EncodingOptions;
	inputOptions?: EncodingOptions;
	muxerOptions?: EncodingOptions;
}

/** Output policy identity shared by negotiation and persistent cache validation. */
function _transcodeProfileFingerprint(
	profile: DeepReadonly<TranscodeProfile>,
): string {
	return fingerprint({
		compilerVersion: 2,
		globalOptions: Object.entries(profile.globalOptions ?? {}),
		inputOptions: Object.entries(profile.inputOptions ?? {}),
		muxerOptions: Object.entries(profile.muxerOptions ?? {}),
		container: profile.container,
		video: {
			...profile.video,
			options: Object.entries(profile.video.options ?? {}),
		},
		audio: {
			...profile.audio,
			options: Object.entries(profile.audio.options ?? {}),
		},
	});
}

export type TranscodeProfileValidator = (
	profiles: DeepReadonly<TranscodeProfile[]>,
) => Promise<{
	profiles: TranscodeProfile[];
	validation: Record<string, EncodingValidation>;
}>;
