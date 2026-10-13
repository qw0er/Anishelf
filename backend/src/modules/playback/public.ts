import type {
	PlaybackOptionsRequest,
	PlaybackOptionsResponse,
	PlaybackSelection,
	PlaybackSelectionRequest,
} from "./playback-selection/public.js";
import type {
	HistoryResult,
	PlaybackSession,
	SavePlaybackProgress,
	SavePlaybackProgressResult,
} from "./progress/domain/model.js";
export interface PlaybackApi {
	open(id: string): Promise<PlaybackSession>;
	save(input: SavePlaybackProgress): Promise<SavePlaybackProgressResult>;
	release(token: string): void;
	history(limit?: number, view?: "continue" | "recent"): Promise<HistoryResult>;
	inspect(input: PlaybackOptionsRequest): Promise<PlaybackOptionsResponse>;
	select(input: PlaybackSelectionRequest): Promise<PlaybackSelection>;
}
