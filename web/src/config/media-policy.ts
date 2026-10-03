import {
	libraryConstraints,
	subtitleConstraints,
} from "@anishelf/backend/contracts/defaults";
import { subtitleFormats } from "@anishelf/backend/contracts/subtitles";

export const libraryPolicy = libraryConstraints;
export interface PlaybackPolicy {
	readonly progressSaveIntervalMs: number;
	readonly requestTimeoutMs: number;
}
export interface SubtitlePolicy {
	readonly maximumBytes: number;
	readonly initializationTimeoutMs: number;
	readonly memoryMaximumBytes: number;
	readonly formats: readonly (typeof subtitleFormats)[number][];
}
export const playbackPolicy: PlaybackPolicy = Object.freeze({
	progressSaveIntervalMs: 5000,
	requestTimeoutMs: 5000,
});
export const subtitlePolicy: SubtitlePolicy = Object.freeze({
	...subtitleConstraints,
	initializationTimeoutMs: 15000,
	memoryMaximumBytes: 64 * 1024 * 1024,
	formats: subtitleFormats,
});
