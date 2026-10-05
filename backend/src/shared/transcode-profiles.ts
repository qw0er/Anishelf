import type { Static } from "typebox";
import type { TranscodeProfileSchema } from "../contracts/schemas/transcode-profiles.js";
import { fingerprint } from "./fingerprint.js";
import type { DeepReadonly } from "./policy.js";

/** Typed output policy shared by configuration and execution without module coupling. */
export type TranscodeProfile = Static<typeof TranscodeProfileSchema>;

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
