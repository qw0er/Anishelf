import { asc, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { FeedRecord } from "../domain/model.js";
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
				seeders: child.seeders,
				seedersObservedAt: child.seedersObservedAt,
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
		store
			.insert(s.acquisitionSources)
			.values({
				id: value.id,
				binding: { kind: "rss", url: value.url },
				enabled: false,
				failures: 0,
				snapshot: null,
			})
			.onConflictDoNothing()
			.run();
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
				seeders: item1.seeders ?? null,
				seedersObservedAt: item1.seedersObservedAt ?? null,
				title: item1?.title,
				publishedAt: item1?.publishedAt ?? null,
				downloadUrl: item1?.downloadUrl ?? null,
				hash: item1?.hash ?? null,
			};
			store.insert(s.acquisitionFeedsEntries).values(row1).run();
		}
	});
}
