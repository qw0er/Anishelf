import type {
	CompletionRecord,
	ManualCompletion,
} from "./domain/completion.js";
import type {
	HistoryCandidate,
	PlaybackProgress,
	PlaybackProgressUpdate,
	RegisteredSource,
	SavePlaybackProgressResult,
	SourceIdentity,
} from "./domain/model.js";
export interface PlaybackStore {
	coverage(sourceId: string, durationMs: number): [number, number][];
	completions(
		sourceId?: string,
		pendingOnly?: boolean,
		context?: string,
	): CompletionRecord[];
	saveCompletion(record: CompletionRecord): void;
	/** Insert-if-absent intent receipt; existing evidence receipts always win. */
	recordCompletion(record: ManualCompletion): void;
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
