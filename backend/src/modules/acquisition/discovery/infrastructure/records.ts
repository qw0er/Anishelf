import { asc, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { Candidate, FeedRecord, Subscription } from "../domain/model.js";
import * as s from "./schema.js";

export function readAcquisitionFeeds(
	store: Store,
	row: typeof s.acquisitionFeeds.$inferSelect,
): FeedRecord {
	return {
		revision: row.revision,
		id: row.id,
		url: row.url,
		etag: row.etag,
		lastModified: row.lastModified,
		checkedAt: row.checkedAt,
		nextAttemptAt: row.nextAttemptAt,
		failures: row.failures,
		error: row.error,
		entries: store
			.select()
			.from(s.acquisitionFeedsEntries)
			.where(eq(s.acquisitionFeedsEntries.parentId, row.id))
			.orderBy(asc(s.acquisitionFeedsEntries.ordinalIndex))
			.all()
			.map((child) => ({
				id: child.id,
				observationId: child.observationId,
				title: child.title,
				publishedAt: child.publishedAt,
				downloadUrl: child.downloadUrl,
				hash: child.hash,
			})),
	} as FeedRecord;
}

export function writeAcquisitionFeeds(
	connection: Store,
	value: FeedRecord,
): void {
	connection.transaction((store) => {
		const row0 = {
			revision: value?.revision,
			id: value?.id,
			url: value?.url,
			etag: value?.etag ?? null,
			lastModified: value?.lastModified ?? null,
			checkedAt: value?.checkedAt ?? null,
			nextAttemptAt: value?.nextAttemptAt,
			failures: value?.failures,
			error: value?.error ?? null,
		};
		store
			.insert(s.acquisitionFeeds)
			.values(row0)
			.onConflictDoUpdate({ target: s.acquisitionFeeds.id, set: row0 })
			.run();
		store
			.delete(s.acquisitionFeedsEntries)
			.where(eq(s.acquisitionFeedsEntries.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.entries ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				id: item1?.id,
				observationId: item1?.observationId,
				title: item1?.title,
				publishedAt: item1?.publishedAt ?? null,
				downloadUrl: item1?.downloadUrl ?? null,
				hash: item1?.hash ?? null,
			};
			store.insert(s.acquisitionFeedsEntries).values(row1).run();
		}
	});
}

export function readAcquisitionSubscriptions(
	_store: Store,
	row: typeof s.acquisitionSubscriptions.$inferSelect,
): Subscription {
	return {
		...(row.lastErrorPresent
			? { lastError: row.lastErrorPresent ? row.lastError : undefined }
			: {}),
		workKey: row.workKey,
		feedId: row.feedId,
		startEpisode: row.startEpisode,
		enabled: row.enabled,
		revision: row.revision,
	} as Subscription;
}

export function writeAcquisitionSubscriptions(
	connection: Store,
	value: Subscription,
): void {
	connection.transaction((store) => {
		const row0 = {
			lastError: value?.lastError ?? null,
			lastErrorPresent: value?.lastError !== undefined,
			workKey: value?.workKey,
			feedId: value?.feedId,
			startEpisode: value?.startEpisode,
			enabled: value?.enabled,
			revision: value?.revision,
		};
		store
			.insert(s.acquisitionSubscriptions)
			.values(row0)
			.onConflictDoUpdate({
				target: s.acquisitionSubscriptions.workKey,
				set: row0,
			})
			.run();
	});
}

export function readAcquisitionCandidates(
	store: Store,
	row: typeof s.acquisitionCandidates.$inferSelect,
): Candidate {
	return {
		...(row.chosen !== null
			? { chosen: row.chosen !== null ? row.chosen : undefined }
			: {}),
		id: row.id,
		workKey: row.workKey,
		entryId: row.entryId,
		title: row.title,
		episode: row.episode,
		status: row.status,
		reasons: store
			.select()
			.from(s.acquisitionCandidatesReasons)
			.where(eq(s.acquisitionCandidatesReasons.parentId, row.id))
			.orderBy(asc(s.acquisitionCandidatesReasons.ordinalIndex))
			.all()
			.map((child) => ({ value: child.value }))
			.map((item) => item.value),
		version: row.version,
		snapshotId: row.snapshotId,
		publishedAt: row.publishedAt,
	} as Candidate;
}

export function writeAcquisitionCandidates(
	connection: Store,
	value: Candidate,
): void {
	connection.transaction((store) => {
		const row0 = {
			chosen: value?.chosen ?? null,
			id: value?.id,
			workKey: value?.workKey,
			entryId: value?.entryId,
			title: value?.title,
			episode: value?.episode ?? null,
			status: value?.status,
			version: value?.version,
			snapshotId: value?.snapshotId,
			publishedAt: value?.publishedAt ?? null,
		};
		store
			.insert(s.acquisitionCandidates)
			.values(row0)
			.onConflictDoUpdate({ target: s.acquisitionCandidates.id, set: row0 })
			.run();
		store
			.delete(s.acquisitionCandidatesReasons)
			.where(eq(s.acquisitionCandidatesReasons.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.reasons ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.acquisitionCandidatesReasons).values(row1).run();
		}
	});
}
