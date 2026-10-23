import { asc, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import { workReference } from "../../../../shared/external-reference.js";
import { metadataWorks, saveWorkSummary } from "../../metadata/persistence.js";
import type { TrackingListCache } from "../domain/list.js";
import type { TrackingOperation } from "../domain/operation.js";
import * as s from "./schema.js";

export function readTrackingOperations(
	_store: Store,
	row: typeof s.trackingOperations.$inferSelect,
): TrackingOperation {
	return {
		origin: row.origin,
		commandId: row.commandId,
		intentAt: row.intentAt,
		target: row.targetPresent
			? {
					fileId: row.targetFileId,
					sourceVersion: row.targetSourceVersion,
					reviewId: row.targetReviewId,
					mappingRevision: row.targetMappingRevision,
					episodeId: row.targetEpisodeId,
					mediaId: row.targetMediaId,
					episode: row.targetEpisode,
				}
			: null,
		decisionReason: row.decisionReason,
		id: row.id,
		accountId: row.accountId,
		mediaId: row.mediaId,
		revision: row.revision,
		baseline: row.baselinePresent
			? {
					id: row.baselineId,
					progress: row.baselineProgress,
					status: row.baselineStatus,
					updatedAt: row.baselineUpdatedAt,
				}
			: null,
		desired: {
			...(row.desiredProgress !== null
				? {
						progress:
							row.desiredProgress !== null ? row.desiredProgress : undefined,
					}
				: {}),
			...(row.desiredStatus !== null
				? { status: row.desiredStatus !== null ? row.desiredStatus : undefined }
				: {}),
		},
		state: row.state,
		remote: row.remotePresent
			? {
					id: row.remoteId,
					progress: row.remoteProgress,
					status: row.remoteStatus,
					updatedAt: row.remoteUpdatedAt,
				}
			: null,
		attempt: row.attemptPresent
			? {
					revision: row.attemptRevision,
					baseline: row.attemptBaselinePresent
						? {
								id: row.attemptBaselineId,
								progress: row.attemptBaselineProgress,
								status: row.attemptBaselineStatus,
								updatedAt: row.attemptBaselineUpdatedAt,
							}
						: null,
					desired: {
						...(row.attemptDesiredProgress !== null
							? {
									progress:
										row.attemptDesiredProgress !== null
											? row.attemptDesiredProgress
											: undefined,
								}
							: {}),
						...(row.attemptDesiredStatus !== null
							? {
									status:
										row.attemptDesiredStatus !== null
											? row.attemptDesiredStatus
											: undefined,
								}
							: {}),
					},
				}
			: null,
		attempts: row.attempts,
		retryAt: row.retryAt,
		error: row.error,
		updatedAt: row.updatedAt,
	} as TrackingOperation;
}

export function writeTrackingOperations(
	connection: Store,
	value: TrackingOperation,
): void {
	connection.transaction((store) => {
		const row0 = {
			origin: value?.origin,
			commandId: value?.commandId,
			intentAt: value?.intentAt,
			targetPresent: value?.target !== null && value?.target !== undefined,
			targetFileId: value?.target?.fileId ?? null,
			targetSourceVersion: value?.target?.sourceVersion ?? null,
			targetReviewId: value?.target?.reviewId ?? null,
			targetMappingRevision: value?.target?.mappingRevision ?? null,
			targetEpisodeId: value?.target?.episodeId ?? null,
			targetMediaId: value?.target?.mediaId ?? null,
			targetEpisode: value?.target?.episode ?? null,
			decisionReason: value?.decisionReason ?? null,
			id: value?.id,
			accountId: value?.accountId,
			mediaId: value?.mediaId,
			revision: value?.revision,
			baselinePresent:
				value?.baseline !== null && value?.baseline !== undefined,
			baselineId: value?.baseline?.id ?? null,
			baselineProgress: value?.baseline?.progress ?? null,
			baselineStatus: value?.baseline?.status ?? null,
			baselineUpdatedAt: value?.baseline?.updatedAt ?? null,
			desiredProgress: value?.desired?.progress ?? null,
			desiredStatus: value?.desired?.status ?? null,
			state: value?.state,
			remotePresent: value?.remote !== null && value?.remote !== undefined,
			remoteId: value?.remote?.id ?? null,
			remoteProgress: value?.remote?.progress ?? null,
			remoteStatus: value?.remote?.status ?? null,
			remoteUpdatedAt: value?.remote?.updatedAt ?? null,
			attemptPresent: value?.attempt !== null && value?.attempt !== undefined,
			attemptRevision: value?.attempt?.revision ?? null,
			attemptBaselinePresent:
				value?.attempt?.baseline !== null &&
				value?.attempt?.baseline !== undefined,
			attemptBaselineId: value?.attempt?.baseline?.id ?? null,
			attemptBaselineProgress: value?.attempt?.baseline?.progress ?? null,
			attemptBaselineStatus: value?.attempt?.baseline?.status ?? null,
			attemptBaselineUpdatedAt: value?.attempt?.baseline?.updatedAt ?? null,
			attemptDesiredProgress: value?.attempt?.desired?.progress ?? null,
			attemptDesiredStatus: value?.attempt?.desired?.status ?? null,
			attempts: value?.attempts,
			retryAt: value?.retryAt ?? null,
			error: value?.error ?? null,
			updatedAt: value?.updatedAt,
		};
		store
			.insert(s.trackingOperations)
			.values(row0)
			.onConflictDoUpdate({ target: s.trackingOperations.id, set: row0 })
			.run();
	});
}

/** Summary fields are hydrated with one join, never stored per account. */
export function readTrackingListCache(
	store: Store,
	row: typeof s.trackingListCache.$inferSelect,
): TrackingListCache {
	const entries = store
		.select({ entry: s.trackingListCacheEntries, info: metadataWorks })
		.from(s.trackingListCacheEntries)
		.innerJoin(
			metadataWorks,
			eq(metadataWorks.key, s.trackingListCacheEntries.mediaId),
		)
		.where(eq(s.trackingListCacheEntries.parentId, row.accountId))
		.orderBy(asc(s.trackingListCacheEntries.ordinalIndex))
		.all();
	return {
		...row,
		invalidated: row.invalidated ?? false,
		entries: entries.map(({ entry, info }) => ({
			id: entry.id,
			mediaId: entry.mediaId,
			progress: entry.progress,
			status: entry.status,
			updatedAt: entry.updatedAt,
			titles: info.titles
				.toSorted(
					(a, b) => Number(b.kind === "native") - Number(a.kind === "native"),
				)
				.map((title) => title.value),
			format: info.format,
			year: info.year,
			episodeCount: info.episodeCount,
			coverUrl: info.coverUrl,
		})),
	};
}
export function writeTrackingListCache(
	connection: Store,
	value: TrackingListCache,
): void {
	connection.transaction((store) => {
		const row = {
			accountId: value.accountId,
			fetchedAt: value.fetchedAt,
			invalidated: value.invalidated ?? false,
		};
		store
			.insert(s.trackingListCache)
			.values(row)
			.onConflictDoUpdate({ target: s.trackingListCache.accountId, set: row })
			.run();
		store
			.delete(s.trackingListCacheEntries)
			.where(eq(s.trackingListCacheEntries.parentId, value.accountId))
			.run();
		for (const [index, entry] of value.entries.entries()) {
			saveWorkSummary(
				store,
				{
					reference: workReference(entry.mediaId),
					titles: entry.titles.map((value) => ({
						value,
						language: null,
						kind: "native" as const,
					})),
					format: entry.format,
					year: entry.year,
					episodeCount: entry.episodeCount,
					status: null,
					nextAiringEpisode: null,
					coverUrl: entry.coverUrl,
				},
				value.fetchedAt,
			);
			store
				.insert(s.trackingListCacheEntries)
				.values({
					rowId: `${value.accountId}/${index}`,
					parentId: value.accountId,
					ordinalIndex: index,
					id: entry.id,
					mediaId: entry.mediaId,
					progress: entry.progress,
					status: entry.status,
					updatedAt: entry.updatedAt,
				})
				.run();
		}
	});
}
