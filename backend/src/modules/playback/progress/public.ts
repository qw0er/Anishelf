export type {
	HistoryResult,
	PlaybackProgress,
	PlaybackSession,
} from "./domain/model.js";

import type {
	HistoryResult,
	PlaybackSession,
	SavePlaybackProgress,
	SavePlaybackProgressResult,
} from "./domain/model.js";
export interface PlaybackApi {
	open(fileId: string): Promise<PlaybackSession>;

	save(input: SavePlaybackProgress): Promise<SavePlaybackProgressResult>;
	release(token: string): void;
	history(limit?: number, view?: "continue" | "recent"): Promise<HistoryResult>;
}
