export type {
	ContinueWatchingResult,
	PlaybackProgress,
	PlaybackSession,
} from "./domain/model.js";

import type { PlaybackApplication } from "./application/playback.js";
export type PlaybackApi = Pick<
	PlaybackApplication,
	"open" | "plan" | "save" | "release" | "history" | "continueWatching"
>;

export type {
	DerivedMediaIdentity,
	PlaybackPlan,
	PlaybackPlanningResult,
	PreparedPlaybackResource,
	RealtimePlaybackResource,
} from "./domain/plan.js";

export type { PlaybackPolicy } from "./domain/policy.js";
export { playbackPolicy, validatePlaybackPolicy } from "./domain/policy.js";
