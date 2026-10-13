import { subtitleConstraints } from "@anishelf/backend/contracts/defaults";
import { subtitleFormats } from "@anishelf/backend/contracts/subtitles";
export interface SubtitlePolicy {
	readonly maximumBytes: number;
	readonly initializationTimeoutMs: number;
	readonly memoryMaximumBytes: number;
	readonly formats: readonly (typeof subtitleFormats)[number][];
}
export const subtitlePolicy: SubtitlePolicy = Object.freeze({
	...subtitleConstraints,
	initializationTimeoutMs: 15000,
	memoryMaximumBytes: 64 * 1024 * 1024,
	formats: subtitleFormats,
});
export const subtitlesInteractionPolicy = Object.freeze({
	subtitlePollIntervalMs: 500,
});
