/** A durable automatic observation; delivery state is independent of the Tracking operation. */
export interface CompletionOutcome {
	state: "pending" | "accepted" | "ignored" | "unavailable";
	reason: string;
	operationId?: string;
	revision?: number;
}
export interface CompletionRecord {
	id: string;
	sourceId: string;
	context: string;
	outcome: CompletionOutcome;
}
/** Consumer-owned port: Anime resolves targets and owns all viewing commands. */
export interface PlaybackCompletionObserver {
	capture(fileId: string, sourceVersion: string): Promise<string | null>;
	submit(context: string, observationId: string): Promise<CompletionOutcome>;
}
