import type { CompletionRecord } from "./domain/completion.js";
import type {
	HistoryCandidate,
	PlaybackProgress,
	PlaybackProgressUpdate,
	RegisteredSource,
	SavePlaybackProgressResult,
	SourceIdentity,
} from "./domain/model.js";
export interface PlaybackStore {
	completions(sourceId?: string, pendingOnly?: boolean): CompletionRecord[];
	saveCompletion(record: CompletionRecord): void;
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
