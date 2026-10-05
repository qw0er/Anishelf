export type {
	ContinueWatchingResult,
	PlaybackProgress,
	PlaybackSession,
} from "./domain/model.js";

import type { CompatibilityCheckRequest } from "../../contracts/http.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type {
	ContinueWatchingResult,
	PlaybackSession,
	SavePlaybackProgress,
	SavePlaybackProgressResult,
} from "./domain/model.js";
import type { PlaybackPlanningResult } from "./domain/plan.js";
export interface PlaybackApi {
	open(fileId: string): Promise<PlaybackSession>;
	plan(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<PlaybackPlanningResult>>;
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
	PlaybackPlanningResult,
	PreparedPlaybackResource,
	RealtimePlaybackResource,
} from "./domain/plan.js";
