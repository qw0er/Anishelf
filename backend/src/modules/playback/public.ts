export type {
	ContinueWatchingResult,
	PlaybackProgress,
	PlaybackSession,
} from "./domain/model.js";

import type {
	ContinueWatchingResult,
	PlaybackSession,
	SavePlaybackProgress,
	SavePlaybackProgressResult,
} from "./domain/model.js";
export interface PlaybackApi {
	open(fileId: string): Promise<PlaybackSession>;

	save(input: SavePlaybackProgress): Promise<SavePlaybackProgressResult>;
	release(token: string): void;
	history(
		limit?: number,
		view?: "continue" | "recent",
	): Promise<ContinueWatchingResult>;
	continueWatching(limit?: number): Promise<ContinueWatchingResult>;
}
export type {
	DerivedMediaIdentity,
	PlaybackPlan,
	PreparedPlaybackResource,
	RealtimePlaybackResource,
} from "./domain/plan.js";
