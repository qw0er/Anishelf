import { asc, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import * as s from "./schema.js";
import type { NormalizedSnapshot } from "./snapshot-record.js";

export function readMetadataSnapshots(
	store: Store,
	row: typeof s.metadataSnapshots.$inferSelect,
): NormalizedSnapshot {
	return {
		id: row.id,
		key: row.key,
		kind: row.kind,
		fetchedAt: row.fetchedAt,
		expiresAt: row.expiresAt,
		accessedAt: row.accessedAt,
		failure: row.failurePresent
			? {
					code: row.failureCode,
					message: row.failureMessage,
					retryAt: row.failureRetryAt,
				}
			: null,
		page: row.page,
		perPage: row.perPage,
		hasNextPage: row.hasNextPage,
		detail: row.detailPresent
			? {
					unavailableFields: store
						.select()
						.from(s.metadataSnapshotsDetailUnavailableFields)
						.where(
							eq(s.metadataSnapshotsDetailUnavailableFields.parentId, row.id),
						)
						.orderBy(
							asc(s.metadataSnapshotsDetailUnavailableFields.ordinalIndex),
						)
						.all()
						.map((child) => ({ value: child.value }))
						.map((item) => item.value),
					reference: {
						provider: row.detailReferenceProvider,
						mediaType: row.detailReferenceMediaType,
						id: row.detailReferenceId,
					},
					titles: store
						.select()
						.from(s.metadataSnapshotsDetailTitles)
						.where(eq(s.metadataSnapshotsDetailTitles.parentId, row.id))
						.orderBy(asc(s.metadataSnapshotsDetailTitles.ordinalIndex))
						.all()
						.map((child) => ({
							value: child.value,
							language: child.language,
							kind: child.kind,
						})),
					year: row.detailYear,
					format: row.detailFormat,
					status: row.detailStatus,
					episodeCount: row.detailEpisodeCount,
					airingSeason: row.detailAiringSeason,
					coverUrl: row.detailCoverUrl,
					description: row.detailDescription,
					bannerUrl: row.detailBannerUrl,
					startDate: row.detailStartDatePresent
						? {
								year: row.detailStartDateYear,
								month: row.detailStartDateMonth,
								day: row.detailStartDateDay,
							}
						: null,
					endDate: row.detailEndDatePresent
						? {
								year: row.detailEndDateYear,
								month: row.detailEndDateMonth,
								day: row.detailEndDateDay,
							}
						: null,
					durationMinutes: row.detailDurationMinutes,
					country: row.detailCountry,
					source: row.detailSource,
					genres: store
						.select()
						.from(s.metadataSnapshotsDetailGenres)
						.where(eq(s.metadataSnapshotsDetailGenres.parentId, row.id))
						.orderBy(asc(s.metadataSnapshotsDetailGenres.ordinalIndex))
						.all()
						.map((child) => ({ value: child.value }))
						.map((item) => item.value),
					tags: store
						.select()
						.from(s.metadataSnapshotsDetailTags)
						.where(eq(s.metadataSnapshotsDetailTags.parentId, row.id))
						.orderBy(asc(s.metadataSnapshotsDetailTags.ordinalIndex))
						.all()
						.map((child) => ({
							name: child.name,
							rank: child.rank,
							spoiler: child.spoiler,
						})),
					studios: store
						.select()
						.from(s.metadataSnapshotsDetailStudios)
						.where(eq(s.metadataSnapshotsDetailStudios.parentId, row.id))
						.orderBy(asc(s.metadataSnapshotsDetailStudios.ordinalIndex))
						.all()
						.map((child) => ({ id: child.id, name: child.name })),
					averageScore: row.detailAverageScore,
					siteUrl: row.detailSiteUrl,
					providerUpdatedAt: row.detailProviderUpdatedAt,
					streamingEpisodes: store
						.select()
						.from(s.metadataSnapshotsDetailStreamingEpisodes)
						.where(
							eq(s.metadataSnapshotsDetailStreamingEpisodes.parentId, row.id),
						)
						.orderBy(
							asc(s.metadataSnapshotsDetailStreamingEpisodes.ordinalIndex),
						)
						.all()
						.map((child) => ({
							title: child.title,
							url: child.url,
							site: child.site,
							thumbnail: child.thumbnail,
						})),
					episodeCatalog: row.detailEpisodeCatalog,
				}
			: null,
		items: store
			.select()
			.from(s.metadataSnapshotsItems)
			.where(eq(s.metadataSnapshotsItems.parentId, row.id))
			.orderBy(asc(s.metadataSnapshotsItems.ordinalIndex))
			.all()
			.map((child) => ({
				unavailableFields: store
					.select()
					.from(s.metadataSnapshotsItemsUnavailableFields)
					.where(
						eq(s.metadataSnapshotsItemsUnavailableFields.parentId, child.rowId),
					)
					.orderBy(asc(s.metadataSnapshotsItemsUnavailableFields.ordinalIndex))
					.all()
					.map((child) => ({ value: child.value }))
					.map((item) => item.value),
				reference: {
					provider: child.referenceProvider,
					mediaType: child.referenceMediaType,
					id: child.referenceId,
				},
				titles: store
					.select()
					.from(s.metadataSnapshotsItemsTitles)
					.where(eq(s.metadataSnapshotsItemsTitles.parentId, child.rowId))
					.orderBy(asc(s.metadataSnapshotsItemsTitles.ordinalIndex))
					.all()
					.map((child) => ({
						value: child.value,
						language: child.language,
						kind: child.kind,
					})),
				year: child.year,
				format: child.format,
				status: child.status,
				episodeCount: child.episodeCount,
				airingSeason: child.airingSeason,
				coverUrl: child.coverUrl,
			})),
		relations: store
			.select()
			.from(s.metadataSnapshotsRelations)
			.where(eq(s.metadataSnapshotsRelations.parentId, row.id))
			.orderBy(asc(s.metadataSnapshotsRelations.ordinalIndex))
			.all()
			.map((child) => ({
				type: child.type,
				work: {
					unavailableFields: store
						.select()
						.from(s.metadataSnapshotsRelationsWorkUnavailableFields)
						.where(
							eq(
								s.metadataSnapshotsRelationsWorkUnavailableFields.parentId,
								child.rowId,
							),
						)
						.orderBy(
							asc(
								s.metadataSnapshotsRelationsWorkUnavailableFields.ordinalIndex,
							),
						)
						.all()
						.map((child) => ({ value: child.value }))
						.map((item) => item.value),
					reference: {
						provider: child.workReferenceProvider,
						mediaType: child.workReferenceMediaType,
						id: child.workReferenceId,
					},
					titles: store
						.select()
						.from(s.metadataSnapshotsRelationsWorkTitles)
						.where(
							eq(s.metadataSnapshotsRelationsWorkTitles.parentId, child.rowId),
						)
						.orderBy(asc(s.metadataSnapshotsRelationsWorkTitles.ordinalIndex))
						.all()
						.map((child) => ({
							value: child.value,
							language: child.language,
							kind: child.kind,
						})),
					year: child.workYear,
					format: child.workFormat,
					status: child.workStatus,
					episodeCount: child.workEpisodeCount,
					airingSeason: child.workAiringSeason,
					coverUrl: child.workCoverUrl,
				},
			})),
		airing: store
			.select()
			.from(s.metadataSnapshotsAiring)
			.where(eq(s.metadataSnapshotsAiring.parentId, row.id))
			.orderBy(asc(s.metadataSnapshotsAiring.ordinalIndex))
			.all()
			.map((child) => ({
				id: child.id,
				episode: child.episode,
				airingAt: child.airingAt,
			})),
	} as NormalizedSnapshot;
}

export function writeMetadataSnapshots(
	connection: Store,
	value: NormalizedSnapshot,
): void {
	connection.transaction((store) => {
		const row0 = {
			id: value?.id,
			key: value?.key,
			kind: value?.kind,
			fetchedAt: value?.fetchedAt,
			expiresAt: value?.expiresAt,
			accessedAt: value?.accessedAt,
			failurePresent: value?.failure !== null && value?.failure !== undefined,
			failureCode: value?.failure?.code ?? null,
			failureMessage: value?.failure?.message ?? null,
			failureRetryAt: value?.failure?.retryAt ?? null,
			page: value?.page ?? null,
			perPage: value?.perPage ?? null,
			hasNextPage: value?.hasNextPage ?? null,
			detailPresent: value?.detail !== null && value?.detail !== undefined,
			detailReferenceProvider: value?.detail?.reference?.provider ?? null,
			detailReferenceMediaType: value?.detail?.reference?.mediaType ?? null,
			detailReferenceId: value?.detail?.reference?.id ?? null,
			detailYear: value?.detail?.year ?? null,
			detailFormat: value?.detail?.format ?? null,
			detailStatus: value?.detail?.status ?? null,
			detailEpisodeCount: value?.detail?.episodeCount ?? null,
			detailAiringSeason: value?.detail?.airingSeason ?? null,
			detailCoverUrl: value?.detail?.coverUrl ?? null,
			detailDescription: value?.detail?.description ?? null,
			detailBannerUrl: value?.detail?.bannerUrl ?? null,
			detailStartDatePresent:
				value?.detail?.startDate !== null &&
				value?.detail?.startDate !== undefined,
			detailStartDateYear: value?.detail?.startDate?.year ?? null,
			detailStartDateMonth: value?.detail?.startDate?.month ?? null,
			detailStartDateDay: value?.detail?.startDate?.day ?? null,
			detailEndDatePresent:
				value?.detail?.endDate !== null && value?.detail?.endDate !== undefined,
			detailEndDateYear: value?.detail?.endDate?.year ?? null,
			detailEndDateMonth: value?.detail?.endDate?.month ?? null,
			detailEndDateDay: value?.detail?.endDate?.day ?? null,
			detailDurationMinutes: value?.detail?.durationMinutes ?? null,
			detailCountry: value?.detail?.country ?? null,
			detailSource: value?.detail?.source ?? null,
			detailAverageScore: value?.detail?.averageScore ?? null,
			detailSiteUrl: value?.detail?.siteUrl ?? null,
			detailProviderUpdatedAt: value?.detail?.providerUpdatedAt ?? null,
			detailEpisodeCatalog: value?.detail?.episodeCatalog ?? null,
		};
		store
			.insert(s.metadataSnapshots)
			.values(row0)
			.onConflictDoUpdate({ target: s.metadataSnapshots.id, set: row0 })
			.run();
		store
			.delete(s.metadataSnapshotsDetailUnavailableFields)
			.where(eq(s.metadataSnapshotsDetailUnavailableFields.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.detail?.unavailableFields ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store
				.insert(s.metadataSnapshotsDetailUnavailableFields)
				.values(row1)
				.run();
		}
		store
			.delete(s.metadataSnapshotsDetailTitles)
			.where(eq(s.metadataSnapshotsDetailTitles.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.detail?.titles ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: item1?.value,
				language: item1?.language ?? null,
				kind: item1?.kind,
			};
			store.insert(s.metadataSnapshotsDetailTitles).values(row1).run();
		}
		store
			.delete(s.metadataSnapshotsDetailGenres)
			.where(eq(s.metadataSnapshotsDetailGenres.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.detail?.genres ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.metadataSnapshotsDetailGenres).values(row1).run();
		}
		store
			.delete(s.metadataSnapshotsDetailTags)
			.where(eq(s.metadataSnapshotsDetailTags.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.detail?.tags ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				name: item1?.name,
				rank: item1?.rank ?? null,
				spoiler: item1?.spoiler,
			};
			store.insert(s.metadataSnapshotsDetailTags).values(row1).run();
		}
		store
			.delete(s.metadataSnapshotsDetailStudios)
			.where(eq(s.metadataSnapshotsDetailStudios.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.detail?.studios ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				id: item1?.id,
				name: item1?.name,
			};
			store.insert(s.metadataSnapshotsDetailStudios).values(row1).run();
		}
		store
			.delete(s.metadataSnapshotsDetailStreamingEpisodes)
			.where(eq(s.metadataSnapshotsDetailStreamingEpisodes.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.detail?.streamingEpisodes ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				title: item1?.title ?? null,
				url: item1?.url ?? null,
				site: item1?.site ?? null,
				thumbnail: item1?.thumbnail ?? null,
			};
			store
				.insert(s.metadataSnapshotsDetailStreamingEpisodes)
				.values(row1)
				.run();
		}
		store
			.delete(s.metadataSnapshotsItems)
			.where(eq(s.metadataSnapshotsItems.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.items ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				referenceProvider: item1?.reference?.provider,
				referenceMediaType: item1?.reference?.mediaType,
				referenceId: item1?.reference?.id,
				year: item1?.year ?? null,
				format: item1?.format ?? null,
				status: item1?.status ?? null,
				episodeCount: item1?.episodeCount ?? null,
				airingSeason: item1?.airingSeason ?? null,
				coverUrl: item1?.coverUrl ?? null,
			};
			store.insert(s.metadataSnapshotsItems).values(row1).run();
			store
				.delete(s.metadataSnapshotsItemsUnavailableFields)
				.where(eq(s.metadataSnapshotsItemsUnavailableFields.parentId, id1))
				.run();
			for (const [index2, item2] of (
				item1?.unavailableFields ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store
					.insert(s.metadataSnapshotsItemsUnavailableFields)
					.values(row2)
					.run();
			}
			store
				.delete(s.metadataSnapshotsItemsTitles)
				.where(eq(s.metadataSnapshotsItemsTitles.parentId, id1))
				.run();
			for (const [index2, item2] of (item1?.titles ?? []).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: item2?.value,
					language: item2?.language ?? null,
					kind: item2?.kind,
				};
				store.insert(s.metadataSnapshotsItemsTitles).values(row2).run();
			}
		}
		store
			.delete(s.metadataSnapshotsRelations)
			.where(eq(s.metadataSnapshotsRelations.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.relations ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				type: item1?.type,
				workReferenceProvider: item1?.work?.reference?.provider,
				workReferenceMediaType: item1?.work?.reference?.mediaType,
				workReferenceId: item1?.work?.reference?.id,
				workYear: item1?.work?.year ?? null,
				workFormat: item1?.work?.format ?? null,
				workStatus: item1?.work?.status ?? null,
				workEpisodeCount: item1?.work?.episodeCount ?? null,
				workAiringSeason: item1?.work?.airingSeason ?? null,
				workCoverUrl: item1?.work?.coverUrl ?? null,
			};
			store.insert(s.metadataSnapshotsRelations).values(row1).run();
			store
				.delete(s.metadataSnapshotsRelationsWorkUnavailableFields)
				.where(
					eq(s.metadataSnapshotsRelationsWorkUnavailableFields.parentId, id1),
				)
				.run();
			for (const [index2, item2] of (
				item1?.work?.unavailableFields ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store
					.insert(s.metadataSnapshotsRelationsWorkUnavailableFields)
					.values(row2)
					.run();
			}
			store
				.delete(s.metadataSnapshotsRelationsWorkTitles)
				.where(eq(s.metadataSnapshotsRelationsWorkTitles.parentId, id1))
				.run();
			for (const [index2, item2] of (item1?.work?.titles ?? []).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: item2?.value,
					language: item2?.language ?? null,
					kind: item2?.kind,
				};
				store.insert(s.metadataSnapshotsRelationsWorkTitles).values(row2).run();
			}
		}
		store
			.delete(s.metadataSnapshotsAiring)
			.where(eq(s.metadataSnapshotsAiring.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.airing ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				id: item1?.id,
				episode: item1?.episode,
				airingAt: item1?.airingAt,
			};
			store.insert(s.metadataSnapshotsAiring).values(row1).run();
		}
	});
}
