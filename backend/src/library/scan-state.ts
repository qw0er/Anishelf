/** ISO 8601 UTC timestamp serialized as a string. */
export type Timestamp = string;

export interface ScanWarningSummary {
	count: number;
	/** Bounded, user-safe summary; detailed paths belong in local logs. */
	messages: readonly string[];
}

interface ScanStateFields {
	id: string;
	startedAt: Timestamp;
	visitedCount: number;
	matchedCount: number;
	warnings: ScanWarningSummary;
}

export type ScanState =
	| (ScanStateFields & { status: "running"; finishedAt: null })
	| (ScanStateFields & { status: "completed"; finishedAt: Timestamp })
	| (ScanStateFields & {
			status: "failed";
			finishedAt: Timestamp;
			error: LibraryIssue;
	  })
	| (ScanStateFields & { status: "cancelled"; finishedAt: Timestamp });

export interface LibraryIssue {
	code:
		| "RESOURCE_ROOT_NOT_CONFIGURED"
		| "RESOURCE_ROOT_UNAVAILABLE"
		| "SCAN_FAILED";
	message: string;
}
