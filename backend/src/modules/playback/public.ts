export type {
	ContinueWatchingResult,
	PlaybackProgress,
	PlaybackSession,
} from "./domain/model.js";

import type { PlaybackApplication } from "./application/playback.js";
export type PlaybackApi = Pick<
	PlaybackApplication,
	"open" | "save" | "release" | "history" | "continueWatching"
>;
