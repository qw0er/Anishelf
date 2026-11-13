import type { MediaToolPolicy } from "./policy.js";
export interface MediaToolsConfig {
	ffmpegPath: string;
	ffprobePath: string;
}
export interface MediaToolsPolicy {
	mediaTools: MediaToolPolicy;
}
