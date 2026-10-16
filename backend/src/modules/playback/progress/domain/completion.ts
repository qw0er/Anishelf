/** Cooperative source-time evidence; never an authoritative watched ledger. */
export interface WatchedInterval {
	startMs: number;
	endMs: number;
	elapsedMs: number;
	rate: number;
}
type CompletionState =
	| "pending"
	| "decision-required"
	| "queued"
	| "skipped"
	| "unavailable";
export interface CompletionOutcome {
	state: CompletionState;
	reason: string;
	episode?: number;
	mediaId?: number;
}
export interface CompletionDecision {
	advance: boolean;
	initialStatus?:
		| "CURRENT"
		| "PLANNING"
		| "COMPLETED"
		| "PAUSED"
		| "DROPPED"
		| "REPEATING";
}
export interface CompletionRecord {
	id: string;
	sourceId: string;
	context: string;
	capturedAt: number;
	outcome: CompletionOutcome;
	decision: CompletionDecision | null;
}
/** Consumer-owned port: Anime resolves and revalidates the opaque target. */
export interface PlaybackCompletionObserver {
	capture(fileId: string, sourceVersion: string): Promise<string | null>;
	submit(
		context: string,
		capturedAt: number,
		decision: CompletionDecision | null,
	): Promise<CompletionOutcome>;
}
export function mergeCoverage(
	intervals: [number, number][],
): [number, number][] {
	const result: [number, number][] = [];
	for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
		const last = result.at(-1);
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else result.push([start, end]);
	}
	return result;
}
