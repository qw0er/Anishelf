import type { Store } from "../../../../platform/database/store.js";
import type { CompletionStorageRecord } from "./completion-record.js";
import * as s from "./schema.js";

export function readPlaybackCompletions(
	_store: Store,
	row: typeof s.playbackCompletions.$inferSelect,
): CompletionStorageRecord {
	return {
		id: row.id,
		sourceId: row.sourceId,
		attemptedAt: row.attemptedAt,
		context: {
			version: row.contextVersion,
			accountId: row.contextAccountId,
			generation: row.contextGeneration,
			manualVersion: row.contextManualVersion,
			fileId: row.contextFileId,
			sourceVersion: row.contextSourceVersion,
			reviewId: row.contextReviewId,
			mappingRevision: row.contextMappingRevision,
			episodeId: row.contextEpisodeId,
			mediaId: row.contextMediaId,
			episode: row.contextEpisode,
		},
		outcome: {
			state: row.outcomeState,
			reason: row.outcomeReason,
			...(row.outcomeOperationId !== null
				? {
						operationId:
							row.outcomeOperationId !== null
								? row.outcomeOperationId
								: undefined,
					}
				: {}),
			...(row.outcomeRevision !== null
				? {
						revision:
							row.outcomeRevision !== null ? row.outcomeRevision : undefined,
					}
				: {}),
		},
	} as CompletionStorageRecord;
}

export function writePlaybackCompletions(
	connection: Store,
	value: CompletionStorageRecord,
): void {
	connection.transaction((store) => {
		const row0 = {
			id: value?.id,
			sourceId: value?.sourceId,
			attemptedAt: value?.attemptedAt,
			contextVersion: value?.context?.version ?? null,
			contextAccountId: value?.context?.accountId ?? null,
			contextGeneration: value?.context?.generation ?? null,
			contextManualVersion: value?.context?.manualVersion ?? null,
			contextFileId: value?.context?.fileId ?? null,
			contextSourceVersion: value?.context?.sourceVersion ?? null,
			contextReviewId: value?.context?.reviewId ?? null,
			contextMappingRevision: value?.context?.mappingRevision ?? null,
			contextEpisodeId: value?.context?.episodeId ?? null,
			contextMediaId: value?.context?.mediaId ?? null,
			contextEpisode: value?.context?.episode ?? null,
			outcomeState: value?.outcome?.state,
			outcomeReason: value?.outcome?.reason,
			outcomeOperationId: value?.outcome?.operationId ?? null,
			outcomeRevision: value?.outcome?.revision ?? null,
		};
		store
			.insert(s.playbackCompletions)
			.values(row0)
			.onConflictDoUpdate({ target: s.playbackCompletions.id, set: row0 })
			.run();
	});
}
