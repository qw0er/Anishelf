import type {
	HistoryCandidate,
	PlaybackProgress,
	PlaybackProgressUpdate,
	RegisteredSource,
	SavePlaybackProgressResult,
	SourceIdentity,
} from "./domain/model.js";
export interface PlaybackStore {
	registerSource(identity: SourceIdentity, nowMs?: number): RegisteredSource;
	get(sourceId: string): PlaybackProgress | undefined;
	openGeneration(sourceId: string): PlaybackProgress;
	save(
		update: PlaybackProgressUpdate,
		nowMs?: number,
	): SavePlaybackProgressResult;
	listHistory(
		rootId: string,
		limit?: number,
		offset?: number,
		view?: "continue" | "recent",
	): HistoryCandidate[];
}
