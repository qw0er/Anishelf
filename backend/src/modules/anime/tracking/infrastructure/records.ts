import { asc, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
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

export function readTrackingListCache(
	store: Store,
	row: typeof s.trackingListCache.$inferSelect,
): TrackingListCache {
	return {
		...(row.invalidated !== null
			? { invalidated: row.invalidated !== null ? row.invalidated : undefined }
			: {}),
		accountId: row.accountId,
		fetchedAt: row.fetchedAt,
		entries: store
			.select()
			.from(s.trackingListCacheEntries)
			.where(eq(s.trackingListCacheEntries.parentId, row.accountId))
			.orderBy(asc(s.trackingListCacheEntries.ordinalIndex))
			.all()
			.map((child) => ({
				id: child.id,
				mediaId: child.mediaId,
				progress: child.progress,
				status: child.status,
				updatedAt: child.updatedAt,
				titles: store
					.select()
					.from(s.trackingListCacheEntriesTitles)
					.where(eq(s.trackingListCacheEntriesTitles.parentId, child.rowId))
					.orderBy(asc(s.trackingListCacheEntriesTitles.ordinalIndex))
					.all()
					.map((child) => ({ value: child.value }))
					.map((item) => item.value),
				format: child.format,
				year: child.year,
				episodeCount: child.episodeCount,
				coverUrl: child.coverUrl,
			})),
	} as TrackingListCache;
}

export function writeTrackingListCache(
	connection: Store,
	value: TrackingListCache,
): void {
	connection.transaction((store) => {
		const row0 = {
			invalidated: value?.invalidated ?? null,
			accountId: value?.accountId,
			fetchedAt: value?.fetchedAt,
		};
		store
			.insert(s.trackingListCache)
			.values(row0)
			.onConflictDoUpdate({ target: s.trackingListCache.accountId, set: row0 })
			.run();
		store
			.delete(s.trackingListCacheEntries)
			.where(eq(s.trackingListCacheEntries.parentId, value.accountId))
			.run();
		for (const [index1, item1] of (value?.entries ?? []).entries()) {
			const parent1 = value.accountId;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				id: item1?.id,
				mediaId: item1?.mediaId,
				progress: item1?.progress,
				status: item1?.status,
				updatedAt: item1?.updatedAt ?? null,
				format: item1?.format ?? null,
				year: item1?.year ?? null,
				episodeCount: item1?.episodeCount ?? null,
				coverUrl: item1?.coverUrl ?? null,
			};
			store.insert(s.trackingListCacheEntries).values(row1).run();
			store
				.delete(s.trackingListCacheEntriesTitles)
				.where(eq(s.trackingListCacheEntriesTitles.parentId, id1))
				.run();
			for (const [index2, item2] of (item1?.titles ?? []).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store.insert(s.trackingListCacheEntriesTitles).values(row2).run();
			}
		}
	});
}
