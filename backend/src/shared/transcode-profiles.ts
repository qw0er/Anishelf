import type { Static } from "typebox";
import type { TranscodeProfileSchema } from "../contracts/schemas/transcode-profiles.js";

/** Typed output policy shared by configuration and execution without module coupling. */
export type TranscodeProfile = Static<typeof TranscodeProfileSchema>;
