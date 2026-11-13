import type {
	CompletionOutcome,
	CompletionRecord,
} from "../domain/completion.js";
export interface CompletionStorageRecord {
	id: string;
	sourceId: string;
	attemptedAt: number;
	context: {
		version: number;
		accountId: string;
		generation: string;
		manualVersion: number;
		fileId: string;
		sourceVersion: string;
		reviewId: string;
		mappingRevision: number;
		episodeId: string;
		mediaId: string;
		episode: number;
	};
	outcome: CompletionOutcome;
}
export function encodeCompletion(
	record: CompletionRecord,
): CompletionStorageRecord {
	const value = JSON.parse(
		record.context,
	) as CompletionStorageRecord["context"];

	return {
		...record,
		attemptedAt: Date.now(),
		context: value,
	};
}
export function decodeCompletion(
	record: CompletionStorageRecord,
): CompletionRecord {
	return {
		id: record.id,
		sourceId: record.sourceId,
		outcome: record.outcome,
		context: JSON.stringify(record.context),
	};
}
