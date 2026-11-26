import type { MediaToolPolicy } from "./policy.ts";

export interface MediaToolsConfig {
	ffmpegPath: string;
	ffprobePath: string;
}

export interface MediaToolsPolicy {
	mediaTools: MediaToolPolicy;
}
