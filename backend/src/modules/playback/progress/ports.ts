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
	viewingStates?(
		sources: readonly SourceIdentity[],
	): Record<
		string,
		import("../../../contracts/auto-preparation.js").ViewingState
	>;
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
		scopeIds: readonly string[],
		limit?: number,
		offset?: number,
		view?: "continue" | "recent",
	): HistoryCandidate[];
}
