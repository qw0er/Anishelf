import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import { DomainError } from "../../../../shared/errors.js";
import { fingerprint } from "../../../../shared/fingerprint.js";
import { mediaSources } from "../../../resources/persistence.js";
import type { SourceRegistry } from "../../../resources/public.js";
import { metadataWorks } from "../../metadata/persistence.js";

import type {
	Association,
	CatalogQuery,
	ConfirmationResult,
	LocalEpisode,
	LocalWork,
	Page,
	ProviderLink,
	ReviewRecord,
} from "../domain/model.js";
import type { CatalogStore } from "../ports.js";
import {
	readCatalogAssociations,
	readCatalogOperations,
	readCatalogReviews,
	readCatalogWorks,
	writeCatalogAssociations,
	writeCatalogOperations,
	writeCatalogReviews,
	writeCatalogWorks,
} from "./records.js";
import {
	catalogAssociations,
	catalogEpisodes,
	catalogOperations,
	catalogProviderLinks,
	catalogReviews,
	catalogReviewsResultProposals,
	catalogWorks,
} from "./schema.js";

type Connection = Pick<
	Store,
	"select" | "insert" | "update" | "delete" | "transaction"
>;

export class CatalogRepository implements CatalogStore {
	constructor(
		private readonly store: Connection,
		private readonly sources: SourceRegistry,
	) {}
	registerSource(...args: Parameters<SourceRegistry["registerSource"]>) {
		return this.sources.registerSource(...args);
	}
	transaction<T>(operation: (store: CatalogStore) => T): T {
		return this.store.transaction(
			(tx) => operation(new CatalogRepository(tx, this.sources)),
			{ behavior: "immediate" },
		);
	}
	private readReview(row: {
		review: typeof catalogReviews.$inferSelect;
		source: typeof mediaSources.$inferSelect;
	}): ReviewRecord {
		const result = readCatalogReviews(this.store, row.review).result;
		return {
			id: row.review.id,
			sourceId: row.source.id,
			rootId: row.source.rootId,
			fileId: row.source.fileId,
			relativePath: row.source.relativePath,
			sourceVersion: row.source.sourceVersion,
			scopeId: row.source.rootId,
			available: row.review.available,
			revision: row.review.revision,
			decision: row.review.decision,
			reason: row.review.reason,
			evidence: result.evidence,
			proposals: result.proposals,
			metadataStatus: result.metadataStatus,
			unresolved: result.unresolved,
		};
	}
	private reviewQuery() {
		return this.store
			.select({
				review: catalogReviews,
				source: mediaSources,
			})
			.from(catalogReviews)
			.innerJoin(mediaSources, eq(mediaSources.id, catalogReviews.id));
	}
	review(id: string): ReviewRecord | null {
		const row = this.reviewQuery().where(eq(catalogReviews.id, id)).get();
		return row ? this.readReview(row) : null;
	}
	reviews(
		scopeIds: readonly string[],
		decision: ReviewRecord["decision"] | undefined,
		page: number,
		perPage: number,
		reference?: ProviderLink["reference"],
	): Page<ReviewRecord> {
		const rows = this.reviewQuery()
			.where(
				and(
					inArray(mediaSources.rootId, [...scopeIds]),
					decision ? eq(catalogReviews.decision, decision) : undefined,
					reference
						? sql`exists (select 1 from ${catalogReviewsResultProposals} where ${catalogReviewsResultProposals.parentId} = ${catalogReviews.id} and ${catalogReviewsResultProposals.candidateWorkReferenceProvider} = ${reference.provider} and ${catalogReviewsResultProposals.candidateWorkReferenceMediaType} = ${reference.mediaType} and ${catalogReviewsResultProposals.candidateWorkReferenceId} = ${reference.id})`
						: undefined,
				),
			)
			.orderBy(asc(catalogReviews.id))
			.limit(perPage + 1)
			.offset((page - 1) * perPage)
			.all();
		return {
			items: rows.slice(0, perPage).map((row) => this.readReview(row)),
			page,
			perPage,
			hasNextPage: rows.length > perPage,
		};
	}
	publish(
		scopeIds: readonly string[],
		items: Parameters<CatalogStore["publish"]>[1],
		fileIds?: readonly string[],
	): void {
		this.transaction(() => {
			// Keep SQLite bind counts bounded even for very large directory removals.
			const scopes: Array<readonly string[] | undefined> = [];
			if (fileIds === undefined) scopes.push(undefined);
			else
				for (let offset = 0; offset < fileIds.length; offset += 500)
					scopes.push(fileIds.slice(offset, offset + 500));
			for (const scope of scopes) {
				const rootSources = this.store
					.select({ id: mediaSources.id })
					.from(mediaSources)
					.where(
						scope === undefined
							? inArray(mediaSources.rootId, [...scopeIds])
							: and(
									inArray(mediaSources.rootId, [...scopeIds]),
									inArray(mediaSources.fileId, [...scope]),
								),
					);
				this.store
					.update(catalogReviews)
					.set({ available: false })
					.where(inArray(catalogReviews.id, rootSources))
					.run();
			}
			for (const { source, result } of items) {
				const previous = this.store
					.select()
					.from(catalogReviews)
					.where(eq(catalogReviews.id, source.id))
					.get();
				const { source: _source, ...storedResult } = result;
				const changed =
					!previous ||
					fingerprint(readCatalogReviews(this.store, previous).result) !==
						fingerprint(storedResult);
				writeCatalogReviews(this.store, {
					id: source.id,
					result: storedResult,
					available: true,
					revision: previous ? previous.revision + Number(changed) : 1,
					decision: previous?.decision ?? "pending",
					reason: previous?.reason ?? null,
				});
			}
		});
	}
	private workQuery() {
		return this.store
			.select({ work: catalogWorks, info: metadataWorks })
			.from(catalogWorks)
			.innerJoin(
				catalogProviderLinks,
				eq(catalogProviderLinks.workId, catalogWorks.id),
			)
			.innerJoin(
				metadataWorks,
				and(
					eq(metadataWorks.provider, catalogProviderLinks.provider),
					eq(metadataWorks.providerId, catalogProviderLinks.providerId),
				),
			);
	}
	work(id: string): LocalWork | null {
		const row = this.workQuery().where(eq(catalogWorks.id, id)).get();
		return row ? readCatalogWorks(row.work, row.info) : null;
	}
	link(workId: string): ProviderLink | null {
		const row = this.store
			.select()
			.from(catalogProviderLinks)
			.where(eq(catalogProviderLinks.workId, workId))
			.get();
		return row
			? {
					workId,
					snapshotId: row.snapshotId,
					reference: {
						provider: row.provider,
						mediaType: row.mediaType,
						id: row.providerId,
					},
				}
			: null;
	}
	refreshWorks(afterId: string, limit: number): LocalWork[] {
		const associated = this.store
			.select({ id: catalogEpisodes.workId })
			.from(catalogEpisodes)
			.innerJoin(
				catalogAssociations,
				eq(catalogAssociations.episodeId, catalogEpisodes.id),
			);
		return this.workQuery()
			.where(
				and(gt(catalogWorks.id, afterId), inArray(catalogWorks.id, associated)),
			)
			.orderBy(asc(catalogWorks.id))
			.limit(limit)
			.all()
			.map((row) => readCatalogWorks(row.work, row.info));
	}
	findWork(reference: ProviderLink["reference"]): LocalWork | null {
		const row = this.workQuery()
			.where(
				and(
					eq(catalogProviderLinks.provider, reference.provider),
					eq(catalogProviderLinks.mediaType, reference.mediaType),
					eq(catalogProviderLinks.providerId, reference.id),
				),
			)
			.get();
		return row ? readCatalogWorks(row.work, row.info) : null;
	}
	list(
		scopeIds: readonly string[],
		query: CatalogQuery,
		page: number,
		perPage: number,
	): Page<LocalWork> {
		const rootWorks = this.store
			.select({ id: catalogEpisodes.workId })
			.from(catalogEpisodes)
			.innerJoin(
				catalogAssociations,
				eq(catalogAssociations.episodeId, catalogEpisodes.id),
			)
			.innerJoin(
				mediaSources,
				eq(mediaSources.id, catalogAssociations.sourceId),
			)
			.where(inArray(mediaSources.rootId, [...scopeIds]));
		const availableWorks = this.store
			.select({ id: catalogEpisodes.workId })
			.from(catalogEpisodes)
			.innerJoin(
				catalogAssociations,
				eq(catalogAssociations.episodeId, catalogEpisodes.id),
			)
			.innerJoin(
				mediaSources,
				eq(mediaSources.id, catalogAssociations.sourceId),
			)
			.innerJoin(catalogReviews, eq(catalogReviews.id, mediaSources.id))
			.where(
				and(
					inArray(mediaSources.rootId, [...scopeIds]),
					eq(catalogReviews.available, true),
				),
			);
		const pattern = `%${(query.query ?? "").replace(/[\\%_]/g, "\\$&")}%`;
		const title = sql`lower(${metadataWorks.providerTitle})`;
		const rows = this.workQuery()
			.where(
				and(
					inArray(catalogWorks.id, rootWorks),
					query.query
						? or(
								sql`${title} like ${pattern} escape '\\'`,
								sql`exists (select 1 from json_each(${metadataWorks.titles}) where json_extract(value, '$.value') like ${pattern} escape '\\')`,
							)
						: undefined,
					query.format ? eq(metadataWorks.format, query.format) : undefined,
					query.year !== undefined
						? eq(metadataWorks.year, query.year)
						: undefined,
					query.availability === "available"
						? inArray(catalogWorks.id, availableWorks)
						: query.availability === "unavailable"
							? sql`${catalogWorks.id} not in (${availableWorks})`
							: undefined,
				),
			)
			.orderBy(
				query.sort === "recent" ? desc(catalogWorks.createdAt) : asc(title),
				asc(catalogWorks.id),
			)
			.limit(perPage + 1)
			.offset((page - 1) * perPage)
			.all();
		return {
			items: rows
				.slice(0, perPage)
				.map((row) => readCatalogWorks(row.work, row.info)),
			page,
			perPage,
			hasNextPage: rows.length > perPage,
		};
	}
	saveWork(work: LocalWork, link: ProviderLink): void {
		this.store.transaction((store) => {
			writeCatalogWorks(store, work);
			store
				.insert(catalogProviderLinks)
				.values({
					workId: work.id,
					snapshotId: link.snapshotId,
					provider: link.reference.provider,
					mediaType: link.reference.mediaType,
					providerId: link.reference.id,
				})
				.onConflictDoUpdate({
					target: catalogProviderLinks.workId,
					set: { snapshotId: link.snapshotId },
				})
				.run();
		});
	}
	episodes(workId: string): LocalEpisode[] {
		return this.store
			.select()
			.from(catalogEpisodes)
			.where(eq(catalogEpisodes.workId, workId))
			.all();
	}
	saveEpisode(episode: LocalEpisode): void {
		this.store
			.insert(catalogEpisodes)
			.values(episode)
			.onConflictDoUpdate({ target: catalogEpisodes.id, set: episode })
			.run();
	}
	associations(sourceId: string) {
		return this.store
			.select({ association: catalogAssociations, episode: catalogEpisodes })
			.from(catalogAssociations)
			.innerJoin(
				catalogEpisodes,
				eq(catalogEpisodes.id, catalogAssociations.episodeId),
			)
			.where(eq(catalogAssociations.sourceId, sourceId))
			.all()
			.map((row) => ({
				...readCatalogAssociations(this.store, row.association),
				episode: row.episode,
			}));
	}
	versions(episodeId: string, scopeIds: readonly string[]) {
		const rows = this.store
			.select({ association: catalogAssociations })
			.from(catalogAssociations)
			.innerJoin(
				mediaSources,
				eq(mediaSources.id, catalogAssociations.sourceId),
			)
			.where(
				and(
					eq(catalogAssociations.episodeId, episodeId),
					inArray(mediaSources.rootId, [...scopeIds]),
				),
			)
			.orderBy(asc(catalogAssociations.sourceId))
			.all();
		return rows.map((row) => {
			const review = this.review(row.association.sourceId);
			if (!review)
				throw new Error("Associated catalog source has no review record.");
			return {
				review,
				association: readCatalogAssociations(this.store, row.association),
			};
		});
	}
	replaceAssociations(sourceId: string, associations: Association[]): void {
		this.store.transaction((store) => {
			store
				.delete(catalogAssociations)
				.where(eq(catalogAssociations.sourceId, sourceId))
				.run();
			for (const association of associations)
				writeCatalogAssociations(store, {
					...association,
					id: `${association.sourceId.length}:${association.sourceId}${association.episodeId}`,
				});
		});
	}
	decide(
		id: string,
		revision: number,
		decision: ReviewRecord["decision"],
		reason: string | null,
	): void {
		const result = this.store
			.update(catalogReviews)
			.set({ decision, reason, revision: revision + 1 })
			.where(
				and(eq(catalogReviews.id, id), eq(catalogReviews.revision, revision)),
			)
			.run();
		if (result.changes !== 1)
			throw new DomainError(
				"CATALOG_CONFLICT",
				"Review changed; reopen it before saving.",
			);
	}
	operation(
		key: string,
	): { fingerprint: string; result: ConfirmationResult } | null {
		const row = this.store
			.select()
			.from(catalogOperations)
			.where(eq(catalogOperations.key, key))
			.get();
		if (!row) return null;
		const { fingerprint, result } = readCatalogOperations(this.store, row);
		return { fingerprint, result };
	}
	saveOperation(
		key: string,
		fingerprint: string,
		result: ConfirmationResult,
	): void {
		writeCatalogOperations(this.store, { key, fingerprint, result });
	}
}
