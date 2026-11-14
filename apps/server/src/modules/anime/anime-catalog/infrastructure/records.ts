import { asc, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { metadataWorks } from "../../external-works/metadata/persistence.js";
import { airedEpisodeCount } from "../../external-works/metadata/public.js";
import type {
	Association,
	ConfirmationResult,
	LocalWork,
} from "../domain/model.js";
import * as s from "./schema.js";

export function readCatalogWorks(
	row: typeof s.catalogWorks.$inferSelect,
	info: typeof metadataWorks.$inferSelect,
): LocalWork {
	const nextAiringEpisode =
		info.nextAiringEpisode !== null && info.nextAiringAt !== null
			? { episode: info.nextAiringEpisode, airingAt: info.nextAiringAt }
			: null;
	return {
		...row,
		providerTitle: info.providerTitle,
		titleVariants: info.titles,
		searchTitles: info.titles.map((title) => title.value),
		format: info.format,
		year: info.year,
		episodeCount: info.episodeCount,
		airedEpisodeCount: airedEpisodeCount({
			status: info.status,
			episodeCount: info.episodeCount,
			nextAiringEpisode,
		}),
	};
}
export function writeCatalogWorks(store: Store, value: LocalWork): void {
	const row = {
		id: value.id,
		revision: value.revision,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
	store
		.insert(s.catalogWorks)
		.values(row)
		.onConflictDoUpdate({ target: s.catalogWorks.id, set: row })
		.run();
}

export function readCatalogAssociations(
	store: Store,
	row: typeof s.catalogAssociations.$inferSelect,
): Association & { id: string } {
	return {
		id: row.id,
		sourceId: row.sourceId,
		episodeId: row.episodeId,
		rawNumbers: store
			.select()
			.from(s.catalogAssociationsRawNumbers)
			.where(eq(s.catalogAssociationsRawNumbers.parentId, row.id))
			.orderBy(asc(s.catalogAssociationsRawNumbers.ordinalIndex))
			.all()
			.map((child) => ({ value: child.value }))
			.map((item) => item.value),
		reason: row.reason,
		operationKey: row.operationKey,
		offset: row.offset,
	} as Association & { id: string };
}

export function writeCatalogAssociations(
	connection: Store,
	value: Association & { id: string },
): void {
	connection.transaction((store) => {
		const row0 = {
			id: value?.id,
			sourceId: value?.sourceId,
			episodeId: value?.episodeId,
			reason: value?.reason,
			operationKey: value?.operationKey,
			offset: value?.offset,
		};
		store
			.insert(s.catalogAssociations)
			.values(row0)
			.onConflictDoUpdate({ target: s.catalogAssociations.id, set: row0 })
			.run();
		store
			.delete(s.catalogAssociationsRawNumbers)
			.where(eq(s.catalogAssociationsRawNumbers.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.rawNumbers ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.catalogAssociationsRawNumbers).values(row1).run();
		}
	});
}

export function readCatalogOperations(
	store: Store,
	row: typeof s.catalogOperations.$inferSelect,
): { key: string; fingerprint: string; result: ConfirmationResult } {
	return {
		key: row.key,
		fingerprint: row.fingerprint,
		result: {
			workId: row.resultWorkId,
			revision: row.resultRevision,
			reviewIds: store
				.select()
				.from(s.catalogOperationsResultReviewIds)
				.where(eq(s.catalogOperationsResultReviewIds.parentId, row.key))
				.orderBy(asc(s.catalogOperationsResultReviewIds.ordinalIndex))
				.all()
				.map((child) => ({ value: child.value }))
				.map((item) => item.value),
		},
	} as { key: string; fingerprint: string; result: ConfirmationResult };
}

export function writeCatalogOperations(
	connection: Store,
	value: { key: string; fingerprint: string; result: ConfirmationResult },
): void {
	connection.transaction((store) => {
		const row0 = {
			key: value?.key,
			fingerprint: value?.fingerprint,
			resultWorkId: value?.result?.workId,
			resultRevision: value?.result?.revision,
		};
		store.insert(s.catalogOperations).values(row0).run();
		store
			.delete(s.catalogOperationsResultReviewIds)
			.where(eq(s.catalogOperationsResultReviewIds.parentId, value.key))
			.run();
		for (const [index1, item1] of (value?.result?.reviewIds ?? []).entries()) {
			const parent1 = value.key;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.catalogOperationsResultReviewIds).values(row1).run();
		}
	});
}
